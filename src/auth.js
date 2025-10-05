const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const { verboseLog, executeCommand, executeCommandSimple } = require('./utils');

class AuthManager {
  constructor() {
    this.tempCredentialFile = null;
    this.originalCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    this.exitHandlerSet = false;
  }

  /**
   * Detect CI/CD environment
   */
  detectCIEnvironment() {
    const ciIndicators = {
      'GitHub Actions': process.env.GITHUB_ACTIONS === 'true',
      'GitLab CI': process.env.GITLAB_CI === 'true',
      'CircleCI': process.env.CIRCLECI === 'true',
      'Jenkins': process.env.JENKINS_URL !== undefined,
      'Azure DevOps': process.env.AZURE_HTTP_USER_AGENT !== undefined,
      'Travis CI': process.env.TRAVIS === 'true',
      'Google Cloud Build': process.env.BUILDER_OUTPUT !== undefined,
      'Generic CI': process.env.CI === 'true'
    };

    for (const [name, detected] of Object.entries(ciIndicators)) {
      if (detected) {
        verboseLog(`Detected CI environment: ${name}`);
        return { name, detected: true };
      }
    }

    return { name: 'Local', detected: false };
  }

  /**
   * Check current authentication status
   */
  async checkAuthenticationStatus() {
    try {
      const result = await executeCommandSimple('gcloud auth list --filter=status:ACTIVE --format="value(account)"');
      const activeAccount = result.trim();
      
      if (activeAccount) {
        verboseLog(`Active gcloud account: ${activeAccount}`);
        return {
          authenticated: true,
          account: activeAccount,
          method: 'gcloud'
        };
      }
    } catch (error) {
      verboseLog('No active gcloud authentication found');
    }

    // Check for service account authentication
    const credFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credFile && fs.existsSync(credFile)) {
      try {
        const credentials = JSON.parse(fs.readFileSync(credFile, 'utf8'));
        if (credentials.client_email) {
          verboseLog(`Service account credentials found: ${credentials.client_email}`);
          return {
            authenticated: true,
            account: credentials.client_email,
            method: 'service-account'
          };
        }
      } catch (error) {
        verboseLog('Invalid service account credentials file');
      }
    }

    return {
      authenticated: false,
      account: null,
      method: null
    };
  }

  /**
   * Setup authentication for CI/CD environments
   */
  async setupAuthentication(options = {}) {
    const { serviceAccountKey, projectId } = options;
    
    // Check if already authenticated
    const authStatus = await this.checkAuthenticationStatus();
    if (authStatus.authenticated && !serviceAccountKey) {
      verboseLog('Already authenticated, skipping setup');
      return authStatus;
    }

    // Try service account key from parameter
    if (serviceAccountKey) {
      return await this.setupServiceAccountAuth(serviceAccountKey);
    }

    // Try environment variables
    return await this.setupEnvironmentAuth();
  }

  /**
   * Setup service account authentication from key file or JSON
   */
  async setupServiceAccountAuth(serviceAccountKey) {
    try {
      // Input validation
      if (!serviceAccountKey || typeof serviceAccountKey !== 'string') {
        throw new Error('Service account key must be a non-empty string');
      }

      // Size limit to prevent DoS (10MB max)
      if (serviceAccountKey.length > 10 * 1024 * 1024) {
        throw new Error('Service account key too large (max 10MB)');
      }

      let credentialsData;

      // Check if it's a file path (with security validation)
      if (this.isValidFilePath(serviceAccountKey) && fs.existsSync(serviceAccountKey)) {
        verboseLog('Using service account key file');
        
        // Validate file size before reading
        const stats = fs.statSync(serviceAccountKey);
        if (stats.size > 10 * 1024 * 1024) {
          throw new Error('Service account key file too large (max 10MB)');
        }
        
        credentialsData = fs.readFileSync(serviceAccountKey, 'utf8');
      } else {
        // Handle base64 or raw JSON
        credentialsData = this.decodeServiceAccountKey(serviceAccountKey);
      }

      // Parse and validate credentials
      const credentials = this.validateServiceAccountCredentials(credentialsData);

      // Create temporary credentials file securely
      const tempFile = await this.createSecureTempFile(credentialsData);
      
      this.tempCredentialFile = tempFile;
      process.env.GOOGLE_APPLICATION_CREDENTIALS = tempFile;

      // Set up cleanup on process exit
      this.setupProcessExitCleanup();

      verboseLog(`Service account authentication setup: ${this.obfuscateEmail(credentials.client_email)}`);
      
      return {
        authenticated: true,
        account: credentials.client_email,
        method: 'service-account',
        temporary: true
      };

    } catch (error) {
      // Sanitize error message to prevent credential leaks
      const sanitizedMessage = this.sanitizeErrorMessage(error.message);
      throw new Error(`Failed to setup service account authentication: ${sanitizedMessage}`);
    }
  }

  /**
   * Validate if a string could be a valid file path (basic security check)
   */
  isValidFilePath(filePath) {
    // Basic path traversal protection
    if (filePath.includes('..') || filePath.includes('~')) {
      return false;
    }
    
    // Must look like a file path (contains / or \ and has reasonable length)
    return (filePath.includes('/') || filePath.includes('\\')) && 
           filePath.length < 4096 && 
           !filePath.includes('\n') && 
           !filePath.includes('\0');
  }

  /**
   * Decode service account key from base64 or raw JSON
   */
  decodeServiceAccountKey(serviceAccountKey) {
    try {
      // Try base64 decode first
      const decoded = Buffer.from(serviceAccountKey, 'base64').toString('utf8');
      JSON.parse(decoded); // Validate JSON
      verboseLog('Using base64-encoded service account key');
      return decoded;
    } catch {
      try {
        // Try as raw JSON
        JSON.parse(serviceAccountKey); // Validate JSON
        verboseLog('Using raw JSON service account key');
        return serviceAccountKey;
      } catch {
        throw new Error('Invalid service account key format (not valid JSON or base64)');
      }
    }
  }

  /**
   * Validate service account credentials structure
   */
  validateServiceAccountCredentials(credentialsData) {
    const credentials = JSON.parse(credentialsData);
    
    // Validate required fields
    if (!credentials.client_email || typeof credentials.client_email !== 'string') {
      throw new Error('Invalid service account: missing or invalid client_email');
    }
    
    if (!credentials.private_key || typeof credentials.private_key !== 'string') {
      throw new Error('Invalid service account: missing or invalid private_key');
    }
    
    if (!credentials.type || credentials.type !== 'service_account') {
      throw new Error('Invalid service account: type must be "service_account"');
    }

    // Validate email format
    if (!credentials.client_email.includes('@') || !credentials.client_email.includes('.')) {
      throw new Error('Invalid service account: client_email format is invalid');
    }

    return credentials;
  }

  /**
   * Create temporary credentials file with secure permissions
   */
  async createSecureTempFile(credentialsData) {
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `meteor-cloud-run-credentials-${Date.now()}-${Math.random().toString(36).substring(7)}.json`);
    
    // Create file with secure permissions atomically
    const fd = fs.openSync(tempFile, 'wx', 0o600); // wx = create exclusive, fail if exists
    try {
      fs.writeSync(fd, credentialsData, 0, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    
    return tempFile;
  }

  /**
   * Setup cleanup on process exit
   */
  setupProcessExitCleanup() {
    if (this.exitHandlerSet) return;
    
    const cleanup = () => {
      this.cleanup();
    };
    
    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('uncaughtException', cleanup);
    
    this.exitHandlerSet = true;
  }

  /**
   * Obfuscate email for logging
   */
  obfuscateEmail(email) {
    const [local, domain] = email.split('@');
    return `${local.substring(0, 3)}***@${domain}`;
  }

  /**
   * Sanitize error messages to prevent credential leaks
   */
  sanitizeErrorMessage(message) {
    // Remove potential credential data patterns
    return message
      .replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, '[PRIVATE_KEY]')
      .replace(/"private_key":\s*"[^"]*"/g, '"private_key": "[REDACTED]"')
      .replace(/[A-Za-z0-9+/]{100,}/g, '[BASE64_DATA]')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
  }

  /**
   * Setup authentication from environment variables
   */
  async setupEnvironmentAuth() {
    // Check GOOGLE_APPLICATION_CREDENTIALS (existing file)
    const credFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credFile && typeof credFile === 'string') {
      // Validate file path for security
      if (this.isValidFilePath(credFile) && fs.existsSync(credFile)) {
        verboseLog('Using GOOGLE_APPLICATION_CREDENTIALS');
        return await this.checkAuthenticationStatus();
      }
    }

    // Check environment variables containing credential data (in order of preference)
    const envVars = [
      'GCLOUD_SERVICE_KEY',    // Common in GitLab CI
      'GOOGLE_CREDENTIALS',    // Common in GitHub Actions
      'GCP_SA_KEY'            // Alternative naming
    ];

    for (const envVar of envVars) {
      const serviceKey = process.env[envVar];
      if (serviceKey && typeof serviceKey === 'string' && serviceKey.trim()) {
        verboseLog(`Found ${envVar} environment variable`);
        return await this.setupServiceAccountAuth(serviceKey);
      }
    }

    throw new Error('No authentication method found. Please set up authentication.');
  }

  /**
   * Get project ID from various sources
   */
  async getProjectId(explicitProjectId = null) {
    // 1. Explicit parameter
    if (explicitProjectId) {
      verboseLog(`Using explicit project ID: ${explicitProjectId}`);
      return explicitProjectId;
    }

    // 2. Environment variables
    const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || 
                        process.env.GCLOUD_PROJECT || 
                        process.env.GCP_PROJECT;
    if (envProjectId) {
      verboseLog(`Using project ID from environment: ${envProjectId}`);
      return envProjectId;
    }

    // 3. Service account credentials
    const credFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credFile && fs.existsSync(credFile)) {
      try {
        const credentials = JSON.parse(fs.readFileSync(credFile, 'utf8'));
        if (credentials.project_id) {
          verboseLog(`Using project ID from service account: ${credentials.project_id}`);
          return credentials.project_id;
        }
      } catch (error) {
        verboseLog('Could not read project ID from service account credentials');
      }
    }

    // 4. gcloud configuration
    try {
      const result = await executeCommandSimple('gcloud config get-value project');
      const projectId = result.trim();
      if (projectId && projectId !== '(unset)') {
        verboseLog(`Using project ID from gcloud config: ${projectId}`);
        return projectId;
      }
    } catch (error) {
      verboseLog('Could not get project ID from gcloud config');
    }

    return null;
  }

  /**
   * Generate CI/CD setup instructions
   */
  getCISetupInstructions(ciEnvironment) {
    const instructions = {
      'GitHub Actions': `
Add these secrets to your GitHub repository:
1. Go to Settings > Secrets and variables > Actions
2. Add a new secret named GOOGLE_CREDENTIALS
3. Set the value to your service account JSON key (base64 encoded or raw JSON)

In your workflow file (.github/workflows/deploy.yml):
\`\`\`yaml
- uses: google-github-actions/auth@v2
  with:
    credentials_json: \${{ secrets.GOOGLE_CREDENTIALS }}
- run: meteor-cloud-run deploy
\`\`\`

Or using Workload Identity Federation (recommended):
\`\`\`yaml
- uses: google-github-actions/auth@v2
  with:
    workload_identity_provider: 'projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID'
    service_account: 'SERVICE_ACCOUNT_EMAIL'
- run: meteor-cloud-run deploy
\`\`\``,

      'GitLab CI': `
Add these variables to your GitLab project:
1. Go to Settings > CI/CD > Variables
2. Add GCLOUD_SERVICE_KEY with your service account JSON (base64 encoded)
3. Add GOOGLE_CLOUD_PROJECT with your project ID

In your .gitlab-ci.yml:
\`\`\`yaml
before_script:
  - echo $GCLOUD_SERVICE_KEY | base64 -d > /tmp/gcloud-key.json
  - export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcloud-key.json
script:
  - meteor-cloud-run deploy
\`\`\``,

      'CircleCI': `
Add these environment variables in your CircleCI project:
1. GCLOUD_SERVICE_KEY (base64 encoded service account JSON)
2. GOOGLE_CLOUD_PROJECT (your project ID)

In your .circleci/config.yml:
\`\`\`yaml
- run:
    name: Setup authentication
    command: |
      echo $GCLOUD_SERVICE_KEY | base64 -d > /tmp/gcloud-key.json
      export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcloud-key.json
- run: meteor-cloud-run deploy
\`\`\``,

      'Generic CI': `
Set these environment variables in your CI platform:
- GOOGLE_APPLICATION_CREDENTIALS: Path to service account JSON file
- GCLOUD_SERVICE_KEY: Base64-encoded service account JSON
- GOOGLE_CLOUD_PROJECT: Your Google Cloud project ID

For base64-encoded credentials:
\`\`\`bash
echo $GCLOUD_SERVICE_KEY | base64 -d > /tmp/gcloud-key.json
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcloud-key.json
meteor-cloud-run deploy
\`\`\``
    };

    return instructions[ciEnvironment.name] || instructions['Generic CI'];
  }

  /**
   * Cleanup temporary credentials
   */
  cleanup() {
    if (this.tempCredentialFile) {
      try {
        if (fs.existsSync(this.tempCredentialFile)) {
          // Overwrite with zeros before deletion (secure deletion)
          const stats = fs.statSync(this.tempCredentialFile);
          const zeros = Buffer.alloc(stats.size, 0);
          fs.writeFileSync(this.tempCredentialFile, zeros);
          fs.unlinkSync(this.tempCredentialFile);
          verboseLog('Securely cleaned up temporary credentials file');
        }
      } catch (error) {
        verboseLog(`Error cleaning up credentials: ${error.message}`);
        // Try force deletion if secure cleanup fails
        try {
          fs.unlinkSync(this.tempCredentialFile);
        } catch (forceError) {
          verboseLog(`Force cleanup also failed: ${forceError.message}`);
        }
      }
      
      this.tempCredentialFile = null;
    }

    // Restore original credentials
    if (this.originalCredentials) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = this.originalCredentials;
    } else {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
  }

  /**
   * Validate authentication and provide helpful error messages
   */
  async validateAuthentication() {
    const authStatus = await this.checkAuthenticationStatus();
    const ciEnv = this.detectCIEnvironment();

    if (!authStatus.authenticated) {
      let errorMessage = chalk.red('❌ No Google Cloud authentication found.\n');
      
      if (ciEnv.detected) {
        errorMessage += chalk.yellow('\n🔧 CI/CD Environment Detected\n');
        errorMessage += 'You need to set up service account authentication for CI/CD.\n\n';
        errorMessage += chalk.cyan('Quick Setup:\n');
        errorMessage += '1. Create a service account in Google Cloud Console\n';
        errorMessage += '2. Download the JSON key file\n';
        errorMessage += '3. Set up your CI/CD environment variables\n\n';
        errorMessage += chalk.blue('Platform-specific instructions:\n');
        errorMessage += this.getCISetupInstructions(ciEnv);
      } else {
        errorMessage += chalk.yellow('\n🔧 Local Development\n');
        errorMessage += 'Run the following command to authenticate:\n';
        errorMessage += chalk.cyan('gcloud auth login\n');
        errorMessage += chalk.cyan('gcloud config set project YOUR_PROJECT_ID\n\n');
        errorMessage += 'Or set up service account authentication:\n';
        errorMessage += chalk.cyan('export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json\n');
      }

      throw new Error(errorMessage);
    }

    verboseLog(`✅ Authentication validated: ${authStatus.account} (${authStatus.method})`);
    return authStatus;
  }

  /**
   * Test authentication with a simple API call
   */
  async testAuthentication() {
    try {
      const result = await executeCommand('gcloud auth list --filter=status:ACTIVE --format="value(account)"');
      const account = result.stdout.trim();
      
      if (!account) {
        throw new Error('No active authentication found');
      }

      // Test project access
      const projectId = await this.getProjectId();
      if (projectId) {
        try {
          await executeCommand(`gcloud projects describe ${projectId} --format="value(projectId)"`);
          console.log(chalk.green('✅ Authentication test successful'));
          console.log(chalk.blue(`   Account: ${account}`));
          console.log(chalk.blue(`   Project: ${projectId}`));
          return { success: true, account, projectId };
        } catch (error) {
          console.log(chalk.yellow(`⚠️ Authenticated but cannot access project ${projectId}`));
          console.log(chalk.red(`   Error: ${error.message}`));
          return { success: false, account, projectId, error: error.message };
        }
      } else {
        console.log(chalk.yellow('⚠️ Authenticated but no project ID found'));
        return { success: false, account, error: 'No project ID configured' };
      }
    } catch (error) {
      console.log(chalk.red('❌ Authentication test failed'));
      console.log(chalk.red(`   Error: ${error.message}`));
      throw error;
    }
  }
}

module.exports = AuthManager;