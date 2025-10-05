# Multi-App Deployments

Complete guide to deploying and managing multiple Meteor applications within the same Google Cloud Project.

## Overview

meteor-cloud-run fully supports deploying multiple Meteor applications within the same Google Cloud Project. Each application maintains complete isolation through unique resource naming, allowing you to manage multiple services efficiently.

## How Multi-App Support Works

### Resource Isolation

Each application gets its own isolated set of resources based on the service name (derived from `package.json`):

```
App 1: ecommerce-platform
├── ecommerce-platform (Cloud Run service)
├── ecommerce-platform-ip (Static IP)
├── ecommerce-platform-ssl-cert (SSL Certificate)
├── ecommerce-platform-backend (Load Balancer)
├── ecommerce-platform-mongodb-url (Secret)
└── ecommerce-platform (Artifact Registry)

App 2: admin-dashboard  
├── admin-dashboard (Cloud Run service)
├── admin-dashboard-ip (Static IP)
├── admin-dashboard-ssl-cert (SSL Certificate)
├── admin-dashboard-backend (Load Balancer)
├── admin-dashboard-mongodb-url (Secret)
└── admin-dashboard (Artifact Registry)
```

### Resource Naming Convention

| Resource Type | Naming Pattern | Example |
|---------------|----------------|---------|
| Cloud Run Service | `{app-name}` | `ecommerce-platform` |
| Static IP | `{app-name}-ip` | `ecommerce-platform-ip` |
| SSL Certificate | `{app-name}-ssl-cert` | `ecommerce-platform-ssl-cert` |
| Load Balancer Backend | `{app-name}-backend` | `ecommerce-platform-backend` |
| URL Map | `{app-name}-url-map` | `ecommerce-platform-url-map` |
| Secrets | `{app-name}-mongodb-url` | `ecommerce-platform-mongodb-url` |
| Artifact Registry | `{app-name}` | `ecommerce-platform` |

## Deploying Multiple Applications

### Basic Multi-App Setup

```bash
# App 1: E-commerce Platform
cd /path/to/ecommerce-app
meteor-cloud-run init     # Creates resources prefixed with "ecommerce-app"
meteor-cloud-run deploy   # Deploys to shop.example.com

# App 2: Admin Dashboard
cd /path/to/admin-dashboard
meteor-cloud-run init     # Creates resources prefixed with "admin-dashboard"
meteor-cloud-run deploy   # Deploys to admin.example.com

# App 3: API Service (update package.json name to "custom-api")
cd /path/to/api-service
# Edit package.json: "name": "custom-api"
meteor-cloud-run init
meteor-cloud-run deploy   # Deploys to api.example.com
```

### Service Name Management

#### Automatic Service Names
Service names are derived from `package.json`:

```json
{
  "name": "ecommerce-platform",
  "version": "1.0.0"
}
```
Results in service name: `ecommerce-platform`

#### Custom Service Names
To use a custom service name, update your `package.json` or manually edit the config after initialization:

**Method 1: Edit package.json before init:**
```json
{
  "name": "my-custom-name",
  "version": "1.0.0"
}
```

**Method 2: Edit config after init:**
```json
{
  "serviceName": "my-custom-name",
  "projectId": "my-project"
}
```

#### Service Name Requirements
- Must be lowercase
- Can contain letters, numbers, and hyphens
- Must start with a letter
- Cannot end with a hyphen
- Must be 1-63 characters long

## Configuration Strategies

### Shared Project, Separate Configurations

Each app has its own configuration but shares the same Google Cloud Project:

```
project-root/
├── ecommerce-app/
│   ├── .meteor-cloud-run/config.json  # Uses "my-project"
│   └── settings.json
├── admin-dashboard/
│   ├── .meteor-cloud-run/config.json  # Uses "my-project"
│   └── settings.json
└── api-service/
    ├── .meteor-cloud-run/config.json  # Uses "my-project"
    └── settings.json
```

### Environment-Based Naming

Use consistent naming conventions across environments:

```bash
# Development (Edit package.json: "name": "ecommerce-dev")
cd ecommerce-app
meteor-cloud-run init
meteor-cloud-run deploy --settings settings-dev.json

# Staging (Edit package.json: "name": "ecommerce-staging")
meteor-cloud-run init
meteor-cloud-run deploy --settings settings-staging.json

# Production (Edit package.json: "name": "ecommerce-prod")
meteor-cloud-run init
meteor-cloud-run deploy --settings settings-prod.json
```

### Microservices Architecture

Deploy related services as separate apps:

```bash
# Frontend Application (package.json: "name": "myapp-frontend")
cd frontend-app/
meteor-cloud-run init
# Configure custom domain: app.example.com

# API Gateway (package.json: "name": "myapp-api")
cd api-gateway/
meteor-cloud-run init
# Configure custom domain: api.example.com

# Admin Interface (package.json: "name": "myapp-admin")
cd admin-interface/
meteor-cloud-run init
# Configure custom domain: admin.example.com

# Background Workers (package.json: "name": "myapp-workers")
cd workers/
meteor-cloud-run init
# No custom domain (internal service)
```

## Managing Multiple Apps

### Viewing All Deployments

#### Per-App Status
```bash
cd /path/to/app
meteor-cloud-run info  # Shows complete deployment details for this app
```

#### Project-Wide Overview
```bash
# List all Cloud Run services
gcloud run services list --format="table(metadata.name,status.url,spec.template.spec.containers[0].resources.limits.memory)"

# List all static IPs  
gcloud compute addresses list --format="table(name,address,status)"

# List all SSL certificates
gcloud compute ssl-certificates list --format="table(name,managed.status)"

# List all secrets
gcloud secrets list --format="table(name,createTime)"
```

#### Custom Overview Script
```bash
#!/bin/bash
# multi-app-status.sh

echo "=== Multi-App Deployment Overview ==="
echo ""

echo "Cloud Run Services:"
gcloud run services list --format="table(metadata.name,status.url,metadata.creationTimestamp)"
echo ""

echo "Custom Domains (Static IPs):"
gcloud compute addresses list --global --format="table(name,address,status)"
echo ""

echo "SSL Certificates:"
gcloud compute ssl-certificates list --format="table(name,managed.status,managed.domains[].join(','))"
echo ""

echo "Secrets by App:"
gcloud secrets list --format="table(name,createTime)" | grep -E "(mongodb-url|mail-url)"
```

### Deployment Orchestration

#### Sequential Deployment
```bash
#!/bin/bash
# deploy-all.sh - Deploy all apps in sequence

APPS=("frontend-app" "api-gateway" "admin-interface" "workers")

for app in "${APPS[@]}"; do
    echo "Deploying $app..."
    cd "/path/to/$app"
    
    if meteor-cloud-run deploy; then
        echo "✅ $app deployed successfully"
    else
        echo "❌ $app deployment failed"
        exit 1
    fi
    
    cd ..
done

echo "🎉 All applications deployed successfully!"
```

#### Parallel Deployment
```bash
#!/bin/bash
# deploy-parallel.sh - Deploy multiple apps in parallel

deploy_app() {
    local app=$1
    echo "Starting deployment: $app"
    cd "/path/to/$app"
    
    if meteor-cloud-run deploy; then
        echo "✅ $app deployed successfully"
    else
        echo "❌ $app deployment failed"
        return 1
    fi
}

# Deploy apps in parallel
deploy_app "frontend-app" &
deploy_app "api-gateway" &
deploy_app "admin-interface" &
deploy_app "workers" &

# Wait for all deployments to complete
wait

echo "🎉 All parallel deployments completed!"
```

### Configuration Management

#### Shared Configuration Template
Create a base configuration template:

```json
{
  "projectId": "my-multi-app-project",
  "region": "us-central1",
  "meteorVersion": "3.2",
  "nodeVersion": "18",
  "cpu": "1",
  "memory": "512Mi",
  "minInstances": 0,
  "maxInstances": 10,
  "concurrency": 80
}
```

#### App-Specific Overrides
Each app can override specific settings:

```bash
# Frontend (higher resources, custom domain)
{
  "serviceName": "myapp-frontend",
  "customDomain": "app.example.com",
  "cpu": "2",
  "memory": "1Gi",
  "maxInstances": 20
}

# API (optimized for high concurrency)
{
  "serviceName": "myapp-api", 
  "customDomain": "api.example.com",
  "concurrency": 1000,
  "maxInstances": 50
}

# Workers (background processing)
{
  "serviceName": "myapp-workers",
  "minInstances": 1,
  "maxInstances": 5,
  "concurrency": 1
}
```

## Important Considerations

### 1. Unique Service Names
Ensure each app has a unique name in `package.json`:

```json
{
  "name": "mycompany-frontend-app",  // Good: unique and descriptive
  "name": "app",                     // Bad: generic, likely to conflict
}
```

### 2. Resource Costs
Each app creates its own infrastructure:

**Per app with custom domain:**
- Load balancer: ~$18/month
- Static IP: ~$7/month  
- SSL certificate: Free
- **Total infrastructure: ~$25/month per app**

**Cost optimization strategies:**
- Use `*.run.app` domains for development/internal services
- Share databases between related apps
- Use appropriate resource allocation per service

### 3. Shared Resources
Some resources may be shared when using custom networks:

**Shared:**
- VPC networks and firewall rules
- Organization policies
- Project quotas and billing

**Isolated:**
- Cloud Run services and revisions
- Load balancers and SSL certificates
- Static IP addresses
- Secrets in Secret Manager
- Container images

### 4. Secrets Isolation
Each app has completely isolated secrets:

```bash
# App 1 secrets
myapp-frontend-mongodb-url
myapp-frontend-mail-url

# App 2 secrets  
myapp-api-mongodb-url
myapp-api-jwt-secret

# No cross-app access possible
```

### 5. Network Communication
Apps can communicate via:

**Public endpoints:**
```bash
# Frontend calling API
https://api.example.com/graphql
```

**Internal endpoints (if in same region):**
```bash
# Using Cloud Run internal URLs
https://myapp-api-xxx-uc.a.run.app/internal
```


## Troubleshooting Multi-App Issues

### Service Name Conflicts
```bash
# Error: Service name already exists
# Solution: Update package.json with unique name
# Edit package.json: "name": "unique-app-name"
meteor-cloud-run init
```

### Resource Quota Limits
```bash
# Error: Quota exceeded for forwarding-rules
# Check project quotas
gcloud compute project-info describe --format="table(quotas.metric,quotas.limit,quotas.usage)"

# Request quota increases if needed
```

### Cross-App Communication Issues
```bash
# Test connectivity between apps
curl https://app2-xxx-uc.a.run.app/health

# Check firewall rules and organization policies
```

### Cost Management
```bash
# Monitor costs per service
gcloud billing budgets list
gcloud logging read "resource.type=cloud_run_revision" --format="table(resource.labels.service_name,timestamp)"
```


## Summary

meteor-cloud-run supports multiple applications through unique service naming and resource isolation. Each app gets its own Cloud Run service, secrets, and configuration while sharing the same Google Cloud project.

For more information, see:
- [Resource Management](resource-management.md)
- [CI/CD Integration](ci-cd.md)