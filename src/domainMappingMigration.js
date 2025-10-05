const chalk = require('chalk');
const inquirer = require('inquirer');
const { verboseLog, executeCommand, sanitizeErrorMessage } = require('./utils');
const { createLoadBalancer } = require('./loadBalancer');

/**
 * Detects if a deployment needs migration from domain mapping to load balancer
 * @param {Object} config - Meteor Cloud Run configuration
 * @returns {Object} Migration detection result
 */
async function detectMigrationNeeded(config) {
  const { projectId, customDomain, region } = config;
  
  // Skip if no custom domain configured
  if (!customDomain) {
    return {
      needed: false,
      reason: 'no_custom_domain'
    };
  }
  
  // Skip if already using load balancer
  if (config.loadBalancerResources) {
    return {
      needed: false,
      reason: 'already_using_load_balancer'
    };
  }
  
  try {
    // Check if domain mapping exists (old approach)
    const domainResult = await executeCommand(
      `gcloud run domain-mappings describe ${customDomain} --region=${region} --project=${projectId} --format="value(metadata.name)" 2>/dev/null || echo ""`
    );
    
    const hasDomainMapping = domainResult.stdout.trim() !== '';
    
    if (hasDomainMapping) {
      verboseLog(`Found existing domain mapping for ${customDomain}`);
      return {
        needed: true,
        reason: 'has_domain_mapping',
        domainMapping: customDomain
      };
    }
    
    return {
      needed: false,
      reason: 'no_existing_domain_mapping'
    };
    
  } catch (error) {
    verboseLog(`Error checking domain mapping: ${error.message}`);
    return {
      needed: false,
      reason: 'check_failed',
      error: error.message
    };
  }
}

/**
 * Prompts user for migration confirmation
 * @param {Object} config - Meteor Cloud Run configuration
 * @param {Object} migrationInfo - Migration detection result
 * @returns {Boolean} User confirmation
 */
/**
 * Checks migration configuration to determine if migration should proceed
 * Uses configuration flags instead of user prompts for CI/CD compatibility
 * @param {Object} config - Meteor Cloud Run configuration
 * @param {Object} migrationInfo - Migration detection info
 * @returns {boolean} Whether migration should proceed
 */
function checkMigrationConfig(config, migrationInfo) {
  // Only check migration for deployments that actually need it
  if (!migrationInfo.needed) {
    return false;
  }
  
  // Check if migration is explicitly enabled in config
  const migrationEnabled = config.enableLoadBalancerMigration === true;
  
  // Only use useLoadBalancer if we don't already have load balancer resources
  // This prevents triggering migration for fresh deployments
  const useLoadBalancerWithoutResources = config.useLoadBalancer === true && !config.loadBalancerResources;
  
  // If migration is explicitly enabled OR useLoadBalancer is true for legacy deployment, proceed
  if (migrationEnabled || useLoadBalancerWithoutResources) {
    verboseLog('Migration enabled via configuration');
    console.log(chalk.blue('\n🔄 Domain Mapping Migration Enabled'));
    console.log(chalk.yellow('Upgrading from domain mapping to static IP load balancer...'));
    console.log(chalk.green('Benefits: Static outbound IP, better performance, enhanced SSL management'));
    return true;
  }
  
  // Provide guidance only when migration is actually available
  console.log(chalk.blue('\n🔍 Domain mapping detected for:', config.customDomain));
  console.log(chalk.cyan('💡 To upgrade to static IP load balancer, add to .meteor-cloud-run/config.json:'));
  console.log(chalk.dim('   "enableLoadBalancerMigration": true'));
  console.log(chalk.dim('   "createStaticOutboundIp": true  // Optional: for MongoDB Atlas'));
  verboseLog('Migration not enabled in configuration. Skipping automatic migration.');
  return false;
}

/**
 * Gets information about existing domain mapping
 * @param {Object} config - Meteor Cloud Run configuration
 * @returns {Object} Domain mapping information
 */
async function getDomainMappingInfo(config) {
  const { projectId, customDomain, region } = config;
  
  try {
    // Get domain mapping details
    const domainResult = await executeCommand(
      `gcloud run domain-mappings describe ${customDomain} --region=${region} --project=${projectId} --format="json"`
    );
    
    const domainMapping = JSON.parse(domainResult.stdout);
    
    return {
      exists: true,
      name: domainMapping.metadata.name,
      status: domainMapping.status,
      resourceRecords: domainMapping.status.resourceRecords || []
    };
    
  } catch (error) {
    verboseLog(`Error getting domain mapping info: ${error.message}`);
    return {
      exists: false,
      error: error.message
    };
  }
}

/**
 * Removes existing domain mapping
 * @param {Object} config - Meteor Cloud Run configuration
 * @returns {Boolean} Success status
 */
async function removeExistingDomainMapping(config) {
  const { projectId, customDomain, region } = config;
  
  try {
    console.log(chalk.blue(`🧹 Removing existing domain mapping for ${customDomain}...`));
    
    await executeCommand(
      `gcloud run domain-mappings delete ${customDomain} --region=${region} --project=${projectId} --quiet`
    );
    
    console.log(chalk.green('✅ Domain mapping removed successfully'));
    return true;
    
  } catch (error) {
    if (error.message.includes('NOT_FOUND')) {
      console.log(chalk.yellow('⚠️ Domain mapping not found (already removed)'));
      return true;
    } else {
      console.log(chalk.red(`❌ Failed to remove domain mapping: ${sanitizeErrorMessage(error)}`));
      return false;
    }
  }
}

/**
 * Performs the complete migration process
 * @param {Object} config - Meteor Cloud Run configuration
 * @returns {Object} Migration result
 */
async function performMigration(config) {
  console.log(chalk.blue('\n🚀 Starting domain mapping migration...'));
  
  const migrationResult = {
    success: false,
    loadBalancerResources: null,
    error: null,
    rollbackNeeded: false
  };
  
  try {
    // Step 1: Get existing domain mapping info for potential rollback
    const domainMappingInfo = await getDomainMappingInfo(config);
    verboseLog(`Domain mapping info: ${JSON.stringify(domainMappingInfo, null, 2)}`);
    
    // Step 2: Create new load balancer with config-based settings
    console.log(chalk.blue('🔧 Creating load balancer resources...'));
    config.useLoadBalancer = true;
    config.useManagedSSL = true;
    config.useStaticIP = true;
    // Use createStaticOutboundIp from config if specified, default to false
    config.createStaticOutboundIp = config.createStaticOutboundIp || false;
    
    const loadBalancerResources = await createLoadBalancer(config);
    migrationResult.loadBalancerResources = loadBalancerResources;
    migrationResult.rollbackNeeded = true; // We now have resources that might need cleanup
    
    console.log(chalk.green('✅ Load balancer created successfully'));
    
    // Step 3: Remove old domain mapping
    const removalSuccess = await removeExistingDomainMapping(config);
    
    if (!removalSuccess) {
      throw new Error('Failed to remove existing domain mapping');
    }
    
    // Step 4: Display new DNS configuration
    console.log(chalk.blue('\n📌 DNS Configuration Update Required:'));
    console.log(chalk.yellow('Your DNS configuration needs to be updated!'));
    console.log(`\nOld setup: ${config.customDomain} → Cloud Run domain mapping`);
    console.log(`New setup: ${config.customDomain} → Static IP ${loadBalancerResources.ipAddress}`);
    console.log(`\nUpdate your DNS record:`);
    console.log(`  Type: A`);
    console.log(`  Name: ${config.customDomain}`);
    console.log(`  Value: ${loadBalancerResources.ipAddress}`);
    
    if (loadBalancerResources.natIpAddress) {
      console.log(chalk.blue('\n🌐 Static Outbound IP Configuration:'));
      console.log(`Your application will use this static IP for outbound connections:`);
      console.log(`  Static IP: ${loadBalancerResources.natIpAddress}`);
      console.log(`\n💡 Add this IP to your MongoDB Atlas Network Access whitelist: ${loadBalancerResources.natIpAddress}`);
    }
    
    console.log(chalk.dim('\nNote: DNS propagation may take up to 48 hours'));
    console.log(chalk.dim('SSL certificate provisioning may take up to 30 minutes'));
    
    migrationResult.success = true;
    return migrationResult;
    
  } catch (error) {
    migrationResult.error = error.message;
    console.log(chalk.red(`❌ Migration failed: ${sanitizeErrorMessage(error)}`));
    
    // Attempt rollback if we created load balancer resources
    if (migrationResult.rollbackNeeded && migrationResult.loadBalancerResources) {
      console.log(chalk.yellow('\n🔄 Attempting to rollback load balancer resources...'));
      try {
        const { deleteLoadBalancer } = require('./loadBalancer');
        await deleteLoadBalancer({
          ...config,
          loadBalancerResources: migrationResult.loadBalancerResources
        });
        console.log(chalk.green('✅ Rollback completed - load balancer resources cleaned up'));
      } catch (rollbackError) {
        console.log(chalk.red(`❌ Rollback failed: ${sanitizeErrorMessage(rollbackError)}`));
        console.log(chalk.yellow('⚠️ You may need to manually clean up load balancer resources'));
      }
    }
    
    return migrationResult;
  }
}

/**
 * Main migration orchestrator function
 * @param {Object} config - Meteor Cloud Run configuration
 * @returns {Object} Updated configuration with load balancer resources
 */
async function migrateDomainMapping(config) {
  // Step 1: Detect if migration is needed
  const migrationInfo = await detectMigrationNeeded(config);
  
  if (!migrationInfo.needed) {
    verboseLog(`Migration not needed: ${migrationInfo.reason}`);
    return config;
  }
  
  // Step 2: Check if migration should proceed based on configuration
  const shouldMigrate = checkMigrationConfig(config, migrationInfo);
  
  if (!shouldMigrate) {
    verboseLog('Migration skipped - not enabled in configuration');
    return config;
  }
  
  // Step 3: Perform migration
  const migrationResult = await performMigration(config);
  
  if (migrationResult.success) {
    // Update configuration with new load balancer resources
    const updatedConfig = {
      ...config,
      useLoadBalancer: true,
      useManagedSSL: true,
      useStaticIP: true,
      loadBalancerResources: migrationResult.loadBalancerResources
    };
    
    console.log(chalk.green('\n🎉 Migration completed successfully!'));
    console.log(chalk.blue('Your configuration has been updated to use the static IP load balancer.'));
    
    return updatedConfig;
  } else {
    console.log(chalk.red('\n❌ Migration failed - continuing with existing configuration'));
    console.log(chalk.yellow('Your application will continue to use the existing domain mapping approach.'));
    return config;
  }
}

module.exports = {
  detectMigrationNeeded,
  migrateDomainMapping,
  checkMigrationConfig,
  performMigration,
  removeExistingDomainMapping,
  getDomainMappingInfo
};