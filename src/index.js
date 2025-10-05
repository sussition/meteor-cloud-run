#!/usr/bin/env node

const { program } = require('commander');
const fs = require('fs-extra');
const path = require('path');
const inquirer = require('inquirer');
const chalk = require('chalk');

// Import modules
const { setVerboseMode, verboseLog, executeCommand, executeCommandVerbose, executeCommandWithRetry, getServiceName } = require('./utils');
const { processSettingsFile, extractConfigFromSettings } = require('./settings');
const { createDeploymentFiles } = require('./fileGeneration');
const { initCommand, deployCommand } = require('./commands');
const { deleteLoadBalancer, checkLoadBalancerStatus } = require('./loadBalancer');
const { migrateDomainMapping } = require('./domainMappingMigration');
const AuthManager = require('./auth');

// Helper function to get config file path with fallback support
function getConfigFilePath() {
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

// Set up program metadata
program
  .name('meteor-cloud-run')
  .description('CLI tool to deploy Meteor.js applications to Google Cloud Run')
  .version('1.0.0')
  .option('--project <project-id>', 'Google Cloud project ID (overrides config/environment)')
  .option('--service-account-key <path-or-json>', 'Path to service account JSON file or base64/raw JSON');

// Init command
program
  .command('init')
  .description('Initialize deployment configuration for your Meteor.js application')
  .option('--settings <path>', 'Path to Meteor settings.json file')
  .option('--verbose', 'Enable verbose logging')
  .action(initCommand);

// List secrets command
program
  .command('list-secrets')
  .description('List all secrets used by your application')
  .action(async () => {
    console.log(chalk.blue('📋 Listing application secrets...'));

    // Check if configuration exists
    const configPath = getConfigFilePath();
    if (!fs.existsSync(configPath)) {
      console.log(chalk.red('❌ Configuration not found. Please run "meteor-cloud-run init" first.'));
      return;
    }

    // Read configuration
    const config = await fs.readJson(configPath);

    try {
      // List secrets
      const result = await executeCommand(`gcloud secrets list --filter="name:meteor-cloud-run-*" --format="table(name,createTime)"`);
      console.log(result.stdout);

      console.log(chalk.green('✅ Secrets listed successfully!'));
      console.log(chalk.blue('💡 These secrets are automatically managed by Meteor Cloud Run.'));
    } catch (error) {
      console.log(chalk.red('❌ Failed to list secrets:'), error.message);
    }
  });




// Note: import-settings command removed - use 'meteor-cloud-run deploy --settings <file>' instead
// The deploy command already handles settings files with the --settings flag

// Deploy command
program
  .command('deploy')
  .description('Deploy your Meteor.js application to Google Cloud Run')
  .option('--settings <path>', 'Path to Meteor settings.json file (overrides existing configuration)')
  .option('--skip-migration', 'Skip automatic domain mapping migration check')
  .option('--verbose', 'Enable verbose logging')
  .action(deployCommand);

// Migrate domain command
program
  .command('migrate-domain')
  .description('Migrate existing domain mapping to static IP load balancer')
  .option('--verbose', 'Enable verbose logging')
  .action(async (options) => {
    if (options.verbose) {
      setVerboseMode(true);
      verboseLog('Verbose mode enabled');
    }
    
    console.log(chalk.blue('🔄 Migrating domain mapping to static IP load balancer...'));
    
    // Check if configuration exists
    const configPath = getConfigFilePath();
    if (!fs.existsSync(configPath)) {
      console.log(chalk.red('❌ Configuration not found. Please run "meteor-cloud-run init" first.'));
      return;
    }

    // Read configuration
    let config = await fs.readJson(configPath);
    
    // Setup authentication
    const authManager = new AuthManager();
    try {
      // Get global options
      const globalOptions = program.opts();
      
      await authManager.setupAuthentication({
        serviceAccountKey: globalOptions.serviceAccountKey,
        projectId: globalOptions.project || config.projectId
      });
      
      verboseLog('Authentication setup completed');
    } catch (error) {
      console.log(chalk.red('❌ Authentication failed:'));
      console.log(error.message);
      authManager.cleanup();
      process.exit(1);
    }

    try {
      // Force migration by setting the flag
      config.enableLoadBalancerMigration = true;
      
      // Perform migration
      const updatedConfig = await migrateDomainMapping(config);
      
      // Save updated configuration if migration occurred
      if (updatedConfig.loadBalancerResources) {
        const cleanConfig = { ...updatedConfig };
        await fs.writeJson(getConfigFilePath(), cleanConfig, { spaces: 2 });
        console.log(chalk.green('✅ Configuration updated with load balancer resources'));
        console.log(chalk.blue('🚀 Your domain has been migrated to use a static IP load balancer!'));
      } else {
        console.log(chalk.blue('ℹ️  No migration was performed.'));
      }
      
    } catch (error) {
      console.log(chalk.red('❌ Migration failed:'), error.message);
    } finally {
      authManager.cleanup();
    }
  });



// Info command
program
  .command('info')
  .description('Display information about current deployment and resources')
  .option('--verbose', 'Show detailed information')
  .action(async (options) => {
    console.log(chalk.blue('📊 Meteor Cloud Run Deployment Information\n'));
    
    // Check if configuration exists
    const configPath = getConfigFilePath();
    if (!fs.existsSync(configPath)) {
      console.log(chalk.red('❌ Configuration not found. Please run "meteor-cloud-run init" first.'));
      return;
    }

    // Read configuration
    const config = await fs.readJson(configPath);
    const serviceName = getServiceName(config);
    
    if (options.verbose) {
      setVerboseMode(true);
    }
    
    console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
    console.log(chalk.cyan.bold('  Configuration'));
    console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
    console.log(`  📦 Service Name:     ${chalk.white(serviceName)}`);
    console.log(`  🚀 Project ID:       ${chalk.white(config.projectId)}`);
    console.log(`  🌍 Region:           ${chalk.white(config.region)}`);
    console.log(`  🎯 Meteor Version:   ${chalk.white(config.meteorVersion || 'auto-detect')}`);
    console.log(`  💾 Memory:           ${chalk.white(config.memory || '512Mi')}`);
    console.log(`  ⚡ CPU:              ${chalk.white(config.cpu || '1')}`);
    console.log(`  📈 Max Instances:    ${chalk.white(config.maxInstances || '10')}`);
    console.log(`  📉 Min Instances:    ${chalk.white(config.minInstances || '0')}`);
    
    if (config.customDomain) {
      console.log(`  🌐 Custom Domain:    ${chalk.white(config.customDomain)}`);
    }
    
    console.log('');
    
    try {
      // Check Cloud Run service status
      console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
      console.log(chalk.cyan.bold('  Cloud Run Service'));
      console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
      
      try {
        const serviceResult = await executeCommandWithRetry(
          `gcloud run services describe ${serviceName} --region=${config.region} --project=${config.projectId} --format=json`,
          { maxRetries: 2, baseDelay: 1000 }
        );
        
        const serviceInfo = JSON.parse(serviceResult.stdout);
        const status = serviceInfo.status?.conditions?.[0];
        const serviceUrl = serviceInfo.status?.url || 'Not available';
        const lastRevision = serviceInfo.status?.latestReadyRevisionName || 'Unknown';
        const createdTime = serviceInfo.metadata?.creationTimestamp || 'Unknown';
        
        console.log(`  ✅ Status:           ${chalk.green(status?.status === 'True' ? 'Running' : status?.message || 'Unknown')}`);
        console.log(`  🔗 Service URL:      ${chalk.blue.underline(serviceUrl)}`);
        console.log(`  📝 Latest Revision:  ${chalk.white(lastRevision)}`);
        console.log(`  📅 Created:          ${chalk.white(new Date(createdTime).toLocaleString())}`);
        
        // Get traffic allocation
        if (serviceInfo.status?.traffic) {
          console.log(`  🚦 Traffic:`);
          serviceInfo.status.traffic.forEach(t => {
            console.log(`     - ${t.revisionName}: ${t.percent}%`);
          });
        }
      } catch (error) {
        if (error.message.includes('NOT_FOUND')) {
          console.log(`  ❌ Service not deployed`);
        } else {
          console.log(`  ⚠️ Unable to fetch service details: ${error.message}`);
        }
      }
      
      console.log('');
      
      // Check load balancer status if custom domain is configured
      if (config.customDomain && config.useLoadBalancer) {
        console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
        console.log(chalk.cyan.bold('  Load Balancer & Custom Domain'));
        console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
        
        try {
          // Check static IP
          const ipName = `${serviceName}-ip`;
          const ipResult = await executeCommandWithRetry(
            `gcloud compute addresses describe ${ipName} --global --project=${config.projectId} --format="value(address,status)"`,
            { maxRetries: 2, baseDelay: 1000 }
          );
          const [ipAddress, ipStatus] = ipResult.stdout.trim().split('\t');
          
          console.log(`  🌐 Domain:           ${chalk.white(config.customDomain)}`);
          console.log(`  📍 Static IP:        ${chalk.white(ipAddress)} (${ipStatus})`);
          
          // Check SSL certificate status
          const certName = `${serviceName}-ssl-cert`;
          try {
            const certResult = await executeCommandWithRetry(
              `gcloud compute ssl-certificates describe ${certName} --global --project=${config.projectId} --format=json`,
              { maxRetries: 2, baseDelay: 1000 }
            );
            const certInfo = JSON.parse(certResult.stdout);
            const sslStatus = certInfo.managed?.status || 'Unknown';
            const domainStatus = certInfo.managed?.domainStatus || {};
            
            console.log(`  🔒 SSL Status:       ${sslStatus === 'ACTIVE' ? chalk.green('Active') : chalk.yellow(sslStatus)}`);
            
            if (Object.keys(domainStatus).length > 0) {
              console.log(`  📋 Domain Status:`);
              Object.entries(domainStatus).forEach(([domain, status]) => {
                const statusColor = status === 'ACTIVE' ? chalk.green : chalk.yellow;
                console.log(`     - ${domain}: ${statusColor(status)}`);
              });
            }
          } catch (error) {
            console.log(`  🔒 SSL Certificate:  ${chalk.yellow('Not configured')}`);
          }
          
          // Check if NAT is configured for static outbound IP
          if (config.useStaticIP) {
            try {
              const natIpName = `${serviceName}-nat-ip`;
              const natIpResult = await executeCommandWithRetry(
                `gcloud compute addresses describe ${natIpName} --region=${config.region} --project=${config.projectId} --format="value(address,status)"`,
                { maxRetries: 2, baseDelay: 1000 }
              );
              const [natIpAddress, natIpStatus] = natIpResult.stdout.trim().split('\t');
              console.log(`  🔄 NAT Static IP:    ${chalk.white(natIpAddress)} (${natIpStatus})`);
              console.log(chalk.dim(`     (Use this IP for MongoDB Atlas whitelist)`));
            } catch (error) {
              // NAT IP might not exist
              verboseLog('NAT IP not found:', error.message);
            }
          }
          
        } catch (error) {
          console.log(`  ⚠️ Load balancer not configured or error fetching details`);
          verboseLog('Load balancer error:', error.message);
        }
      }
      
      console.log('');
      
      // Check secrets
      console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
      console.log(chalk.cyan.bold('  Secrets'));
      console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
      
      const secretNames = [`${serviceName}-mongodb-url`, `${serviceName}-mongodb-oplog-url`];
      let secretsFound = false;
      
      for (const secretName of secretNames) {
        try {
          const secretResult = await executeCommandWithRetry(
            `gcloud secrets describe ${secretName} --project=${config.projectId} --format="value(createTime,replication.automatic)"`,
            { maxRetries: 2, baseDelay: 1000 }
          );
          
          if (secretResult.stdout.trim()) {
            const [createTime] = secretResult.stdout.trim().split('\t');
            console.log(`  ✅ ${secretName}`);
            console.log(`     Created: ${new Date(createTime).toLocaleString()}`);
            
            // Get version count
            const versionsResult = await executeCommand(
              `gcloud secrets versions list ${secretName} --project=${config.projectId} --filter="state:ENABLED" --format="value(name)" | wc -l`
            );
            const versionCount = parseInt(versionsResult.stdout.trim()) || 0;
            console.log(`     Versions: ${versionCount}`);
            secretsFound = true;
          }
        } catch (error) {
          // Secret doesn't exist, skip
          verboseLog(`Secret ${secretName} not found:`, error.message);
        }
      }
      
      if (!secretsFound) {
        console.log(`  ℹ️ No secrets configured`);
      }
      
      console.log('');
      
      // Check Artifact Registry
      console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
      console.log(chalk.cyan.bold('  Container Images'));
      console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
      
      try {
        const imagesResult = await executeCommand(
          `gcloud artifacts docker images list ${config.region}-docker.pkg.dev/${config.projectId}/${serviceName} --project=${config.projectId} --format="value(IMAGE,CREATE_TIME)" --limit=3 --sort-by="~CREATE_TIME"`
        );
        
        if (imagesResult.stdout.trim()) {
          const images = imagesResult.stdout.trim().split('\n');
          console.log(`  📦 Recent images (${images.length} shown):`);
          images.forEach(image => {
            const [imagePath, createTime] = image.split('\t');
            const imageTag = imagePath.split(':').pop();
            console.log(`     - ${imageTag}: ${new Date(createTime).toLocaleString()}`);
          });
        } else {
          console.log(`  ℹ️ No container images found`);
        }
      } catch (error) {
        console.log(`  ℹ️ Artifact Registry repository not found`);
        verboseLog('Artifact Registry error:', error.message);
      }
      
      console.log('');
      console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
      
      // Show helpful commands
      console.log(chalk.dim('\n📝 Useful commands:'));
      console.log(chalk.dim(`  • View logs:     gcloud run logs read --service=${serviceName} --region=${config.region} --project=${config.projectId}`));
      console.log(chalk.dim(`  • Deploy:        meteor-cloud-run deploy`));
      if (config.customDomain) {
        console.log(chalk.dim(`  • You can check SSL status in the Google Cloud Console`));
      }
      
    } catch (error) {
      console.log(chalk.red('❌ Error fetching deployment information:'), error.message);
      if (options.verbose && error.stderr) {
        console.log(chalk.red('Error details:'), error.stderr);
      }
    }
  });

// Remove command
program
  .command('remove')
  .description('Remove Meteor Cloud Run resources and configuration')
  .option('--keep-files', 'Keep generated files (Dockerfile, cloudbuild.yaml) but remove cloud resources')
  .option('--service-only', 'Only remove the Cloud Run service (useful for fixing deployment conflicts)')
  .action(async (options) => {
    if (options.serviceOnly) {
      console.log(chalk.blue('🧹 Cleaning up Cloud Run service...'));
    } else {
      console.log(chalk.blue('🗑️ Removing Meteor Cloud Run deployment and configuration...'));
    }
    
    // Check if configuration exists
    const configPath = getConfigFilePath();
    if (!fs.existsSync(configPath)) {
      console.log(chalk.yellow('⚠️ No Meteor Cloud Run configuration found. Nothing to remove.'));
      return;
    }

    // Read configuration
    const config = await fs.readJson(configPath);
    const serviceName = getServiceName(config);
    
    if (options.serviceOnly) {
      // Simple service-only removal (like the old clean command)
      console.log(chalk.yellow('⚠️ This will remove:'));
      console.log(`  • Cloud Run service: ${serviceName}`);
    } else {
      // Full removal
      console.log(chalk.yellow('⚠️ This will permanently remove:'));
      console.log(`  • Cloud Run service: ${serviceName}`);
      console.log(`  • Artifact Registry repository: ${serviceName}`);
      if (config.customDomain) {
        console.log(`  • Domain mapping: ${config.customDomain}`);
      }
      if (config.loadBalancerResources) {
        console.log('  • Load balancer resources:');
        console.log(`    - Static IP: ${config.loadBalancerResources.staticIpName}`);
        console.log(`    - SSL certificate: ${config.loadBalancerResources.sslCertName}`);
        console.log(`    - Backend service, URL map, and forwarding rules`);
      }
      if (!options.keepFiles) {
        console.log('  • Generated files: .meteor-cloud-run/Dockerfile, .meteor-cloud-run/cloudbuild.yaml, .meteor-cloud-run/.dockerignore');
        console.log('  • Configuration: .meteor-cloud-run/config.json');
      }
    }
    
    // Confirm removal
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: options.serviceOnly ? 
          'Are you sure you want to remove the Cloud Run service?' :
          'Are you sure you want to proceed? This cannot be undone.',
        default: false
      }
    ]);
    
    if (!confirm) {
      console.log(chalk.blue('❌ Removal cancelled.'));
      return;
    }
    
    if (options.serviceOnly) {
      // Handle service-only removal (like the old clean command)
      try {
        await executeCommand(`gcloud run services delete ${serviceName} --region=${config.region} --quiet`);
        console.log(chalk.green('✅ Successfully removed Cloud Run service'));
        console.log(chalk.blue('💡 You can now run "meteor-cloud-run deploy" to create a fresh deployment'));
      } catch (error) {
        if (error.message.includes('NOT_FOUND')) {
          console.log(chalk.yellow('⚠️ No Cloud Run service found to clean up'));
        } else {
          console.log(chalk.red('❌ Failed to clean up service:'), error.message);
        }
      }
      return;
    }
    
    // Handle full removal
    let errorCount = 0;
    
    try {
      // Remove load balancer resources first (if they exist)
      if (config.loadBalancerResources) {
        console.log(chalk.blue('🔧 Removing load balancer resources...'));
        try {
          const lbErrorCount = await deleteLoadBalancer(config);
          errorCount += lbErrorCount || 0;
        } catch (error) {
          console.log(chalk.red('❌ Failed to remove load balancer resources:'), error.message);
          errorCount++;
        }
      }
      
      // Remove Cloud Run service
      console.log(chalk.blue('🧹 Removing Cloud Run service...'));
      try {
        await executeCommand(`gcloud run services delete ${serviceName} --region=${config.region} --quiet`);
        console.log(chalk.green('✅ Cloud Run service removed'));
      } catch (error) {
        if (error.message.includes('NOT_FOUND')) {
          console.log(chalk.yellow('⚠️ Cloud Run service not found (already removed)'));
        } else {
          console.log(chalk.red('❌ Failed to remove Cloud Run service:'), error.message);
          errorCount++;
        }
      }
      
      // Remove custom domain mapping if exists
      if (config.customDomain) {
        console.log(chalk.blue('🌐 Removing domain mapping...'));
        try {
          await executeCommand(`gcloud run domain-mappings delete --domain=${config.customDomain} --region=${config.region} --platform=managed --quiet`);
          console.log(chalk.green('✅ Domain mapping removed'));
        } catch (error) {
          if (error.message.includes('NOT_FOUND')) {
            console.log(chalk.yellow('⚠️ Domain mapping not found (already removed)'));
          } else {
            console.log(chalk.red('❌ Failed to remove domain mapping:'), error.message);
            errorCount++;
          }
        }
      }
      
      // Remove Artifact Registry repository
      console.log(chalk.blue('📦 Removing Artifact Registry repository...'));
      try {
        await executeCommand(`gcloud artifacts repositories delete ${serviceName} --location=${config.region} --quiet`);
        console.log(chalk.green('✅ Artifact Registry repository removed'));
      } catch (error) {
        if (error.message.includes('NOT_FOUND')) {
          console.log(chalk.yellow('⚠️ Artifact Registry repository not found (already removed)'));
        } else {
          console.log(chalk.red('❌ Failed to remove Artifact Registry repository:'), error.message);
          errorCount++;
        }
      }
      
      // Remove generated files if not keeping them
      if (!options.keepFiles) {
        console.log(chalk.blue('📄 Removing generated files...'));
        
        // Check for files in both old and new locations for backward compatibility
        const filesToRemove = ['Dockerfile', 'cloudbuild.yaml', '.dockerignore', 'meteor-cloud-run-startup.sh'];
        
        filesToRemove.forEach(file => {
          // Check new location first
          const newPath = path.join('.meteor-cloud-run', file);
          const oldPath = file;
          
          if (fs.existsSync(newPath)) {
            fs.unlinkSync(newPath);
            console.log(chalk.green(`✅ Removed ${newPath}`));
          } else if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
            console.log(chalk.green(`✅ Removed ${oldPath}`));
          } else {
            console.log(chalk.yellow(`⚠️ ${file} not found (already removed)`));
          }
        });
        
        // Remove config file and entire .meteor-cloud-run directory
        const configPath = getConfigFilePath();
        if (fs.existsSync(configPath)) {
          console.log(chalk.blue('⚙️ Removing Meteor Cloud Run configuration...'));
          fs.unlinkSync(configPath);
          console.log(chalk.green(`✅ Removed ${configPath}`));
        }
        
        // Remove .meteor-cloud-run directory if empty
        if (fs.existsSync('.meteor-cloud-run')) {
          try {
            fs.rmdirSync('.meteor-cloud-run');
            console.log(chalk.green('✅ Removed .meteor-cloud-run directory'));
          } catch (error) {
            console.log(chalk.yellow('⚠️ .meteor-cloud-run directory not empty, leaving it'));
          }
        }
      }
      
      // Summary
      if (errorCount === 0) {
        console.log(chalk.green('🎉 Meteor Cloud Run removal completed successfully!'));
        if (options.keepFiles) {
          console.log(chalk.blue('💡 Generated files have been kept. You can still use "meteor-cloud-run deploy" with existing configuration.'));
        } else {
          console.log(chalk.blue('💡 Your project has been completely cleaned of Meteor Cloud Run. You can run "meteor-cloud-run init" to start over.'));
        }
      } else {
        console.log(chalk.yellow(`⚠️ Meteor Cloud Run removal completed with ${errorCount} errors. Some resources may still exist.`));
        console.log(chalk.blue('💡 You can try running "meteor-cloud-run remove" again or manually clean up remaining resources.'));
      }
      
    } catch (error) {
      console.log(chalk.red('❌ Failed to remove Meteor Cloud Run resources:'), error.message);
    }
  });


// Parse and execute
program.parse();