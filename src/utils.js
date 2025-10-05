const { execSync, spawn } = require('child_process');
const chalk = require('chalk');
const path = require('path');
const https = require('https');

let verboseMode = false;

// Cache for Docker Hub API results
let meteorBaseTagsCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Cross-platform shell detection
const isWindows = process.platform === 'win32';
const shell = isWindows ? 'cmd.exe' : '/bin/bash';
const shellFlag = isWindows ? '/c' : '-c';

function setVerboseMode(verbose) {
  verboseMode = verbose;
}

function isVerbose() {
  return verboseMode;
}

function verboseLog(message, data = null) {
  if (verboseMode) {
    console.log(chalk.gray(`[VERBOSE] ${message}`));
    if (data) {
      console.log(chalk.gray(JSON.stringify(data, null, 2)));
    }
  }
}

function validateProjectId(projectId) {
  if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
    throw new Error('Project ID is required and must be a non-empty string');
  }
  
  // Basic validation for GCP project ID format
  if (!/^[a-z][a-z0-9\-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error('Project ID must be 6-30 characters, start with a letter, and contain only lowercase letters, numbers, and hyphens');
  }
}

function validateRegion(region) {
  if (!region || typeof region !== 'string') {
    throw new Error('Region is required and must be a string');
  }
  
  // Basic validation for GCP region format (e.g., us-central1, europe-west1)
  if (!/^[a-z]+-[a-z]+\d+$/.test(region) && region !== 'global') {
    throw new Error('Region must be in format like "us-central1" or "europe-west1"');
  }
}

function validateDomain(domain) {
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])*$/;
  return domainRegex.test(domain);
}

function extractDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    return null;
  }
}

function validateSettingsPath(settingsPath) {
  if (!settingsPath || typeof settingsPath !== 'string') {
    throw new Error('Settings path must be a non-empty string');
  }
  
  // Resolve to absolute path and ensure it's within project directory
  const resolved = path.resolve(settingsPath);
  const projectRoot = path.resolve(process.cwd());
  
  // Prevent path traversal attacks
  if (!resolved.startsWith(projectRoot)) {
    throw new Error('Settings file must be within the project directory');
  }
  
  // Additional validation for file extension
  if (!resolved.endsWith('.json')) {
    throw new Error('Settings file must have .json extension');
  }
  
  return resolved;
}

function sanitizeErrorMessage(error, filePath = null) {
  let message = error.message || 'Unknown error occurred';
  
  // Remove or obfuscate sensitive file paths
  if (filePath) {
    const baseName = path.basename(filePath);
    message = message.replace(new RegExp(escapeRegex(filePath), 'g'), baseName);
  }
  
  // Remove system-specific paths
  message = message.replace(/\/[^\s]+\/[^\s]+/g, '[PATH]');
  message = message.replace(/[A-Z]:\\[^\s]+/g, '[PATH]');
  
  return message;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function obfuscateCredential(credential, showLength = 6) {
  if (!credential || typeof credential !== 'string') {
    return '[INVALID]';
  }
  
  if (credential.length <= showLength) {
    return credential.substring(0, 2) + '...';
  }
  
  return credential.substring(0, showLength) + '...[REDACTED]';
}

function isCustomDomain(domain) {
  return domain && !domain.endsWith('.run.app');
}

function escapeShellArg(arg) {
  if (typeof arg !== 'string') {
    arg = String(arg);
  }
  
  if (isWindows) {
    // Windows cmd.exe escaping
    // Escape special characters and wrap in double quotes
    return `"${arg.replace(/["\\]/g, '\\$&').replace(/%/g, '%%')}"`;
  } else {
    // Unix shell escaping (bash/sh)
    // Wrap in single quotes and escape any existing single quotes
    return `'${arg.replace(/'/g, "'\"'\"'")}'`;
  }
}

async function executeCommand(command) {
  verboseLog(`Executing: ${command}`);
  const startTime = Date.now();
  
  try {
    const stdout = execSync(command, { 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      shell: shell,
      windowsHide: true, // Hide Windows command prompt windows
      env: { ...process.env } // Ensure environment variables are passed through
    });
    
    const duration = Date.now() - startTime;
    verboseLog(`Command completed in ${duration}ms`);
    
    return { stdout: stdout || '', stderr: '', code: 0 };
  } catch (error) {
    const duration = Date.now() - startTime;
    verboseLog(`Command failed after ${duration}ms`);
    verboseLog('Error:', error.message);
    verboseLog('STDERR:', error.stderr);
    
    throw new Error(`Command failed: ${command}\n${error.message}`);
  }
}

async function executeCommandWithAuth(command, authManager = null) {
  // If auth manager is provided, ensure authentication is set up
  if (authManager) {
    try {
      await authManager.validateAuthentication();
    } catch (error) {
      throw new Error(`Authentication required: ${error.message}`);
    }
  }
  
  return executeCommand(command);
}

async function executeCommandSimple(command) {
  try {
    return execSync(command, { 
      encoding: 'utf8', 
      stdio: 'pipe',
      shell: shell,
      windowsHide: true,
      env: { ...process.env } // Ensure environment variables are passed through
    });
  } catch (error) {
    return '';
  }
}

async function executeCommandVerbose(command, description = '') {
  if (description) {
    verboseLog(`Executing: ${description}`);
  }
  verboseLog(`Command: ${command}`);
  
  const startTime = Date.now();
  
  try {
    const result = execSync(command, { 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 10,
      shell: shell,
      windowsHide: true,
      env: { ...process.env } // Ensure environment variables are passed through
    });
    
    const duration = Date.now() - startTime;
    verboseLog(`Command completed in ${duration}ms`);
    
    if (result && result.trim()) {
      verboseLog('STDOUT:', result);
    }
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    verboseLog(`Command failed after ${duration}ms`);
    verboseLog('Error:', error.message);
    
    if (error.stderr && error.stderr.trim()) {
      verboseLog('STDERR:', error.stderr);
    }
    
    throw error;
  }
}

async function executeCommandStreaming(command) {
  return new Promise((resolve, reject) => {
    verboseLog(`Streaming command: ${command}`);
    
    const startTime = Date.now();
    let lastProgressTime = Date.now();
    const progressInterval = 10000; // Show progress every 10 seconds
    
    // Use spawn for streaming output
    const child = spawn(command, [], {
      shell: shell,
      windowsHide: true,
      env: { ...process.env },
      stdio: ['inherit', 'pipe', 'pipe']
    });
    
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let hasShownProgress = false;
    
    // Helper to clear progress line and show build step
    const clearProgressAndShow = (message) => {
      if (!hasShownProgress) {
        hasShownProgress = true;
        // Clear the progress line and show build step
        process.stdout.write('\r' + ' '.repeat(60) + '\r');
      }
      console.log(message);
    };
    
    // Progress indicator with in-place updates to avoid spam
    const progressTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      if (!hasShownProgress) {
        // Use \r to overwrite the same line instead of creating new lines
        process.stdout.write(`\r   ⏱️  Build in progress... (${minutes}m ${seconds}s elapsed)`);
      }
    }, progressInterval);
    
    // Handle stdout
    child.stdout.on('data', (data) => {
      const str = data.toString();
      stdoutBuffer += str;
      
      // Show key build steps to user
      if (str.includes('Step ') || str.includes('Successfully built') || 
          str.includes('Deploying container') || str.includes('Creating revision') ||
          str.includes('Setting IAM Policy') || str.includes('Done')) {
        // Extract and show meaningful progress
        const lines = str.split('\n').filter(line => line.trim());
        lines.forEach(line => {
          if (line.includes('Step ')) {
            const stepMatch = line.match(/Step (\d+\/\d+)/); 
            if (stepMatch) {
              clearProgressAndShow(chalk.gray(`   📦 ${stepMatch[0]}: Building layers...`));
            }
          } else if (line.includes('Successfully built')) {
            clearProgressAndShow(chalk.gray(`   ✓ Container image built successfully`));
          } else if (line.includes('Deploying container') || line.includes('Creating revision')) {
            clearProgressAndShow(chalk.gray(`   🚀 Deploying to Cloud Run...`));
          } else if (line.includes('Setting IAM Policy')) {
            clearProgressAndShow(chalk.gray(`   🔐 Configuring access permissions...`));
          } else if (line.includes('Done') && line.includes('Service')) {
            clearProgressAndShow(chalk.gray(`   ✓ Service deployment complete`));
          }
        });
      }
      
      // Log verbose output
      verboseLog('STDOUT:', str);
    });
    
    // Handle stderr  
    child.stderr.on('data', (data) => {
      const str = data.toString();
      stderrBuffer += str;
      verboseLog('STDERR:', str);
    });
    
    // Handle process completion
    child.on('close', (code) => {
      clearInterval(progressTimer);

      const duration = Date.now() - startTime;
      const minutes = Math.floor(duration / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);

      // Check if deployment actually succeeded despite non-zero exit code
      // gcloud builds submit returns exit code 1 for warnings (like IAM policy warnings)
      // but the deployment itself may have succeeded. We check the output for success indicators:
      // - "has been deployed and is serving" - Cloud Run deployment confirmation
      // - "Service URL:" - Service was created/updated successfully
      // - "DONE" + "Finished Step" - Cloud Build completed all steps
      // Check both stdout and stderr as gcloud may output to either
      const combinedOutput = stdoutBuffer + stderrBuffer;
      const deploymentSucceeded = combinedOutput.includes('has been deployed and is serving') ||
                                   combinedOutput.includes('Service URL:') ||
                                   (combinedOutput.includes('DONE') && combinedOutput.includes('Finished Step'));

      if (code === 0 || (code === 1 && deploymentSucceeded)) {
        if (code === 1 && deploymentSucceeded) {
          verboseLog(`Command completed with warnings (exit code ${code}) but deployment succeeded in ${minutes}m ${seconds}s`);
        } else {
          verboseLog(`Command completed successfully in ${minutes}m ${seconds}s`);
        }
        resolve({ stdout: stdoutBuffer, stderr: stderrBuffer });
      } else {
        verboseLog(`Command failed with exit code ${code} after ${minutes}m ${seconds}s`);
        verboseLog(`Deployment success check failed. Looking for success indicators in output...`);
        verboseLog(`Checking stdout (${stdoutBuffer.length} chars) and stderr (${stderrBuffer.length} chars)`);
        verboseLog(`Output contains 'has been deployed': ${combinedOutput.includes('has been deployed')}`);
        verboseLog(`Output contains 'Service URL': ${combinedOutput.includes('Service URL')}`);
        verboseLog(`Output contains 'DONE': ${combinedOutput.includes('DONE')}`);
        verboseLog(`Output contains 'Finished Step': ${combinedOutput.includes('Finished Step')}`);
        const error = new Error(`Command failed with exit code ${code}`);
        error.stdout = stdoutBuffer;
        error.stderr = stderrBuffer;
        error.code = code;
        reject(error);
      }
    });
    
    // Handle errors
    child.on('error', (error) => {
      clearInterval(progressTimer);
      verboseLog('Command execution error:', error.message);
      reject(error);
    });
  });
}

async function detectMeteorVersion() {
  try {
    // Try reading from .meteor/release file first
    const fs = require('fs-extra');
    const meteorReleasePath = path.join('.meteor', 'release');
    if (fs.existsSync(meteorReleasePath)) {
      const releaseContent = fs.readFileSync(meteorReleasePath, 'utf8').trim();
      const match = releaseContent.match(/METEOR@(.+)/);
      if (match) {
        return match[1];
      }
    }
    
    // Fallback to meteor --version command
    const result = await executeCommandSimple('meteor --version');
    const match = result.match(/Meteor (\d+\.\d+(?:\.\d+)?)/);
    if (match) {
      return match[1];
    }
    
    verboseLog('Could not detect Meteor version, using default');
    return null;
  } catch (error) {
    verboseLog('Error detecting Meteor version:', error.message);
    return null;
  }
}

async function getCompatibleBaseImage(meteorVersion) {
  if (!meteorVersion) {
    return 'geoffreybooth/meteor-base:2.12'; // Default fallback
  }
  
  verboseLog(`Finding compatible base image for Meteor ${meteorVersion}`);
  
  try {
    // First, try to get available tags from Docker Hub
    const availableTags = await fetchMeteorBaseTags();
    
    if (availableTags && availableTags.length > 0) {
      const dynamicMatch = findBestMatchingTag(meteorVersion, availableTags);
      if (dynamicMatch) {
        verboseLog(`Using dynamic match: ${dynamicMatch}`);
        return dynamicMatch;
      }
    }
    
    // Fallback to hardcoded compatibility map
    verboseLog('Using fallback compatibility map');
    return getCompatibleBaseImageFallback(meteorVersion);
    
  } catch (error) {
    verboseLog(`Error in dynamic lookup: ${error.message}, using fallback`);
    return getCompatibleBaseImageFallback(meteorVersion);
  }
}

function getCompatibleBaseImageFallback(meteorVersion) {
  try {
    // Parse version components
    const [major, minor, patch] = meteorVersion.split('.').map(Number);

    // Define known stable versions that we know exist
    // This is a smaller, curated list of confirmed stable versions
    const knownStableVersions = {
      3: [0, 1, 2, 3], // Meteor 3.x stable minors
      2: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], // Meteor 2.x stable minors
      1: [12] // Meteor 1.x stable minor
    };

    const majorMinor = `${major}.${minor}`;

    // Strategy 1: Try exact major.minor match (optimistic - assume it exists)
    // This allows the code to work with newer versions without updates
    verboseLog(`Attempting optimistic exact match: geoffreybooth/meteor-base:${majorMinor}`);
    const exactMatch = `geoffreybooth/meteor-base:${majorMinor}`;

    // Strategy 2: If we have known stable versions, validate against them
    if (knownStableVersions[major] && knownStableVersions[major].includes(minor)) {
      verboseLog(`Confirmed stable version match: ${exactMatch}`);
      return exactMatch;
    }

    // Strategy 3: For unknown versions, find closest known stable version
    if (knownStableVersions[major]) {
      const availableMinors = knownStableVersions[major];

      // Find closest minor version (prefer lower or equal)
      const closestMinor = availableMinors
        .filter(m => m <= minor)
        .sort((a, b) => b - a)[0] || availableMinors[availableMinors.length - 1];

      const closestMatch = `geoffreybooth/meteor-base:${major}.${closestMinor}`;
      verboseLog(`Using closest stable version: ${closestMatch} for ${meteorVersion}`);
      return closestMatch;
    }

    // Strategy 4: For completely unknown major versions, use latest tag
    verboseLog(`Unknown Meteor version ${meteorVersion}, using latest tag`);
    return 'geoffreybooth/meteor-base:latest';

  } catch (error) {
    verboseLog(`Error parsing Meteor version ${meteorVersion}: ${error.message}`);
    return 'geoffreybooth/meteor-base:latest'; // Ultimate fallback
  }
}

function getServiceName(config = {}) {
  // 1. Use explicit serviceName from config if provided
  if (config.serviceName && typeof config.serviceName === 'string') {
    return sanitizeServiceName(config.serviceName);
  }
  
  // 2. Try to get from package.json name
  try {
    const fs = require('fs-extra');
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = fs.readJsonSync(packageJsonPath);
      if (packageJson.name && typeof packageJson.name === 'string') {
        return sanitizeServiceName(packageJson.name);
      }
    }
  } catch (error) {
    verboseLog('Could not read package.json for service name:', error.message);
  }
  
  // 3. Default fallback
  return 'meteor-app';
}

function sanitizeServiceName(name) {
  // Cloud Run service names must:
  // - be lowercase
  // - contain only letters, numbers, and hyphens
  // - start with a letter
  // - not end with a hyphen
  // - be 1-63 characters long
  
  let sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-') // Replace invalid chars with hyphens
    .replace(/^[^a-z]+/, '') // Remove leading non-letters
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/-$/, '') // Remove trailing hyphen
    .substring(0, 63); // Limit length
  
  // Ensure it starts with a letter
  if (!sanitized || !/^[a-z]/.test(sanitized)) {
    sanitized = 'meteor-' + (sanitized || 'app');
  }
  
  // Ensure it doesn't end with hyphen
  sanitized = sanitized.replace(/-$/, '');
  
  return sanitized || 'meteor-app';
}

function getSecretName(serviceName, secretType) {
  // Generate unique secret names per service
  const sanitizedService = sanitizeServiceName(serviceName);
  return `${sanitizedService}-${secretType}`;
}

function generateLoadBalancerResourceNames(serviceName) {
  const sanitizedName = sanitizeServiceName(serviceName);
  
  return {
    staticIpName: `${sanitizedName}-ip`,
    sslCertName: `${sanitizedName}-ssl-cert`,
    negName: `${sanitizedName}-neg`,
    backendServiceName: `${sanitizedName}-backend`,
    urlMapName: `${sanitizedName}-url-map`,
    targetProxyName: `${sanitizedName}-https-proxy`,
    forwardingRuleName: `${sanitizedName}-https-rule`
  };
}

function validateCustomDomain(domain) {
  // First, use existing domain validation
  validateDomain(domain);
  
  // Additional checks for custom domains
  if (domain.endsWith('.run.app')) {
    throw new Error('Cannot use .run.app domains as custom domains. These are automatically handled by Cloud Run.');
  }
  
  // Check for valid SSL certificate domain format
  if (!/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i.test(domain)) {
    throw new Error('Invalid domain format for SSL certificate. Use format: example.com or subdomain.example.com');
  }
  
  // Check for wildcards (not supported)
  if (domain.includes('*')) {
    throw new Error('Wildcard domains are not supported. Please specify an exact domain.');
  }
  
  return true;
}

async function checkRequiredAPIs(projectId) {
  const requiredAPIs = {
    'compute.googleapis.com': 'Compute Engine API'
  };
  
  const apiStatus = {};
  
  for (const [api, name] of Object.entries(requiredAPIs)) {
    try {
      const result = await executeCommand(
        `gcloud services list --project=${projectId} --filter="name:${api}" --format="value(name)"`
      );
      apiStatus[api] = {
        name,
        enabled: result.stdout.trim() === api
      };
    } catch (error) {
      apiStatus[api] = {
        name,
        enabled: false,
        error: error.message
      };
    }
  }
  
  return apiStatus;
}

async function waitForResourceReady(resourceType, resourceName, maxWaitMinutes = 30) {
  const startTime = Date.now();
  const maxWaitMs = maxWaitMinutes * 60 * 1000;
  const pollInterval = 30000; // 30 seconds
  
  console.log(chalk.blue(`⏳ Waiting for ${resourceType} to be ready (max ${maxWaitMinutes} minutes)...`));
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      let isReady = false;
      let status = 'UNKNOWN';
      
      switch (resourceType) {
        case 'ssl-certificate':
          const certResult = await executeCommand(
            `gcloud compute ssl-certificates describe ${resourceName} --global --format="value(managed.status)"`
          );
          status = certResult.stdout.trim();
          isReady = status === 'ACTIVE';
          break;
          
        case 'load-balancer':
          const lbResult = await executeCommand(
            `gcloud compute forwarding-rules describe ${resourceName} --global --format="value(status)"`
          );
          status = lbResult.stdout.trim();
          isReady = status === 'ACTIVE';
          break;
          
        default:
          throw new Error(`Unknown resource type: ${resourceType}`);
      }
      
      if (isReady) {
        console.log(chalk.green(`✅ ${resourceType} is ready!`));
        return true;
      }
      
      const elapsedMinutes = Math.round((Date.now() - startTime) / 60000);
      console.log(chalk.dim(`   Status: ${status} (${elapsedMinutes} minutes elapsed)`));
      
      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
    } catch (error) {
      console.log(chalk.yellow(`⚠️ Error checking ${resourceType} status: ${error.message}`));
      // Continue polling even if there's an error
    }
  }
  
  console.log(chalk.red(`❌ Timeout: ${resourceType} not ready after ${maxWaitMinutes} minutes`));
  return false;
}

async function fetchMeteorBaseTags() {
  // Check cache first
  if (meteorBaseTagsCache && cacheTimestamp && (Date.now() - cacheTimestamp) < CACHE_DURATION) {
    verboseLog('Using cached meteor-base tags');
    return meteorBaseTagsCache;
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      verboseLog('Docker Hub API timeout, using fallback');
      resolve(null);
    }, 5000); // 5 second timeout

    const options = {
      hostname: 'registry.hub.docker.com',
      port: 443,
      path: '/v2/repositories/geoffreybooth/meteor-base/tags?page_size=100',
      method: 'GET',
      headers: {
        'User-Agent': 'meteor-cloud-run-cli'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(data);
          if (response.results && Array.isArray(response.results)) {
            const tags = response.results
              .map(tag => tag.name)
              .filter(name => /^\d+\.\d+/.test(name)) // Only version tags like "2.12", "3.1", etc.
              .sort((a, b) => {
                // Sort by version number
                const [aMajor, aMinor] = a.split('.').map(Number);
                const [bMajor, bMinor] = b.split('.').map(Number);
                if (aMajor !== bMajor) return bMajor - aMajor; // Descending major
                return bMinor - aMinor; // Descending minor
              });
            
            // Cache the results
            meteorBaseTagsCache = tags;
            cacheTimestamp = Date.now();
            
            verboseLog(`Fetched ${tags.length} meteor-base tags from Docker Hub`);
            resolve(tags);
          } else {
            verboseLog('Unexpected Docker Hub API response format');
            resolve(null);
          }
        } catch (error) {
          verboseLog(`Failed to parse Docker Hub response: ${error.message}`);
          resolve(null);
        }
      });
    });

    req.on('error', (error) => {
      clearTimeout(timeout);
      verboseLog(`Docker Hub API error: ${error.message}`);
      resolve(null);
    });

    req.end();
  });
}

function findBestMatchingTag(meteorVersion, availableTags) {
  if (!availableTags || availableTags.length === 0) {
    return null;
  }

  const [targetMajor, targetMinor] = meteorVersion.split('.').map(Number);
  
  // Look for exact match first
  const exactMatch = availableTags.find(tag => tag === meteorVersion);
  if (exactMatch) {
    verboseLog(`Found exact match: ${exactMatch}`);
    return `geoffreybooth/meteor-base:${exactMatch}`;
  }
  
  // Look for same major version, closest minor version
  const sameMajor = availableTags.filter(tag => {
    const [major] = tag.split('.').map(Number);
    return major === targetMajor;
  });
  
  if (sameMajor.length > 0) {
    // Find closest minor version (prefer lower or equal)
    const bestMinor = sameMajor.find(tag => {
      const [, minor] = tag.split('.').map(Number);
      return minor <= targetMinor;
    }) || sameMajor[sameMajor.length - 1]; // Fallback to highest available
    
    verboseLog(`Found compatible version: ${bestMinor} for ${meteorVersion}`);
    return `geoffreybooth/meteor-base:${bestMinor}`;
  }
  
  // Fallback to latest stable if no major match
  verboseLog(`No major version match for ${meteorVersion}, using latest available`);
  return `geoffreybooth/meteor-base:${availableTags[0]}`;
}

/**
 * Execute command with retry logic for transient failures
 * @param {string} command - The command to execute
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} options.baseDelay - Base delay in milliseconds (default: 1000)
 * @param {boolean} options.exponentialBackoff - Use exponential backoff (default: true)
 * @param {boolean} options.jitter - Add random jitter to prevent thundering herd (default: true)
 * @returns {Promise<Object>} Command result
 */
async function executeCommandWithRetry(command, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    exponentialBackoff = true,
    jitter = true
  } = options;
  
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      verboseLog(`Command attempt ${attempt}/${maxRetries}: ${command}`);
      return await executeCommand(command);
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      if (!isRetryableError(error)) {
        verboseLog(`Non-retryable error, aborting: ${error.message}`);
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt === maxRetries) {
        verboseLog(`Final attempt failed: ${error.message}`);
        break;
      }
      
      // Calculate delay with exponential backoff and jitter
      let delay = baseDelay;
      if (exponentialBackoff) {
        delay = baseDelay * Math.pow(2, attempt - 1);
      }
      
      if (jitter) {
        // Add ±25% random jitter to prevent thundering herd
        const jitterAmount = delay * 0.25;
        delay += (Math.random() - 0.5) * 2 * jitterAmount;
      }
      
      verboseLog(`Retryable error on attempt ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Determine if an error is retryable based on common transient failure patterns
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error might be transient and worth retrying
 */
function isRetryableError(error) {
  const errorMessage = (error.message || '').toLowerCase();
  const errorCode = error.code;
  
  // HTTP status codes that are typically retryable
  const retryablePatterns = [
    // Network/connectivity issues
    'timeout',
    'connection refused',
    'connection reset',
    'network unreachable',
    'dns resolution failed',
    'temporary failure',
    
    // Google Cloud API specific errors
    'rate limit exceeded',
    'quota exceeded',
    'too many requests',
    'service unavailable',
    'internal server error',
    'backend error',
    'deadline exceeded',
    'unavailable',
    
    // HTTP status codes
    '429', // Too Many Requests
    '500', // Internal Server Error
    '502', // Bad Gateway
    '503', // Service Unavailable
    '504', // Gateway Timeout
    
    // gcloud CLI specific transient errors
    'operation failed due to concurrent modification',
    'resource is being created',
    'another operation is in progress',
  ];
  
  // Check if error message contains any retryable patterns
  const isRetryable = retryablePatterns.some(pattern => 
    errorMessage.includes(pattern)
  );
  
  // Also check exit codes that might indicate transient issues
  const retryableCodes = [124, 125, 126, 127, 130, 143]; // Timeout, command errors, signals
  
  if (isRetryable) {
    verboseLog(`Error marked as retryable: ${error.message}`);
    return true;
  }
  
  if (retryableCodes.includes(errorCode)) {
    verboseLog(`Error code ${errorCode} marked as retryable`);
    return true;
  }
  
  verboseLog(`Error marked as non-retryable: ${error.message}`);
  return false;
}

module.exports = {
  setVerboseMode,
  isVerbose,
  verboseLog,
  validateProjectId,
  validateRegion,
  validateDomain,
  extractDomainFromUrl,
  validateSettingsPath,
  sanitizeErrorMessage,
  obfuscateCredential,
  isCustomDomain,
  escapeShellArg,
  executeCommand,
  executeCommandWithAuth,
  executeCommandSimple,
  executeCommandVerbose,
  executeCommandStreaming,
  executeCommandWithRetry,
  isRetryableError,
  detectMeteorVersion,
  getCompatibleBaseImage,
  getServiceName,
  sanitizeServiceName,
  getSecretName,
  generateLoadBalancerResourceNames,
  validateCustomDomain,
  checkRequiredAPIs,
  waitForResourceReady
};