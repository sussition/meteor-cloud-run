const fs = require('fs-extra');
const { verboseLog, extractDomainFromUrl } = require('./utils');

function flattenSettingsToEnvVars(settings) {
  const envVars = {};
  
  // ALWAYS prioritize meteor-cloud-run.env first (highest priority)
  if (settings['meteor-cloud-run'] && settings['meteor-cloud-run'].env) {
    const mcrEnv = settings['meteor-cloud-run'].env;
    Object.entries(mcrEnv).forEach(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number') {
        envVars[key] = value;
      }
    });
    verboseLog(`Loaded ${Object.keys(mcrEnv).length} environment variables from meteor-cloud-run.env`);
  }
  
  // Fallback to Galaxy format only if meteor-cloud-run.env doesn't exist
  else if (settings['galaxy.meteor.com']) {
    const galaxySettings = settings['galaxy.meteor.com'];
    
    // Extract environment variables from galaxy.meteor.com.env
    if (galaxySettings.env) {
      Object.entries(galaxySettings.env).forEach(([key, value]) => {
        if (typeof value === 'string' || typeof value === 'number') {
          envVars[key] = value;
        }
      });
      verboseLog(`Loaded ${Object.keys(galaxySettings.env).length} environment variables from galaxy.meteor.com.env (fallback)`);
    }
    
    // Handle GCP credentials
    if (galaxySettings.gcp && galaxySettings.gcp.credentials) {
      envVars.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify(galaxySettings.gcp.credentials);
    }
    
    // Handle service URLs
    Object.entries(galaxySettings).forEach(([key, value]) => {
      if (typeof value === 'object' && value.baseUrl) {
        const envKey = `${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BASE_URL`;
        envVars[envKey] = value.baseUrl;
      }
    });
  }
  
  // Handle direct environment variables
  if (settings.env) {
    Object.entries(settings.env).forEach(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number') {
        envVars[key] = value;
      }
    });
  }
  
  // Note: We do NOT extract environment variables from root level
  // Environment variables should only come from meteor-cloud-run.env, galaxy.meteor.com.env, or env sections
  
  return envVars;
}

function createMeteorSettings(settings) {
  // Create a clean METEOR_SETTINGS object with public and private settings
  const meteorSettings = {
    public: settings.public || {}
  };
  
  // Include private settings in METEOR_SETTINGS (they are needed by the app)
  // Note: Environment variables should come from galaxy.meteor.com.env or meteor-cloud-run.env
  if (settings.private) {
    meteorSettings.private = settings.private;
  }
  
  return meteorSettings;
}

function escapeEnvValue(value) {
  if (typeof value !== 'string') {
    return String(value);
  }
  
  // Escape special characters for shell environment variables
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}

async function processSettingsFile(settingsPath) {
  verboseLog(`Processing settings file: ${settingsPath}`);
  
  if (!fs.existsSync(settingsPath)) {
    throw new Error(`Settings file not found: ${settingsPath}`);
  }
  
  const settingsData = await fs.readJson(settingsPath);
  verboseLog('Settings file loaded successfully');
  
  // Extract environment variables from settings
  const envVars = flattenSettingsToEnvVars(settingsData);
  verboseLog(`Extracted ${Object.keys(envVars).length} environment variables from settings`);
  
  return envVars;
}

async function migrateSettingsToMeteorCloudRun(settingsFilePath) {
  verboseLog('Checking if Galaxy to Meteor Cloud Run migration is needed...');
  
  if (!fs.existsSync(settingsFilePath)) {
    verboseLog('Settings file does not exist, no migration needed');
    return false;
  }
  
  const settings = await fs.readJson(settingsFilePath);
  
  // Check if Galaxy settings exist and meteor-cloud-run settings don't
  const hasGalaxyEnv = settings['galaxy.meteor.com'] && settings['galaxy.meteor.com'].env;
  const hasMcrEnv = settings['meteor-cloud-run'] && settings['meteor-cloud-run'].env;
  
  // Migrate from Galaxy format to meteor-cloud-run format
  if (hasGalaxyEnv && !hasMcrEnv) {
    verboseLog('Migrating Galaxy settings to Meteor Cloud Run format...');
    
    // Create Meteor Cloud Run section if it doesn't exist
    if (!settings['meteor-cloud-run']) {
      settings['meteor-cloud-run'] = {};
    }
    
    // Copy Galaxy environment variables to meteor-cloud-run.env
    settings['meteor-cloud-run'].env = { ...settings['galaxy.meteor.com'].env };
    
    // Copy GCP settings if they exist
    if (settings['galaxy.meteor.com'].gcp) {
      settings['meteor-cloud-run'].gcp = settings['galaxy.meteor.com'].gcp;
    }
    
    // Copy service URLs if they exist
    Object.entries(settings['galaxy.meteor.com']).forEach(([key, value]) => {
      if (key !== 'env' && key !== 'gcp' && typeof value === 'object' && value.baseUrl) {
        if (!settings['meteor-cloud-run'][key]) {
          settings['meteor-cloud-run'][key] = value;
        }
      }
    });
    
    // Write the updated settings back to file
    await fs.writeJson(settingsFilePath, settings, { spaces: 2 });
    
    verboseLog('Galaxy settings migrated to Meteor Cloud Run format successfully');
    verboseLog(`Migrated ${Object.keys(settings['meteor-cloud-run'].env).length} environment variables to meteor-cloud-run.env`);
    
    return true;
  }
  
  verboseLog('No Galaxy to Meteor Cloud Run migration needed');
  return false;
}

async function extractConfigFromSettings(settings) {
  const config = {};
  
  verboseLog('Extracting configuration from settings...');
  
  // Extract project ID from various possible locations
  if (settings['galaxy.meteor.com']?.gcp?.projectId) {
    config.projectId = settings['galaxy.meteor.com'].gcp.projectId;
    verboseLog('Project ID found in galaxy.meteor.com.gcp.projectId');
  } else if (settings['meteor-cloud-run']?.gcp?.projectId) {
    config.projectId = settings['meteor-cloud-run'].gcp.projectId;
    verboseLog('Project ID found in meteor-cloud-run.gcp.projectId');
  } else if (settings.gcp?.projectId) {
    config.projectId = settings.gcp.projectId;
    verboseLog('Project ID found in gcp.projectId');
  } else if (settings.projectId) {
    config.projectId = settings.projectId;
    verboseLog('Project ID found in root');
  }
  
  // Extract ROOT_URL (prioritize meteor-cloud-run.env first)
  if (settings['meteor-cloud-run']?.env?.ROOT_URL) {
    config.rootUrl = settings['meteor-cloud-run'].env.ROOT_URL;
    verboseLog('ROOT_URL found in meteor-cloud-run.env');
  } else if (settings['galaxy.meteor.com']?.env?.ROOT_URL) {
    config.rootUrl = settings['galaxy.meteor.com'].env.ROOT_URL;
    verboseLog('ROOT_URL found in galaxy.meteor.com.env');
  } else if (settings.env?.ROOT_URL) {
    config.rootUrl = settings.env.ROOT_URL;
    verboseLog('ROOT_URL found in env');
  }
  
  // Extract MongoDB URL (prioritize meteor-cloud-run.env first)
  if (settings['meteor-cloud-run']?.env?.MONGO_URL) {
    config.mongoUrl = settings['meteor-cloud-run'].env.MONGO_URL;
    verboseLog('MONGO_URL found in meteor-cloud-run.env');
  } else if (settings['galaxy.meteor.com']?.env?.MONGO_URL) {
    config.mongoUrl = settings['galaxy.meteor.com'].env.MONGO_URL;
    verboseLog('MONGO_URL found in galaxy.meteor.com.env');
  } else if (settings.env?.MONGO_URL) {
    config.mongoUrl = settings.env.MONGO_URL;
    verboseLog('MONGO_URL found in env');
  }
  
  // Extract MongoDB Oplog URL
  if (settings['meteor-cloud-run']?.env?.MONGO_OPLOG_URL) {
    config.mongoOplogUrl = settings['meteor-cloud-run'].env.MONGO_OPLOG_URL;
  } else if (settings['galaxy.meteor.com']?.env?.MONGO_OPLOG_URL) {
    config.mongoOplogUrl = settings['galaxy.meteor.com'].env.MONGO_OPLOG_URL;
  } else if (settings.env?.MONGO_OPLOG_URL) {
    config.mongoOplogUrl = settings.env.MONGO_OPLOG_URL;
  }
  
  // Extract Mail URL
  if (settings['meteor-cloud-run']?.env?.MAIL_URL) {
    config.mailUrl = settings['meteor-cloud-run'].env.MAIL_URL;
  } else if (settings['galaxy.meteor.com']?.env?.MAIL_URL) {
    config.mailUrl = settings['galaxy.meteor.com'].env.MAIL_URL;
  } else if (settings.env?.MAIL_URL) {
    config.mailUrl = settings.env.MAIL_URL;
  }
  
  // Extract HTTP_FORWARDED_COUNT
  if (settings['meteor-cloud-run']?.env?.HTTP_FORWARDED_COUNT) {
    config.httpForwardedCount = settings['meteor-cloud-run'].env.HTTP_FORWARDED_COUNT;
  } else if (settings['galaxy.meteor.com']?.env?.HTTP_FORWARDED_COUNT) {
    config.httpForwardedCount = settings['galaxy.meteor.com'].env.HTTP_FORWARDED_COUNT;
  } else if (settings.env?.HTTP_FORWARDED_COUNT) {
    config.httpForwardedCount = settings.env.HTTP_FORWARDED_COUNT;
  }
  
  // Extract DISABLE_WEBSOCKETS
  if (settings['meteor-cloud-run']?.env?.DISABLE_WEBSOCKETS) {
    config.disableWebsockets = settings['meteor-cloud-run'].env.DISABLE_WEBSOCKETS;
  } else if (settings['galaxy.meteor.com']?.env?.DISABLE_WEBSOCKETS) {
    config.disableWebsockets = settings['galaxy.meteor.com'].env.DISABLE_WEBSOCKETS;
  } else if (settings.env?.DISABLE_WEBSOCKETS) {
    config.disableWebsockets = settings.env.DISABLE_WEBSOCKETS;
  }
  
  // Extract all additional environment variables (prioritize meteor-cloud-run.env first)
  const sensitiveVars = ['MONGO_URL', 'MONGO_OPLOG_URL', 'MAIL_URL']; // These are handled as secrets
  const handledVars = ['ROOT_URL', 'HTTP_FORWARDED_COUNT', 'DISABLE_WEBSOCKETS']; // These are handled individually
  
  if (settings['meteor-cloud-run']?.env) {
    const mcrEnv = settings['meteor-cloud-run'].env;
    config.additionalEnvVars = {};
    
    Object.entries(mcrEnv).forEach(([key, value]) => {
      if (!sensitiveVars.includes(key) && !handledVars.includes(key)) {
        config.additionalEnvVars[key] = value;
        verboseLog(`Additional env var from Meteor Cloud Run: ${key}`);
      }
    });
  }
  
  // Fallback to Galaxy environment variables if meteor-cloud-run.env doesn't exist
  else if (settings['galaxy.meteor.com']?.env) {
    const galaxyEnv = settings['galaxy.meteor.com'].env;
    config.additionalEnvVars = {};
    
    Object.entries(galaxyEnv).forEach(([key, value]) => {
      if (!sensitiveVars.includes(key) && !handledVars.includes(key)) {
        config.additionalEnvVars[key] = value;
        verboseLog(`Additional env var from Galaxy: ${key}`);
      }
    });
  }
  
  // Extract all other environment variables from other formats too
  if (settings.env && !config.additionalEnvVars) {
    const sensitiveVars = ['MONGO_URL', 'MONGO_OPLOG_URL', 'MAIL_URL']; // These are handled as secrets
    const handledVars = ['ROOT_URL', 'HTTP_FORWARDED_COUNT', 'DISABLE_WEBSOCKETS']; // These are handled individually
    config.additionalEnvVars = {};
    
    Object.entries(settings.env).forEach(([key, value]) => {
      if (!sensitiveVars.includes(key) && !handledVars.includes(key)) {
        config.additionalEnvVars[key] = value;
        verboseLog(`Additional env var from env: ${key}`);
      }
    });
  }
  
  verboseLog('Configuration extraction completed:', config);
  return config;
}

module.exports = {
  flattenSettingsToEnvVars,
  createMeteorSettings,
  escapeEnvValue,
  processSettingsFile,
  extractConfigFromSettings,
  migrateSettingsToMeteorCloudRun
};