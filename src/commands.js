const fs = require('fs-extra');
const path = require('path');
const inquirer = require('inquirer');
const chalk = require('chalk');
const { 
  verboseLog,
  isVerbose, 
  validateProjectId, 
  validateRegion, 
  executeCommand, 
  executeCommandVerbose,
  executeCommandStreaming,
  executeCommandWithRetry,
  getServiceName,
  getSecretName,
  escapeShellArg,
  validateSettingsPath,
  sanitizeErrorMessage,
  obfuscateCredential,
  validateCustomDomain
} = require('./utils');
const { processSettingsFile, extractConfigFromSettings, migrateSettingsToMeteorCloudRun } = require('./settings');
const { createDeploymentFiles, uploadSettingsToGCS, createCloudBuildConfig } = require('./fileGeneration');
const { createLoadBalancer } = require('./loadBalancer');
const { migrateDomainMapping } = require('./domainMappingMigration');
const AuthManager = require('./auth');

// Helper function to get config file path with fallback support
function getConfigFilePath() {
  const path = require('path');
  const newPath = path.join('.meteor-cloud-run', 'config.json');
  const oldNewPath = path.join('.meteor-cloud-run', '.meteor-cloud-run.json'); // Previous new path for migration
  const oldPath = '.meteor-cloud-run.json'; // Original old path
  
  // Check new location first, then previous new location, finally old location for backward compatibility
  if (fs.existsSync(newPath)) {
    return newPath;
  } else if (fs.existsSync(oldNewPath)) {
    return oldNewPath;
  } else if (fs.existsSync(oldPath)) {
    return oldPath;
  }
  return newPath; // Return new path for creation
}

async function initCommand(options) {
  console.log(chalk.blue('🚀 Initializing Meteor Cloud Run deployment configuration...'));
  
  if (options.verbose) {
    require('./utils').setVerboseMode(true);
    verboseLog('Verbose mode enabled');
  }

  // Setup authentication
  const authManager = new AuthManager();
  try {
    // Try to get global options from process.argv since we can't access program directly
    const globalOptions = {};
    const argv = process.argv;
    
    // Parse global options from command line
    const projectIndex = argv.indexOf('--project');
    if (projectIndex !== -1 && argv[projectIndex + 1]) {
      globalOptions.project = argv[projectIndex + 1];
    }
    
    const serviceAccountIndex = argv.indexOf('--service-account-key');
    if (serviceAccountIndex !== -1 && argv[serviceAccountIndex + 1]) {
      globalOptions.serviceAccountKey = argv[serviceAccountIndex + 1];
    }
    
    await authManager.setupAuthentication({
      serviceAccountKey: globalOptions.serviceAccountKey,
      projectId: globalOptions.project
    });
    
    verboseLog('Authentication setup completed');
  } catch (error) {
    console.log(chalk.red('❌ Authentication failed:'));
    console.log(error.message);
    
    // Show CI setup instructions if in CI environment
    const ciEnv = authManager.detectCIEnvironment();
    if (ciEnv.detected) {
      console.log(chalk.yellow('\n🚀 CI/CD Setup Instructions:'));
      console.log(authManager.getCISetupInstructions(ciEnv));
    }
    
    authManager.cleanup();
    process.exit(1);
  }

  // Check if configuration already exists
  const configPath = getConfigFilePath();
  if (fs.existsSync(configPath)) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'Configuration file already exists. Overwrite?',
        default: false
      }
    ]);
    
    if (!overwrite) {
      console.log(chalk.yellow('❌ Initialization cancelled.'));
      return;
    }
  }

  // Check authentication status first
  const { executeCommand } = require('./utils');
  let isAuthenticated = false;
  let activeAccount = null;
  
  // First check if gcloud is installed
  try {
    await executeCommand('gcloud --version');
  } catch (error) {
    gcloudInstalled = false;
    console.log(chalk.red('❌ Google Cloud CLI is not installed'));
    console.log(chalk.blue('\nTo install the Google Cloud CLI:'));
    console.log(chalk.cyan('  Visit: https://cloud.google.com/sdk/docs/install'));
    console.log(chalk.yellow('\nAfter installation, run: meteor-cloud-run init'));
    return;
  }
  
  // Check authentication
  try {
    const authResult = await executeCommand('gcloud auth list --filter=status:ACTIVE --format="value(account)"');
    if (authResult.stdout && authResult.stdout.trim()) {
      isAuthenticated = true;
      activeAccount = authResult.stdout.trim();
      console.log(chalk.green(`✅ Authenticated as: ${activeAccount}`));
    }
  } catch (error) {
    // Not authenticated
  }
  
  if (!isAuthenticated) {
    console.log(chalk.yellow('⚠️ You are not authenticated with Google Cloud'));
    console.log(chalk.blue('\nPlease run the following commands:'));
    console.log(chalk.cyan('  gcloud auth login'));
    console.log(chalk.cyan('  gcloud auth application-default login'));
    console.log('');
    console.log(chalk.yellow('Then re-run: meteor-cloud-run init'));
    return;
  }
  
  // Check for Application Default Credentials
  try {
    await executeCommand('gcloud auth application-default print-access-token');
  } catch (error) {
    console.log(chalk.yellow('⚠️ Application Default Credentials not configured'));
    console.log(chalk.blue('\nPlease run:'));
    console.log(chalk.cyan('  gcloud auth application-default login'));
    console.log('');
    console.log(chalk.yellow('Then re-run: meteor-cloud-run init'));
    return;
  }
  
  // Auto-detect settings file if not provided
  let detectedSettingsFile = null;
  let detectedSettings = null;
  let autoDetectedConfig = {};
  
  // Auto-detect current project from gcloud config
  try {
    const result = await executeCommand('gcloud config get-value project');
    if (result.stdout && result.stdout.trim() && result.stdout.trim() !== '(unset)') {
      autoDetectedConfig.projectId = result.stdout.trim();
      console.log(chalk.blue(`📦 Auto-detected GCP project: ${autoDetectedConfig.projectId}`));
    }
  } catch (error) {
    // Silently ignore if gcloud is not configured
  }

  if (options.settings) {
    try {
      const validatedPath = validateSettingsPath(options.settings);
      if (!fs.existsSync(validatedPath)) {
        console.log(chalk.red(`❌ Specified settings file not found: ${options.settings}`));
        return;
      }
      detectedSettingsFile = validatedPath;
    } catch (error) {
      console.log(chalk.red(`❌ Invalid settings path: ${sanitizeErrorMessage(error)}`));
      return;
    }
  } else {
    // Settings file must be explicitly specified via --settings flag
    // No auto-detection to avoid surprises
    console.log(chalk.yellow('💡 No settings file specified. Use --settings <path> if you need to configure environment variables.'));
  }

  if (detectedSettingsFile) {
    try {
      // First, migrate Galaxy settings to Meteor Cloud Run format if needed
      const migrated = await migrateSettingsToMeteorCloudRun(detectedSettingsFile);
      if (migrated) {
        console.log(chalk.green(`✅ Migrated Galaxy settings to Meteor Cloud Run format in ${detectedSettingsFile}`));
        console.log(chalk.blue(`   📝 Environment variables are now in "meteor-cloud-run.env" for easier management`));
      }
      
      // Re-read settings file after potential migration
      detectedSettings = await fs.readJson(detectedSettingsFile);
      const settingsConfig = await extractConfigFromSettings(detectedSettings);
      // Merge settings config with auto-detected config (auto-detected takes precedence for projectId)
      autoDetectedConfig = { ...settingsConfig, ...autoDetectedConfig };
      console.log(chalk.green(`✅ Settings file processed successfully`));
      if (autoDetectedConfig.projectId) {
        console.log(chalk.blue(`   📦 Project ID: ${autoDetectedConfig.projectId}`));
      }
      if (autoDetectedConfig.mongoUrl) {
        console.log(chalk.blue(`   🗄️ MongoDB configured`));
      }
      if (autoDetectedConfig.rootUrl) {
        console.log(chalk.blue(`   🌐 ROOT_URL: ${autoDetectedConfig.rootUrl}`));
      }
    } catch (error) {
      console.log(chalk.yellow(`⚠️ Could not process settings file: ${sanitizeErrorMessage(error, detectedSettingsFile)}`));
    }
  }

  // Get list of available projects for the user (with retry for transient failures)
  let availableProjects = [];
  try {
    const projectsResult = await executeCommandWithRetry('gcloud projects list --format="value(projectId)" --limit=20', {
      maxRetries: 2,
      baseDelay: 1500
    });
    if (projectsResult.stdout) {
      availableProjects = projectsResult.stdout.trim().split('\n').filter(p => p);
    }
  } catch (error) {
    // Silently ignore if we can't list projects
    verboseLog('Failed to fetch project list:', error.message);
  }
  
  // Collect configuration from user
  const questions = [];
  
  // Only ask for project ID if not auto-detected
  if (!autoDetectedConfig.projectId) {
    if (availableProjects.length > 0) {
      console.log(chalk.blue('\n📦 Available Google Cloud Projects:'));
      availableProjects.forEach(p => console.log(chalk.gray(`   - ${p}`)));
      console.log('');
    } else {
      console.log(chalk.yellow('\n⚠️ No existing projects found'));
      console.log(chalk.blue('Create a new project at: https://console.cloud.google.com/projectcreate'));
      console.log('');
    }
    
    questions.push({
      type: 'input',
      name: 'projectId',
      message: 'Google Cloud Project ID:',
      default: availableProjects.length > 0 ? availableProjects[0] : undefined,
      validate: (input) => {
        try {
          validateProjectId(input);
          return true;
        } catch (error) {
          return error.message;
        }
      }
    });
  }
  
  // Add remaining questions
  questions.push(
    {
      type: 'list',
      name: 'region',
      message: 'Google Cloud Region:',
      choices: [
        'us-central1',
        'us-east1', 
        'us-west1',
        'europe-west1',
        'asia-east1',
        'australia-southeast1'
      ],
      default: 'us-central1'
    },
    {
      type: 'input',
      name: 'mongoUrl',
      message: 'MongoDB connection URL (optional):',
      default: autoDetectedConfig.mongoUrl ? '[Detected from settings]' : '',
      when: !autoDetectedConfig.mongoUrl
    },
    {
      type: 'list',
      name: 'cpu',
      message: 'CPU allocation:',
      choices: [
        { name: '1 CPU (recommended for most apps)', value: '1' },
        { name: '2 CPU', value: '2' },
        { name: '4 CPU', value: '4' }
      ],
      default: '1'
    },
    {
      type: 'list',
      name: 'memory',
      message: 'Memory allocation:',
      choices: [
        { name: '256Mi', value: '256Mi' },
        { name: '512Mi (recommended)', value: '512Mi' },
        { name: '1Gi', value: '1Gi' },
        { name: '2Gi', value: '2Gi' },
        { name: '4Gi', value: '4Gi' }
      ],
      default: '512Mi'
    },
    {
      type: 'number',
      name: 'minInstances',
      message: 'Minimum instances (0 for scale-to-zero):',
      default: 0,
      validate: (input) => {
        if (input >= 0 && input <= 100) return true;
        return 'Must be between 0 and 100';
      }
    },
    {
      type: 'number', 
      name: 'maxInstances',
      message: 'Maximum instances:',
      default: 10,
      validate: (input) => {
        if (input >= 1 && input <= 1000) return true;
        return 'Must be between 1 and 1000';
      }
    },
    {
      type: 'number',
      name: 'concurrency',
      message: 'Concurrent requests per instance:',
      default: 80,
      validate: (input) => {
        if (input >= 1 && input <= 1000) return true;
        return 'Must be between 1 and 1000';
      }
    },
    {
      type: 'confirm',
      name: 'useCustomDomain',
      message: 'Do you want to configure a custom domain?',
      default: false
    },
    {
      type: 'input',
      name: 'customDomain',
      message: 'Enter your custom domain (e.g., app.example.com):',
      when: (answers) => answers.useCustomDomain,
      validate: (input) => {
        try {
          validateCustomDomain(input);
          return true;
        } catch (error) {
          return error.message;
        }
      }
    },
    {
      type: 'confirm',
      name: 'useStaticIP',
      message: 'Create a static outbound IP for MongoDB Atlas whitelisting?',
      default: true,
      when: (answers) => answers.useCustomDomain
    }
  );

  const answers = await inquirer.prompt(questions);
  
  // Use auto-detected project ID if available
  if (autoDetectedConfig.projectId && !answers.projectId) {
    answers.projectId = autoDetectedConfig.projectId;
  }

  // Validate inputs
  try {
    validateProjectId(answers.projectId);
    validateRegion(answers.region);
  } catch (error) {
    console.log(chalk.red(`❌ Configuration error: ${error.message}`));
    return;
  }

  // Detect actual Meteor version
  const { detectMeteorVersion } = require('./utils');
  const detectedMeteorVersion = await detectMeteorVersion();
  const finalMeteorVersion = detectedMeteorVersion || '2.12';
  
  if (detectedMeteorVersion) {
    console.log(chalk.blue(`📦 Detected Meteor version: ${detectedMeteorVersion}`));
  } else {
    console.log(chalk.yellow(`⚠️ Could not detect Meteor version, using default: ${finalMeteorVersion}`));
  }

  // Create final configuration
  const finalConfig = {
    projectId: answers.projectId,
    region: answers.region,
    meteorVersion: finalMeteorVersion,
    nodeVersion: '18',
    settingsFile: detectedSettingsFile,
    cpu: answers.cpu,
    memory: answers.memory,
    minInstances: answers.minInstances,
    maxInstances: answers.maxInstances,
    concurrency: answers.concurrency
  };

  // Add custom domain configuration if provided
  if (answers.useCustomDomain) {
    finalConfig.customDomain = answers.customDomain;
    finalConfig.useLoadBalancer = true;
    finalConfig.useManagedSSL = true; // Always use Google-managed SSL certificates
    finalConfig.useStaticIP = answers.useStaticIP !== false; // Default to true
  }

  // Store MongoDB URL temporarily for deployment configuration
  const mongoUrl = answers.mongoUrl || autoDetectedConfig.mongoUrl;
  
  // Debug: Check if we have a MongoDB URL
  if (mongoUrl && mongoUrl !== '[Detected from settings]') {
    verboseLog('MongoDB URL provided by user:', mongoUrl ? 'Yes' : 'No');
  } else if (autoDetectedConfig.mongoUrl) {
    verboseLog('MongoDB URL from settings:', 'Yes');
  } else {
    verboseLog('No MongoDB URL configured');
  }

  // Note: Settings files are processed during deployment for security
  // We only store the path reference, never the actual settings content

  // Create deployment configuration files
  await createDeploymentFiles(finalConfig, mongoUrl);

  console.log(chalk.green('✅ Meteor Cloud Run configuration initialized successfully!'));
  console.log(chalk.blue('📁 Generated files:'));
  console.log('   • .meteor-cloud-run/config.json (configuration)');
  console.log('   • .meteor-cloud-run/Dockerfile (container configuration)'); 
  console.log('   • .meteor-cloud-run/cloudbuild.yaml (build configuration)');
  console.log('   • .meteor-cloud-run/meteor-cloud-run-startup.sh (startup script)');
  console.log('   • .meteor-cloud-run/.dockerignore (build optimization)');
  console.log(chalk.yellow('\n🚀 Run "meteor-cloud-run deploy" to deploy your application to Cloud Run!'));
  
  // Cleanup authentication
  authManager.cleanup();
}

async function deployCommand(options) {
  if (options.verbose) {
    require('./utils').setVerboseMode(true);
    verboseLog('Verbose mode enabled');
  }
  console.log(chalk.blue('🚀 Deploying your Meteor.js application to Cloud Run...'));

  // Setup authentication
  const authManager = new AuthManager();
  try {
    // Try to get global options from process.argv since we can't access program directly
    const globalOptions = {};
    const argv = process.argv;
    
    // Parse global options from command line
    const projectIndex = argv.indexOf('--project');
    if (projectIndex !== -1 && argv[projectIndex + 1]) {
      globalOptions.project = argv[projectIndex + 1];
    }
    
    const serviceAccountIndex = argv.indexOf('--service-account-key');
    if (serviceAccountIndex !== -1 && argv[serviceAccountIndex + 1]) {
      globalOptions.serviceAccountKey = argv[serviceAccountIndex + 1];
    }
    
    await authManager.setupAuthentication({
      serviceAccountKey: globalOptions.serviceAccountKey,
      projectId: globalOptions.project
    });
    
    verboseLog('Authentication setup completed');
  } catch (error) {
    console.log(chalk.red('❌ Authentication failed:'));
    console.log(error.message);
    
    // Show CI setup instructions if in CI environment
    const ciEnv = authManager.detectCIEnvironment();
    if (ciEnv.detected) {
      console.log(chalk.yellow('\n🚀 CI/CD Setup Instructions:'));
      console.log(authManager.getCISetupInstructions(ciEnv));
    }
    
    authManager.cleanup();
    process.exit(1);
  }
  
  // Check if configuration exists
  const configPath = getConfigFilePath();
  if (!fs.existsSync(configPath)) {
    console.log(chalk.red('❌ Configuration not found. Please run "meteor-cloud-run init" first.'));
    return;
  }

  // Read configuration
  let config = await fs.readJson(configPath);
  const serviceName = getServiceName(config);

  // Handle custom settings file if provided
  if (options.settings) {
    console.log(chalk.blue(`🔧 Using custom settings file: ${options.settings}`));
    
    try {
      const validatedPath = validateSettingsPath(options.settings);
      if (!fs.existsSync(validatedPath)) {
        console.log(chalk.red(`❌ Specified settings file not found: ${options.settings}`));
        return;
      }
      options.settings = validatedPath;
    } catch (error) {
      console.log(chalk.red(`❌ Invalid settings path: ${sanitizeErrorMessage(error)}`));
      return;
    }
    
    try {
      // First, migrate Galaxy settings to Meteor Cloud Run format if needed
      const migrated = await migrateSettingsToMeteorCloudRun(options.settings);
      if (migrated) {
        console.log(chalk.green(`✅ Migrated Galaxy settings to Meteor Cloud Run format in ${options.settings}`));
        console.log(chalk.blue(`   📝 Environment variables are now in "meteor-cloud-run.env" for easier management`));
      }
      
      const customSettings = await fs.readJson(options.settings);
      const autoDetectedConfig = await extractConfigFromSettings(customSettings);
      
      // Update config with new settings (excluding sensitive data)
      if (autoDetectedConfig.projectId) config.projectId = autoDetectedConfig.projectId;
      if (autoDetectedConfig.rootUrl) config.rootUrl = autoDetectedConfig.rootUrl;
      
      // Update settings file path only - never store actual settings
      config.settingsFile = options.settings;
      
      // Save clean configuration without any settings content
      const cleanConfig = { ...config };
      await fs.writeJson(getConfigFilePath(), cleanConfig, { spaces: 2 });
      
      // Extract MongoDB URL for deployment files generation
      const mongoUrl = autoDetectedConfig.mongoUrl;
      
      // Regenerate deployment files with new settings
      await createDeploymentFiles(config, mongoUrl);
      
      console.log(chalk.green(`✅ Configuration updated with settings from ${options.settings}`));
    } catch (error) {
      console.log(chalk.red(`❌ Failed to process settings file: ${sanitizeErrorMessage(error, options.settings)}`));
      return;
    }
  }

  // Extract MongoDB URL from existing config or settings
  let mongoUrl = null;
  let settingsFile = config.settingsFile;
  
  // Validate configured settings file path
  if (settingsFile) {
    // Resolve relative paths for existing config
    if (fs.existsSync(settingsFile)) {
      console.log(chalk.blue(`📄 Using configured settings file: ${settingsFile}`));
    } else {
      console.log(chalk.red(`❌ Configured settings file not found: ${settingsFile}`));
      console.log(chalk.yellow('💡 Either update the path in .meteor-cloud-run/config.json or use --settings <path>'));
      settingsFile = null;
    }
  } else {
    // No settings file configured - try backwards compatibility fallback
    console.log(chalk.blue('📄 No settings file configured, checking for common files...'));
    const fallbackFiles = ['settings.json', 'settings-production.json', 'settings-prod.json'];
    for (const file of fallbackFiles) {
      if (fs.existsSync(file)) {
        settingsFile = file;
        console.log(chalk.blue(`📄 Found settings file: ${file} (consider adding to config for explicit control)`));
        break;
      }
    }

    if (!settingsFile) {
      console.log(chalk.yellow('💡 No settings file found. Use --settings <path> to specify one, or add "settingsFile" to your config.'));
    }
  }
  
  if (settingsFile && fs.existsSync(settingsFile)) {
    try {
      // First, migrate Galaxy settings to Meteor Cloud Run format if needed
      const migrated = await migrateSettingsToMeteorCloudRun(settingsFile);
      if (migrated) {
        console.log(chalk.green(`✅ Migrated Galaxy settings to Meteor Cloud Run format in ${settingsFile}`));
        console.log(chalk.blue(`   📝 Environment variables are now in "meteor-cloud-run.env" for easier management`));
      }
      
      console.log(chalk.blue(`📄 Reading settings from: ${settingsFile}`));
      const settingsData = await fs.readJson(settingsFile);
      const autoDetectedConfig = await extractConfigFromSettings(settingsData);
      mongoUrl = autoDetectedConfig.mongoUrl;
      
      // Extract additional environment variables for deployment
      if (autoDetectedConfig.mongoOplogUrl) config.mongoOplogUrl = autoDetectedConfig.mongoOplogUrl;
      if (autoDetectedConfig.mailUrl) config.mailUrl = autoDetectedConfig.mailUrl;
      if (autoDetectedConfig.httpForwardedCount) config.httpForwardedCount = autoDetectedConfig.httpForwardedCount;
      if (autoDetectedConfig.disableWebsockets) config.disableWebsockets = autoDetectedConfig.disableWebsockets;
      
      // Add all additional environment variables from Galaxy or other sources
      if (autoDetectedConfig.additionalEnvVars) {
        config.additionalEnvVars = autoDetectedConfig.additionalEnvVars;
        const envVarCount = Object.keys(autoDetectedConfig.additionalEnvVars).length;
        console.log(chalk.green(`✅ Additional environment variables configured: ${envVarCount}`));
        Object.keys(autoDetectedConfig.additionalEnvVars).forEach(key => {
          console.log(chalk.blue(`   • ${key}`));
        });
      }
      
      // Store settings temporarily in memory for this deployment only
      config.rawSettings = settingsData;
    } catch (error) {
      console.log(chalk.yellow(`⚠️ Could not read settings file: ${sanitizeErrorMessage(error, settingsFile)}`));
    }
  } else {
    // No settings file configured or found
    console.log(chalk.yellow('⚠️ No settings file configured. METEOR_SETTINGS will not be available.'));
    console.log(chalk.blue('💡 To configure environment variables and secrets:'));
    console.log(chalk.blue('   • Add "settingsFile": "<relative-path>" to .meteor-cloud-run/config.json'));
    console.log(chalk.blue('   • Or use --settings <path> with the deploy command'));
    console.log(chalk.blue('   • Your app will run with minimal environment (just ROOT_URL)'));
  }
  
  // Debug: Show detected environment variables
  if (!mongoUrl) {
    console.log(chalk.yellow('⚠️ No MongoDB URL detected. Your app may fail to start without a database connection.'));
    console.log(chalk.blue('💡 Add a MONGO_URL to your settings.json file in one of these sections: meteor-cloud-run.env, galaxy.meteor.com.env, or env'));
  } else {
    console.log(chalk.green(`✅ MongoDB URL configured: ${obfuscateCredential(mongoUrl, 10)}`));
  }
  
  // Show additional detected environment variables
  if (config.mongoOplogUrl) {
    console.log(chalk.green(`✅ MongoDB Oplog URL configured: ${obfuscateCredential(config.mongoOplogUrl, 10)}`));
  }
  if (config.mailUrl) {
    console.log(chalk.green(`✅ Mail URL configured: ${obfuscateCredential(config.mailUrl, 10)}`));
  }
  if (config.httpForwardedCount) {
    console.log(chalk.green(`✅ HTTP Forwarded Count: ${config.httpForwardedCount}`));
  }
  if (config.disableWebsockets) {
    console.log(chalk.green(`✅ WebSockets disabled: ${config.disableWebsockets}`));
  }
  // Apply default values if missing
  if (!config.cpu) config.cpu = '1';
  if (!config.memory) config.memory = '256Mi';
  if (!config.minInstances) config.minInstances = 0;
  if (!config.maxInstances) config.maxInstances = 10; // Higher for WebSocket connection spikes
  if (!config.concurrency) config.concurrency = 80; // Optimized for Cloud Run performance
  // Set a generic placeholder rootUrl for initial deployment, we'll get the actual one after deployment
  if (!config.rootUrl) config.rootUrl = `https://placeholder.run.app`;
  
  // Check for domain mapping migration opportunity (unless skipped)
  if (!options.skipMigration) {
    verboseLog('Checking for domain mapping migration opportunities...');
    try {
      const originalConfig = { ...config };
      config = await migrateDomainMapping(config);
      
      // Save updated configuration if migration occurred
      if (config.loadBalancerResources && !originalConfig.loadBalancerResources) {
        const cleanConfig = { ...config };
        delete cleanConfig.rawSettings; // Never store raw settings
        await fs.writeJson(getConfigFilePath(), cleanConfig, { spaces: 2 });
        console.log(chalk.green('✅ Configuration updated with load balancer resources'));
      }
    } catch (error) {
      console.log(chalk.yellow(`⚠️ Migration check failed: ${sanitizeErrorMessage(error)}`));
      console.log(chalk.blue('Continuing with existing configuration...'));
    }
  } else {
    verboseLog('Skipping domain mapping migration check (--skip-migration)');
  }
  
  // Handle settings upload if needed
  let settingsInfo = null;
  if (config.rawSettings) {
    console.log(chalk.green(`✅ METEOR_SETTINGS configured via secure GCS bucket (${Object.keys(config.rawSettings).length} keys)`));
    console.log(chalk.blue(`🔒 Settings are never stored in configuration files`));
    console.log(chalk.blue(`📦 Temporary bucket will be automatically cleaned up after deployment`));
    
    // Upload settings to GCS before build submission
    try {
      settingsInfo = await uploadSettingsToGCS(config.projectId, config.rawSettings);
      console.log(chalk.green(`🔒 Settings uploaded securely (never stored in configuration files)`));
    } catch (error) {
      console.log(chalk.red(`❌ Failed to upload settings: ${error.message}`));
      return;
    }
    
    // Remove raw settings from config to prevent any leakage
    delete config.rawSettings;
  }

  // Regenerate deployment files with current configuration and settings info
  await createCloudBuildConfig(config, mongoUrl, settingsInfo);

  // Configuration is handled via environment variables (simple approach)
  console.log(chalk.blue('✅ Using environment variables for configuration'));

  // Execute deployment steps
  try {
    // Enable required APIs
    console.log(chalk.blue('📡 Enabling required APIs...'));
    await executeCommandVerbose(`gcloud services enable cloudbuild.googleapis.com run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com storage.googleapis.com compute.googleapis.com cloudresourcemanager.googleapis.com serviceusage.googleapis.com --project=${config.projectId}`, 'Enable required Google Cloud APIs');
    
    // Ensure default service accounts have necessary permissions
    console.log(chalk.blue('🔐 Configuring service account permissions...'));
    try {
      // Get project number for service account names
      const projectNumberResult = await executeCommand(`gcloud projects describe ${config.projectId} --format="value(projectNumber)"`);
      const projectNumber = projectNumberResult.stdout.trim();
      
      if (projectNumber) {
        // Grant permissions to Cloud Build service account
        const cloudBuildSA = `${projectNumber}@cloudbuild.gserviceaccount.com`;
        const computeSA = `${projectNumber}-compute@developer.gserviceaccount.com`;
        
        // Check if permissions are already granted
        const iamPolicyResult = await executeCommand(`gcloud projects get-iam-policy ${config.projectId} --format=json`);
        const iamPolicy = JSON.parse(iamPolicyResult.stdout);
        
        // Check if Cloud Build SA has Editor role
        const cloudBuildHasEditor = iamPolicy.bindings?.some(binding => 
          binding.role === 'roles/editor' && 
          binding.members?.includes(`serviceAccount:${cloudBuildSA}`)
        );
        
        // Check if Compute SA has Editor role
        const computeHasEditor = iamPolicy.bindings?.some(binding => 
          binding.role === 'roles/editor' && 
          binding.members?.includes(`serviceAccount:${computeSA}`)
        );
        
        if (!cloudBuildHasEditor) {
          console.log(chalk.yellow(`  Granting Editor role to Cloud Build service account...`));
          await executeCommand(`gcloud projects add-iam-policy-binding ${config.projectId} --member="serviceAccount:${cloudBuildSA}" --role="roles/editor" --condition=None`);
          console.log(chalk.green(`  ✅ Cloud Build service account configured`));
        } else {
          verboseLog(`  Cloud Build service account already has Editor role`);
        }
        
        if (!computeHasEditor) {
          console.log(chalk.yellow(`  Granting Editor role to Compute service account...`));
          await executeCommand(`gcloud projects add-iam-policy-binding ${config.projectId} --member="serviceAccount:${computeSA}" --role="roles/editor" --condition=None`);
          console.log(chalk.green(`  ✅ Compute service account configured`));
        } else {
          verboseLog(`  Compute service account already has Editor role`);
        }
        
        if (cloudBuildHasEditor && computeHasEditor) {
          console.log(chalk.green('✅ Service accounts already configured'));
        }
      }
    } catch (permError) {
      // If we can't grant permissions, warn but continue
      console.log(chalk.yellow('⚠️ Could not automatically configure service account permissions'));
      console.log(chalk.yellow('   You may need to manually grant Editor role to the default service accounts'));
      console.log(chalk.yellow('   See the README for manual configuration steps'));
      verboseLog(`Permission error: ${permError.message}`);
    }

    // Pre-grant Secret Manager permissions to avoid deployment failures
    if (mongoUrl) {
      try {
        const serviceName = getServiceName(config);
        const secretName = getSecretName(serviceName, 'mongodb-url');
        
        // Get project number for service account
        const projectNumberResult = await executeCommand(`gcloud projects describe ${config.projectId} --format="value(projectNumber)"`);
        const projectNumber = projectNumberResult.stdout.trim();
        
        if (projectNumber) {
          console.log(chalk.blue('🔐 Pre-configuring Secret Manager permissions...'));
          const serviceAccount = `${projectNumber}-compute@developer.gserviceaccount.com`;
          
          await executeCommand(`gcloud secrets add-iam-policy-binding ${secretName} --member="serviceAccount:${serviceAccount}" --role="roles/secretmanager.secretAccessor" --project=${config.projectId} || echo "Note: IAM permissions will be handled during deployment"`);
          console.log(chalk.green('✅ Secret Manager permissions configured'));
        }
      } catch (error) {
        console.log(chalk.yellow('⚠️ Could not pre-configure Secret Manager permissions. Will be handled during deployment.'));
      }
    }

    // Deploy using Cloud Build (rolling deployment - zero downtime)
    console.log(chalk.blue('🏗️  Building and deploying your application...'));
    verboseLog('Starting Cloud Build process...');
    verboseLog(`Using project ID: ${config.projectId}`);
    
    // Build substitutions for secure credential passing (must use underscore prefix)
    let substitutions = [];
    if (mongoUrl) {
      substitutions.push(`_MONGO_URL=${mongoUrl}`);
    }
    if (config.mongoOplogUrl) {
      substitutions.push(`_MONGO_OPLOG_URL=${config.mongoOplogUrl}`);
    }
    if (config.mailUrl) {
      substitutions.push(`_MAIL_URL=${config.mailUrl}`);
    }
    
    
    // Validate that required substitutions are provided
    const cloudbuildContent = require('fs').readFileSync('.meteor-cloud-run/cloudbuild.yaml', 'utf8');
    if (cloudbuildContent.includes('$_MONGO_URL') && !substitutions.find(s => s.startsWith('_MONGO_URL='))) {
      console.log(chalk.red('❌ Cloud Build requires MONGO_URL but no MongoDB credentials found!'));
      console.log(chalk.yellow('💡 Please ensure your settings file contains MONGO_URL in one of these formats:'));
      console.log('   • { "meteor-cloud-run": { "env": { "MONGO_URL": "mongodb://..." } } }');
      console.log('   • { "galaxy.meteor.com": { "env": { "MONGO_URL": "mongodb://..." } } }');
      console.log('   • { "env": { "MONGO_URL": "mongodb://..." } }');
      return;
    }
    
    // Submit with substitutions to avoid plaintext credentials in YAML
    // Use --stream-logs to force log output to stdout (fixes CI/CD detection)
    let buildCommand = `gcloud builds submit --config=.meteor-cloud-run/cloudbuild.yaml --project=${config.projectId} --stream-logs`;
    if (substitutions.length > 0) {
      buildCommand += ` --substitutions=${escapeShellArg(substitutions.join(','))}`;
      verboseLog(`Using secure substitutions for: ${substitutions.map(s => s.split('=')[0].replace('_', '')).join(', ')}`);
    }
    
    // Execute build with streaming output for better user feedback
    console.log(chalk.gray('   📦 Building container image...'));
    console.log(chalk.gray('   🚀 Deploying to Cloud Run...'));
    console.log(chalk.gray('   ⏳ This process typically takes 3-5 minutes'));
    console.log('');
    
    // Stream the build logs to show progress
    await executeCommandStreaming(buildCommand);

    // Access configuration is handled by --allow-unauthenticated flag in cloudbuild.yaml
    console.log(chalk.blue('🔐 Access permissions configured...'));
    console.log(chalk.green('   ✅ Service deployed with public access enabled'));
    
    if (config.useLoadBalancer && config.customDomain) {
      console.log(chalk.blue(`   🌐 Your app will be accessible at: https://${config.customDomain}`));
    }

    console.log(chalk.green('✅ Deployment completed successfully!'));
    
    // Get the actual deployed URL and update ROOT_URL if different
    try {
      verboseLog('Fetching actual deployed URL...');
      // First try to get the deterministic URL from the urls annotation
      const urlsResult = await executeCommand(`gcloud run services describe ${serviceName} --region=${config.region} --project=${config.projectId} --format="value(metadata.annotations.'run.googleapis.com/urls')"`);
      let actualUrl = null;
      
      if (urlsResult.stdout.trim()) {
        try {
          // Parse the URLs array and get the deterministic URL (first one)
          const urlsArray = JSON.parse(urlsResult.stdout.trim());
          if (urlsArray && urlsArray.length > 0) {
            // The deterministic URL is typically the first one and contains the project number
            actualUrl = urlsArray.find(url => url.includes(config.region)) || urlsArray[0];
          }
        } catch (parseError) {
          verboseLog('Failed to parse URLs annotation, falling back to status.url');
        }
      }
      
      // Fallback to the standard status.url if we couldn't get the deterministic URL
      if (!actualUrl) {
        const fallbackResult = await executeCommand(`gcloud run services describe ${serviceName} --region=${config.region} --project=${config.projectId} --format="value(status.url)"`);
        actualUrl = fallbackResult.stdout.trim();
      }
      
      verboseLog(`Actual URL from Cloud Run: ${actualUrl}`);
      verboseLog(`Config ROOT_URL: ${config.rootUrl}`);
      
      // Handle load balancer creation if custom domain is configured and resources don't exist yet
      if (config.customDomain && config.useLoadBalancer && !config.loadBalancerResources) {
        console.log(chalk.blue(`\n🌐 Setting up load balancer for custom domain: ${config.customDomain}`));
        try {
          config.serviceName = serviceName;
          const loadBalancerResources = await createLoadBalancer(config);
          
          // Update configuration with load balancer resources
          config.loadBalancerResources = loadBalancerResources;
          
          // If VPC connector was created, update Cloud Run service to use it
          if (loadBalancerResources.vpcConnectorName) {
            console.log(chalk.blue('🔗 Configuring Cloud Run to use VPC connector for static IP...'));
            try {
              await executeCommand(
                `gcloud run services update ${serviceName} ` +
                `--vpc-connector=${loadBalancerResources.vpcConnectorName} ` +
                `--vpc-egress=all-traffic ` +
                `--region=${config.region} ` +
                `--project=${config.projectId}`
              );
              console.log(chalk.green('✅ Cloud Run configured to use static outbound IP'));
              if (loadBalancerResources.natIpAddress) {
                console.log(chalk.green(`   MongoDB Atlas connections will use: ${loadBalancerResources.natIpAddress}`));
              }
            } catch (error) {
              console.log(chalk.yellow('⚠️ Failed to configure VPC connector, MongoDB connections may fail'));
              console.log(chalk.yellow(`   Error: ${error.message}`));
            }
          }
          
          // Save updated configuration with load balancer resources
          const cleanConfig = { ...config };
          delete cleanConfig.rawSettings; // Never store raw settings
          await fs.writeJson(getConfigFilePath(), cleanConfig, { spaces: 2 });
          
          // Update ROOT_URL to use custom domain
          actualUrl = `https://${config.customDomain}`;
          console.log(chalk.green(`✅ Load balancer configured for ${config.customDomain}`));
        } catch (error) {
          console.log(chalk.red(`❌ Failed to create load balancer: ${error.message}`));
          console.log(chalk.yellow('⚠️ Your application is still accessible via the default Cloud Run URL'));
        }
      } else if (config.customDomain && config.loadBalancerResources) {
        // Load balancer already exists (likely from migration or previous setup)
        console.log(chalk.green(`✅ Using existing load balancer for ${config.customDomain}`));
        actualUrl = `https://${config.customDomain}`;
        
        // Check if VPC connector needs to be configured
        if (config.loadBalancerResources.vpcConnectorName) {
          console.log(chalk.blue('🔗 Ensuring Cloud Run uses VPC connector for static IP...'));
          try {
            await executeCommand(
              `gcloud run services update ${serviceName} ` +
              `--vpc-connector=${config.loadBalancerResources.vpcConnectorName} ` +
              `--vpc-egress=all-traffic ` +
              `--region=${config.region} ` +
              `--project=${config.projectId}`
            );
            console.log(chalk.green('✅ Cloud Run configured to use static outbound IP'));
            if (config.loadBalancerResources.natIpAddress) {
              console.log(chalk.green(`   MongoDB Atlas connections will use: ${config.loadBalancerResources.natIpAddress}`));
            }
          } catch (error) {
            console.log(chalk.yellow('⚠️ Failed to configure VPC connector, MongoDB connections may fail'));
            console.log(chalk.yellow(`   Error: ${error.message}`));
          }
        }
      }
      
      if (actualUrl) {
        // Always update ROOT_URL with actual deployed URL
        console.log(chalk.blue('🔄 Updating ROOT_URL with actual deployed URL...'));
        
        // Update the service with the correct ROOT_URL
        const envVars = [`ROOT_URL=${actualUrl}`];
        if (settingsInfo) {
          envVars.push(`METEOR_SETTINGS_GCS_BUCKET=${settingsInfo.bucket}`);
          envVars.push(`METEOR_SETTINGS_GCS_FILE=${settingsInfo.file}`);
        }
        
        await executeCommand(`gcloud run services update ${serviceName} --region=${config.region} --project=${config.projectId} --set-env-vars=${envVars.join(',')}`);
        console.log(chalk.green('   ✅ ROOT_URL updated'));
        console.log(chalk.yellow(`\n🌐 Your application is now available at: ${actualUrl}`));
      } else {
        console.log(chalk.red('❌ Could not determine deployment URL'));
      }
    } catch (error) {
      verboseLog(`Error fetching actual URL: ${error.message}`);
      console.log(chalk.yellow('⚠️ Could not fetch deployment URL automatically. Check the Google Cloud Console for the service URL.'));
    }
    
    console.log(chalk.blue('🔒 Your application is using environment variables for configuration.'));
    
    if (options.settings) {
      console.log(chalk.blue(`📄 Deployed with custom settings from: ${options.settings}`));
    }


  } catch (error) {
    console.log(chalk.red('❌ Deployment failed:'), error.message);
    
    // Show build error details if available
    if (error.stderr) {
      const errorLines = error.stderr.split('\n').filter(line => line.trim());
      const relevantErrors = errorLines.filter(line => 
        line.includes('ERROR:') || 
        line.includes('error:') || 
        line.includes('failed') ||
        line.includes('Failed') ||
        line.includes('npm ERR!') ||
        line.includes('cannot find') ||
        line.includes('not found') ||
        line.includes('Permission denied') ||
        line.includes('unauthorized')
      );
      
      if (relevantErrors.length > 0) {
        console.log(chalk.red('\n📋 Build error details:'));
        relevantErrors.forEach(line => {
          console.log(chalk.gray('   ' + line));
        });
      }
    }
    
    // Try to get the build ID and suggest how to view logs
    if (error.stdout) {
      const buildIdMatch = error.stdout.match(/builds\/([a-f0-9-]+)/);
      if (buildIdMatch) {
        const buildId = buildIdMatch[1];
        console.log(chalk.yellow(`\n💡 To view detailed build logs, run:`));
        console.log(chalk.blue(`   gcloud builds log ${buildId} --project=${config.projectId}`));
      }
    }
    
    // Show verbose output if verbose mode is enabled
    if (isVerbose()) {
      if (error.stdout) {
        console.log(chalk.gray('\n=== Full stdout ==='));
        console.log(error.stdout);
      }
      if (error.stderr) {
        console.log(chalk.gray('\n=== Full stderr ==='));
        console.log(error.stderr);
      }
    } else {
      console.log(chalk.yellow('\n💡 Run with --verbose flag for more detailed error output'));
    }
    
    if (error.message.includes('permission')) {
      console.log(chalk.yellow('💡 Make sure you have the necessary permissions in your Google Cloud project.'));
      console.log('   Try running: gcloud auth login');
    }
    
    if (error.message.includes('quota')) {
      console.log(chalk.yellow('💡 You may have exceeded API quotas. Try again in a few minutes.'));
    }
    
    if (error.message.includes('billing')) {
      console.log(chalk.yellow('💡 Make sure billing is enabled for your Google Cloud project.'));
    }
    
    if (error.message.includes('domain')) {
      console.log(chalk.yellow('💡 If using a custom domain, make sure DNS is properly configured. Check deployment output for DNS records.'));
    }
    
    // Cleanup authentication on error
    authManager.cleanup();
  } finally {
    // Always cleanup authentication
    authManager.cleanup();
  }
}

// Export individual command functions and a registry
module.exports = {
  initCommand,
  deployCommand,
  
  // Command registry for easy access
  commands: {
    init: initCommand,
    deploy: deployCommand
  }
};