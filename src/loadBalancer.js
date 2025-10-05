const { verboseLog, executeCommand, sanitizeServiceName } = require('./utils');
const chalk = require('chalk');

async function createLoadBalancer(config) {
  const { projectId, serviceName, customDomain, region, useStaticIP } = config;
  const resourceNames = generateResourceNames(serviceName, customDomain);
  
  console.log(chalk.blue('\n🔧 Creating load balancer resources for custom domain...\n'));

  try {
    // 1. Create or reuse global static IP address
    console.log(chalk.blue(`Checking for existing static IP address: ${resourceNames.staticIpName}`));
    let ipAddress;
    
    try {
      // Try to get existing IP address
      const existingIpResult = await executeCommand(
        `gcloud compute addresses describe ${resourceNames.staticIpName} --global --project=${projectId} --format="value(address)"`
      );
      ipAddress = existingIpResult.stdout.trim();
      console.log(chalk.yellow(`✅ Using existing static IP: ${ipAddress}`));
    } catch (error) {
      // IP doesn't exist, create it
      console.log(chalk.blue(`Creating new static IP address: ${resourceNames.staticIpName}`));
      await executeCommand(`gcloud compute addresses create ${resourceNames.staticIpName} --global --project=${projectId}`);
      
      // Get the created IP address
      const ipResult = await executeCommand(
        `gcloud compute addresses describe ${resourceNames.staticIpName} --global --project=${projectId} --format="value(address)"`
      );
      ipAddress = ipResult.stdout.trim();
      console.log(chalk.green(`Static IP created: ${ipAddress}`));
    }

    // If static IP is requested for outbound traffic, create Cloud NAT resources
    if (useStaticIP) {
      console.log(chalk.blue(`\n🌐 Setting up Cloud NAT for outbound static IP...`));
      
      // Check if default network exists, create if it doesn't
      let networkName = 'default';
      try {
        await executeCommand(`gcloud compute networks describe ${networkName} --project=${projectId}`);
        console.log(chalk.green(`✅ Using existing network: ${networkName}`));
      } catch (error) {
        if (error.message.includes('not found')) {
          console.log(chalk.yellow(`⚠️ Default network not found, checking for custom network...`));
          networkName = `${serviceName}-network`;
          
          // Check if custom network already exists
          try {
            await executeCommand(`gcloud compute networks describe ${networkName} --project=${projectId}`);
            console.log(chalk.green(`✅ Using existing custom network: ${networkName}`));
          } catch (networkCheckError) {
            // Network doesn't exist, try to create it
            try {
              console.log(chalk.blue(`Creating VPC network: ${networkName}`));
              await executeCommand(`gcloud compute networks create ${networkName} --subnet-mode=auto --project=${projectId}`);
              console.log(chalk.green(`✅ Created VPC network: ${networkName}`));
            } catch (createError) {
              // Handle case where subnet exists but network describe fails
              if (createError.message.includes('already exists')) {
                console.log(chalk.yellow(`✅ Network resources already exist, continuing...`));
              } else {
                throw createError;
              }
            }
          }
          
          // Enable necessary firewall rules for the network
            console.log(chalk.blue(`Checking/creating firewall rules for ${networkName}...`));
            
            // Helper function to create firewall rule if it doesn't exist
            const createFirewallRuleIfNotExists = async (ruleName, ruleArgs) => {
              try {
                await executeCommand(`gcloud compute firewall-rules describe ${ruleName} --project=${projectId}`);
                console.log(chalk.yellow(`✅ Using existing firewall rule: ${ruleName}`));
              } catch (error) {
                console.log(chalk.blue(`Creating firewall rule: ${ruleName}`));
                await executeCommand(`gcloud compute firewall-rules create ${ruleName} ${ruleArgs} --project=${projectId}`);
              }
            };
            
            // Allow internal communication
            await createFirewallRuleIfNotExists(
              `${networkName}-allow-internal`,
              `--network=${networkName} --allow=tcp,udp,icmp --source-ranges=10.128.0.0/9`
            );
            
            // Allow SSH (for debugging if needed)
            await createFirewallRuleIfNotExists(
              `${networkName}-allow-ssh`,
              `--network=${networkName} --allow=tcp:22 --source-ranges=0.0.0.0/0`
            );
            
            // Allow HTTPS for Cloud Run
            await createFirewallRuleIfNotExists(
              `${networkName}-allow-https`,
              `--network=${networkName} --allow=tcp:443 --source-ranges=0.0.0.0/0`
            );
            
            console.log(chalk.green(`✅ Firewall rules configured for ${networkName}`))
        } else {
          console.log(chalk.yellow(`⚠️ Could not verify network existence: ${error.message}`));
          // Continue with default network and hope it exists
        }
      }
      
      // Create or reuse regional static IP for NAT
      console.log(chalk.blue(`Checking for existing NAT IP: ${resourceNames.natIpName}`));
      let natIpAddress;
      
      try {
        // Try to get existing NAT IP
        const existingNatIpResult = await executeCommand(
          `gcloud compute addresses describe ${resourceNames.natIpName} --region=${region} --project=${projectId} --format="value(address)"`
        );
        natIpAddress = existingNatIpResult.stdout.trim();
        console.log(chalk.yellow(`✅ Using existing NAT IP: ${natIpAddress}`));
      } catch (error) {
        // NAT IP doesn't exist, create it
        console.log(chalk.blue(`Creating new regional static IP for NAT: ${resourceNames.natIpName}`));
        await executeCommand(`gcloud compute addresses create ${resourceNames.natIpName} --region=${region} --project=${projectId}`);
        
        // Get the NAT IP address
        const natIpResult = await executeCommand(
          `gcloud compute addresses describe ${resourceNames.natIpName} --region=${region} --project=${projectId} --format="value(address)"`
        );
        natIpAddress = natIpResult.stdout.trim();
        console.log(chalk.green(`NAT IP created: ${natIpAddress}`));
      }
      
      // Create or reuse Cloud Router with the appropriate network
      console.log(chalk.blue(`Checking for existing Cloud Router: ${resourceNames.routerName}`));
      try {
        await executeCommand(`gcloud compute routers describe ${resourceNames.routerName} --region=${region} --project=${projectId}`);
        console.log(chalk.yellow(`✅ Using existing Cloud Router: ${resourceNames.routerName}`));
      } catch (error) {
        console.log(chalk.blue(`Creating Cloud Router: ${resourceNames.routerName}`));
        await executeCommand(`gcloud compute routers create ${resourceNames.routerName} --network=${networkName} --region=${region} --project=${projectId}`);
      }
      
      // Create or reuse Cloud NAT
      console.log(chalk.blue(`Checking for existing Cloud NAT: ${resourceNames.natName}`));
      try {
        await executeCommand(`gcloud compute routers nats describe ${resourceNames.natName} --router=${resourceNames.routerName} --region=${region} --project=${projectId}`);
        console.log(chalk.yellow(`✅ Using existing Cloud NAT: ${resourceNames.natName}`));
      } catch (error) {
        console.log(chalk.blue(`Creating Cloud NAT: ${resourceNames.natName}`));
        await executeCommand(`gcloud compute routers nats create ${resourceNames.natName} --router=${resourceNames.routerName} --region=${region} --nat-external-ip-pool=${resourceNames.natIpName} --nat-all-subnet-ip-ranges --project=${projectId}`);
      }
      
      console.log(chalk.green(`✅ Cloud NAT configured - outbound traffic will use: ${natIpAddress}`));
      console.log(chalk.blue(`💡 Add this IP to your MongoDB Atlas Network Access whitelist: ${natIpAddress}`));
      
      // Create or reuse VPC connector for Cloud Run to use the NAT
      const vpcConnectorName = `${serviceName}-connector`;
      console.log(chalk.blue(`Checking for existing VPC connector: ${vpcConnectorName}`));
      
      // Enable VPC Access API if not already enabled
      try {
        await executeCommand(`gcloud services enable vpcaccess.googleapis.com --project=${projectId}`);
      } catch (error) {
        // Ignore if already enabled
      }
      
      try {
        const connectorResult = await executeCommand(`gcloud compute networks vpc-access connectors describe ${vpcConnectorName} --region=${region} --project=${projectId} --format="value(state)"`);
        const state = connectorResult.stdout.trim();
        
        if (state === 'READY') {
          console.log(chalk.yellow(`✅ Using existing VPC connector: ${vpcConnectorName}`));
        } else if (state === 'ERROR') {
          // Delete and recreate if in error state
          console.log(chalk.yellow(`⚠️ VPC connector in error state, recreating...`));
          await executeCommand(`gcloud compute networks vpc-access connectors delete ${vpcConnectorName} --region=${region} --project=${projectId} --quiet`);
          throw new Error('Connector needs recreation');
        } else {
          console.log(chalk.yellow(`⚠️ VPC connector in ${state} state, waiting...`));
        }
      } catch (error) {
        console.log(chalk.blue(`Creating VPC connector: ${vpcConnectorName}`));
        // Create VPC connector with appropriate IP range that doesn't conflict
        try {
          await executeCommand(`gcloud compute networks vpc-access connectors create ${vpcConnectorName} --network=${networkName} --region=${region} --range=10.8.0.0/28 --project=${projectId}`);
        } catch (createError) {
          console.log(chalk.yellow(`⚠️ VPC connector creation may be in progress or failed`));
          console.log(chalk.yellow(`   Note: Cloud Run may not route through static IP until VPC connector is ready`));
          // Don't fail the entire deployment if VPC connector has issues
        }
      }
      
      // Store VPC connector name for later use in Cloud Run deployment
      resourceNames.vpcConnectorName = vpcConnectorName;
      console.log(chalk.green(`✅ VPC connector configured for Cloud Run`));
    }

    // 2. Create or reuse Google-managed SSL certificate
    console.log(chalk.blue(`Checking for existing SSL certificate: ${resourceNames.sslCertName}`));
    try {
      await executeCommand(
        `gcloud compute ssl-certificates describe ${resourceNames.sslCertName} --global --project=${projectId}`
      );
      console.log(chalk.yellow(`✅ Using existing SSL certificate for domain: ${customDomain}`));
    } catch (error) {
      console.log(chalk.blue(`Creating SSL certificate for domain: ${customDomain}`));
      await executeCommand(
        `gcloud compute ssl-certificates create ${resourceNames.sslCertName} --domains=${customDomain} --global --project=${projectId}`
      );
    }

    // 3. Create or reuse serverless NEG for Cloud Run service
    console.log(chalk.blue(`Checking for existing network endpoint group: ${resourceNames.negName}`));
    try {
      await executeCommand(
        `gcloud compute network-endpoint-groups describe ${resourceNames.negName} --region=${region} --project=${projectId}`
      );
      console.log(chalk.yellow(`✅ Using existing network endpoint group: ${resourceNames.negName}`));
    } catch (error) {
      console.log(chalk.blue(`Creating serverless network endpoint group...`));
      await executeCommand(
        `gcloud compute network-endpoint-groups create ${resourceNames.negName} --region=${region} --network-endpoint-type=serverless --cloud-run-service=${serviceName} --project=${projectId}`
      );
    }

    // 4. Create or reuse backend service
    console.log(chalk.blue(`Checking for existing backend service: ${resourceNames.backendServiceName}`));
    let backendExists = false;
    try {
      await executeCommand(
        `gcloud compute backend-services describe ${resourceNames.backendServiceName} --global --project=${projectId}`
      );
      console.log(chalk.yellow(`✅ Using existing backend service: ${resourceNames.backendServiceName}`));
      backendExists = true;
    } catch (error) {
      console.log(chalk.blue(`Creating backend service...`));
      await executeCommand(
        `gcloud compute backend-services create ${resourceNames.backendServiceName} --global --load-balancing-scheme=EXTERNAL_MANAGED --protocol=HTTP --project=${projectId}`
      );
    }

    // Add the NEG to backend service (check if already added)
    if (!backendExists) {
      await executeCommand(
        `gcloud compute backend-services add-backend ${resourceNames.backendServiceName} --global --network-endpoint-group=${resourceNames.negName} --network-endpoint-group-region=${region} --project=${projectId}`
      );
    }

    // 5. Create or reuse URL map
    console.log(chalk.blue(`Checking for existing URL map: ${resourceNames.urlMapName}`));
    try {
      await executeCommand(
        `gcloud compute url-maps describe ${resourceNames.urlMapName} --global --project=${projectId}`
      );
      console.log(chalk.yellow(`✅ Using existing URL map: ${resourceNames.urlMapName}`));
    } catch (error) {
      console.log(chalk.blue(`Creating URL map...`));
      await executeCommand(
        `gcloud compute url-maps create ${resourceNames.urlMapName} --default-service=${resourceNames.backendServiceName} --global --project=${projectId}`
      );
    }

    // 6. Create or reuse HTTPS target proxy
    console.log(chalk.blue(`Checking for existing HTTPS target proxy: ${resourceNames.targetProxyName}`));
    try {
      await executeCommand(
        `gcloud compute target-https-proxies describe ${resourceNames.targetProxyName} --global --project=${projectId}`
      );
      console.log(chalk.yellow(`✅ Using existing HTTPS target proxy: ${resourceNames.targetProxyName}`));
    } catch (error) {
      console.log(chalk.blue(`Creating HTTPS target proxy...`));
      await executeCommand(
        `gcloud compute target-https-proxies create ${resourceNames.targetProxyName} --url-map=${resourceNames.urlMapName} --ssl-certificates=${resourceNames.sslCertName} --global --project=${projectId}`
      );
    }

    // 7. Create or reuse global forwarding rule
    console.log(chalk.blue(`Checking for existing global forwarding rule: ${resourceNames.forwardingRuleName}`));
    try {
      await executeCommand(
        `gcloud compute forwarding-rules describe ${resourceNames.forwardingRuleName} --global --project=${projectId}`
      );
      console.log(chalk.yellow(`✅ Using existing global forwarding rule: ${resourceNames.forwardingRuleName}`));
    } catch (error) {
      console.log(chalk.blue(`Creating global forwarding rule...`));
      await executeCommand(
        `gcloud compute forwarding-rules create ${resourceNames.forwardingRuleName} --target-https-proxy=${resourceNames.targetProxyName} --address=${resourceNames.staticIpName} --global --ports=443 --project=${projectId}`
      );
    }

    console.log(chalk.green('\n✅ Load balancer created successfully!\n'));
    
    // Display DNS configuration instructions
    console.log(chalk.blue('📌 DNS Configuration Required:\n'));
    console.log(`Add the following DNS record for your domain:`);
    console.log(`  Type: A`);
    console.log(`  Name: ${customDomain}`);
    console.log(`  Value: ${ipAddress}\n`);
    console.log(chalk.dim('Note: DNS propagation may take up to 48 hours'));
    console.log(chalk.dim('SSL certificate provisioning may take up to 30 minutes'));

    const result = {
      ipAddress,
      ...resourceNames
    };

    // Add NAT IP if Cloud NAT was configured
    if (useStaticIP) {
      const natIpResult = await executeCommand(
        `gcloud compute addresses describe ${resourceNames.natIpName} --region=${region} --project=${projectId} --format="value(address)"`
      );
      result.natIpAddress = natIpResult.stdout.trim();
    }

    return result;

  } catch (err) {
    console.log(chalk.red('Failed to create load balancer:'), err.message);
    throw err;
  }
}

async function deleteLoadBalancer(config) {
  const { projectId, region, loadBalancerResources } = config;
  
  if (!loadBalancerResources) {
    return;
  }

  console.log(chalk.blue('\n🧹 Cleaning up load balancer resources...\n'));

  const deletionSteps = [
    {
      name: 'forwarding rule',
      command: `gcloud compute forwarding-rules delete ${loadBalancerResources.forwardingRuleName} --global --project=${projectId} --quiet`
    },
    {
      name: 'target HTTPS proxy',
      command: `gcloud compute target-https-proxies delete ${loadBalancerResources.targetProxyName} --global --project=${projectId} --quiet`
    },
    {
      name: 'URL map',
      command: `gcloud compute url-maps delete ${loadBalancerResources.urlMapName} --global --project=${projectId} --quiet`
    },
    {
      name: 'backend service',
      command: `gcloud compute backend-services delete ${loadBalancerResources.backendServiceName} --global --project=${projectId} --quiet`
    },
    {
      name: 'network endpoint group',
      command: `gcloud compute network-endpoint-groups delete ${loadBalancerResources.negName} --region=${region} --project=${projectId} --quiet`
    },
    {
      name: 'SSL certificate',
      command: `gcloud compute ssl-certificates delete ${loadBalancerResources.sslCertName} --global --project=${projectId} --quiet`
    }
  ];

  // Add Cloud NAT resources if they exist
  if (loadBalancerResources.natName) {
    deletionSteps.push({
      name: 'Cloud NAT',
      command: `gcloud compute routers nats delete ${loadBalancerResources.natName} --router=${loadBalancerResources.routerName} --region=${region} --project=${projectId} --quiet`
    });
  }
  
  if (loadBalancerResources.vpcConnectorName) {
    deletionSteps.push({
      name: 'VPC Connector',
      command: `gcloud compute networks vpc-access connectors delete ${loadBalancerResources.vpcConnectorName} --region=${region} --project=${projectId} --quiet`
    });
  }
  
  if (loadBalancerResources.routerName) {
    deletionSteps.push({
      name: 'Cloud Router',
      command: `gcloud compute routers delete ${loadBalancerResources.routerName} --region=${region} --project=${projectId} --quiet`
    });
  }
  
  if (loadBalancerResources.natIpName) {
    deletionSteps.push({
      name: 'NAT static IP address',
      command: `gcloud compute addresses delete ${loadBalancerResources.natIpName} --region=${region} --project=${projectId} --quiet`
    });
  }

  // Always delete the main static IP last
  deletionSteps.push({
    name: 'static IP address',
    command: `gcloud compute addresses delete ${loadBalancerResources.staticIpName} --global --project=${projectId} --quiet`
  });

  let errorCount = 0;

  for (const step of deletionSteps) {
    try {
      console.log(chalk.blue(`Deleting ${step.name}...`));
      await executeCommand(step.command);
      console.log(chalk.green(`✓ ${step.name} deleted`));
    } catch (err) {
      // Handle non-existent resources gracefully
      if (err.message.includes('was not found')) {
        console.log(chalk.dim(`  ${step.name} not found (already deleted)`));
      } else {
        console.log(chalk.red(`Failed to delete ${step.name}:`), err.message);
        errorCount++;
      }
    }
  }

  if (errorCount === 0) {
    console.log(chalk.green('\n✅ All load balancer resources cleaned up successfully'));
  } else {
    console.log(chalk.yellow(`\n⚠️  Cleaned up with ${errorCount} errors`));
  }

  return errorCount;
}

async function checkLoadBalancerStatus(config) {
  const { projectId, loadBalancerResources } = config;
  
  if (!loadBalancerResources) {
    return null;
  }

  try {
    // Check SSL certificate status
    const certStatus = await executeCommand(
      `gcloud compute ssl-certificates describe ${loadBalancerResources.sslCertName} --global --project=${projectId} --format="value(managed.status)"`
    );

    // Check if forwarding rule is active
    const forwardingRuleStatus = await executeCommand(
      `gcloud compute forwarding-rules describe ${loadBalancerResources.forwardingRuleName} --global --project=${projectId} --format="value(status)"`
    );

    return {
      sslStatus: certStatus.stdout.trim(),
      forwardingRuleActive: forwardingRuleStatus.stdout.trim() === 'ACTIVE',
      ipAddress: loadBalancerResources.ipAddress
    };

  } catch (err) {
    console.log(chalk.red('Failed to check load balancer status:'), err.message);
    return null;
  }
}

function generateResourceNames(serviceName, customDomain) {
  const sanitizedName = sanitizeServiceName(serviceName);
  
  return {
    staticIpName: `${sanitizedName}-ip`,
    sslCertName: `${sanitizedName}-ssl-cert`,
    negName: `${sanitizedName}-neg`,
    backendServiceName: `${sanitizedName}-backend`,
    urlMapName: `${sanitizedName}-url-map`,
    targetProxyName: `${sanitizedName}-https-proxy`,
    forwardingRuleName: `${sanitizedName}-https-rule`,
    natIpName: `${sanitizedName}-nat-ip`,
    routerName: `${sanitizedName}-router`,
    natName: `${sanitizedName}-nat`
  };
}

module.exports = {
  createLoadBalancer,
  deleteLoadBalancer,
  checkLoadBalancerStatus
};