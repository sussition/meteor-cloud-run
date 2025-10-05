# Resource Management & Costs

Complete guide to managing Google Cloud resources, understanding costs, and optimizing your meteor-cloud-run deployments.

## Understanding Resource Lifecycle

meteor-cloud-run creates various Google Cloud resources during deployment. Understanding their lifecycle helps manage costs and avoid orphaned resources.

### Resources Created by meteor-cloud-run

| Resource Type | When Created | Lifecycle | Cost Impact |
|---------------|-------------|-----------|-------------|
| **Cloud Run Service** | Every deployment | Persists until manually removed | Minimal when not serving traffic |
| **Artifact Registry** | First deployment | Persists, grows with each deployment | Storage costs for container images |
| **Secrets (Secret Manager)** | First deployment | Persists, versions created on changes | $0.06 per 10,000 secret versions/month |
| **Static IP (Inbound)** | Custom domain setup | Persists until load balancer removed | ~$0.01/hour (~$7.30/month) |
| **Load Balancer Resources** | Custom domain setup | Persists until manually removed | ~$0.025/hour (~$18/month) |
| **SSL Certificate** | Custom domain setup | Auto-managed by Google | Included in load balancer cost |
| **VPC Connector** | Static outbound IP | Persists until manually removed | Variable based on throughput |
| **Cloud NAT & Static IP (Outbound)** | Static outbound IP | Persists until manually removed | ~$32-45/month |

## Failed Deployment Scenarios

### What Happens During Deployment Failures

#### Scenario 1: Deployment fails during container build
- ✅ **No orphaned resources** - Nothing created yet
- 💡 **Action needed:** Re-run deployment
- 💰 **Cost impact:** None

**Example:**
```bash
# Build fails due to Meteor version issues
meteor-cloud-run deploy
# ERROR: Build failed - invalid Meteor version

# Solution: Check .meteor/release and re-deploy
meteor --version
meteor-cloud-run deploy
```

#### Scenario 2: Deployment fails after creating load balancer resources
- ⚠️ **Potential orphaned resources:** Static IP, SSL certificate, load balancer components
- 💰 **Cost impact:** ~$20-30/month if not cleaned up
- 💡 **Action needed:** Run `meteor-cloud-run remove`

**Example:**
```bash
# Deployment creates load balancer but Cloud Run deployment fails
meteor-cloud-run deploy
# Load balancer created successfully...
# ERROR: Cloud Run deployment failed

# Check what was created
meteor-cloud-run info
# Shows load balancer resources but no service

# Clean up orphaned resources
meteor-cloud-run remove
```

#### Scenario 3: Deployment succeeds but domain configuration fails
- ✅ **All resources created** - Can be reused on next deployment
- 💡 **Action needed:** Fix DNS configuration and re-deploy
- 💰 **Cost impact:** Normal operational costs

**Example:**
```bash
# Deployment succeeds but SSL certificate fails to provision
meteor-cloud-run deploy
# Deployment successful but SSL certificate PROVISIONING failed

# Fix DNS and wait
# Check SSL status in Google Cloud Console or:
meteor-cloud-run info --verbose
# Configure DNS properly and wait for certificate
```

## Resource Cleanup Commands

### Basic Cleanup Commands

```bash
# Remove only the Cloud Run service (keeps other resources)
meteor-cloud-run remove --service-only

# Remove ALL resources including load balancer, static IPs, certificates
meteor-cloud-run remove

# Clean up old secret versions to reduce costs
# Manual cleanup no longer needed - secrets are managed automatically
# Use Google Cloud Console if needed
```

### Detailed Cleanup Process

#### `meteor-cloud-run remove --service-only`
**Removes:**
- Cloud Run service and all revisions
- Service-specific IAM bindings

**Keeps:**
- Load balancer resources
- Static IP addresses
- SSL certificates
- Secrets in Secret Manager
- Container images in Artifact Registry

**Use when:**
- Testing different configurations
- Temporary service removal
- Preserving infrastructure for re-deployment

#### `meteor-cloud-run remove`
**Removes:**
- Cloud Run service
- Load balancer resources (forwarding rules, target proxies, URL maps)
- Backend services and health checks
- Network Endpoint Groups (NEGs)
- Static IP addresses
- SSL certificates
- VPC connectors (if created)
- Cloud NAT resources (if created)

**Keeps by default:**
- Secrets in Secret Manager (for data safety)
- Container images in Artifact Registry
- VPC networks and firewall rules (shared resources)

**Use when:**
- Permanent cleanup
- Switching to different approach
- Cost optimization

## Recovery from Failed State

### If Deployment is Stuck or Partially Failed

#### 1. Check current status
```bash
meteor-cloud-run info --verbose
```

This shows:
- Current resource states
- Error messages and warnings
- Suggested recovery actions

#### 2. Clean up and start fresh
```bash
# Complete reset - removes everything
meteor-cloud-run remove

# Or just remove the service and keep infrastructure
meteor-cloud-run remove --service-only

# Then re-initialize and deploy
meteor-cloud-run init
meteor-cloud-run deploy
```

#### 3. Common stuck states and solutions

##### Load balancer creation failed
```bash
# Symptoms: Load balancer resources partially created
meteor-cloud-run info
# Shows some load balancer resources but errors

# Solution: Complete cleanup and retry
meteor-cloud-run remove
# Wait 5-10 minutes for cleanup to complete
meteor-cloud-run deploy
```

##### SSL certificate stuck in provisioning
```bash
# Symptoms: Certificate shows PROVISIONING for >30 minutes
meteor-cloud-run info --verbose
# Shows: SSL Certificate Status: PROVISIONING

# Solutions:
# 1. Check DNS configuration
nslookup your-domain.com

# 2. Wait up to 60 minutes for validation
meteor-cloud-run info --verbose

# 3. If still stuck after 1 hour, remove and recreate
meteor-cloud-run remove
meteor-cloud-run deploy
```

##### Service deployment partial failure
```bash
# Symptoms: Service exists but not responding
meteor-cloud-run info
# Shows service but health checks failing

# Check service logs
gcloud logging read "resource.type=cloud_run_revision" --limit=20

# Common fixes:
# 1. Check settings.json format
# 2. Verify MongoDB connection
# 3. Re-deploy with verbose logging
meteor-cloud-run deploy --verbose
```

## Advanced Resource Management

### Support for Multi-App Deployments

When managing multiple apps in the same project, resource cleanup becomes more important:

```bash
# List all meteor-cloud-run resources across the project
gcloud compute addresses list --filter="name~'.*-ip'"
gcloud run services list
gcloud secrets list --filter="name~'.*-mongodb-url'"

# Clean up specific app resources
cd /path/to/specific/app
meteor-cloud-run remove  # Only affects this app's resources
```

### Resource Naming Conventions

meteor-cloud-run uses predictable naming based on service names:

```
Service name: my-app (from package.json)

Resources created:
- my-app                    (Cloud Run service)
- my-app-ip                 (Static IP)
- my-app-ssl-cert          (SSL certificate)
- my-app-backend           (Backend service)
- my-app-url-map           (URL map)
- my-app-https-proxy       (HTTPS proxy)
- my-app-https-rule        (Forwarding rule)
- my-app-neg               (Network Endpoint Group)
- my-app-mongodb-url       (Secret)
- my-app-nat-ip            (NAT IP, if enabled)
```

### Manual Resource Cleanup

If `meteor-cloud-run remove` fails, you can manually clean up resources:

```bash
SERVICE_NAME="your-service-name"

# Remove Cloud Run service
gcloud run services delete $SERVICE_NAME --region=us-central1 --quiet

# Remove load balancer resources (in order)
gcloud compute forwarding-rules delete ${SERVICE_NAME}-https-rule --global --quiet
gcloud compute target-https-proxies delete ${SERVICE_NAME}-https-proxy --quiet
gcloud compute url-maps delete ${SERVICE_NAME}-url-map --quiet
gcloud compute backend-services delete ${SERVICE_NAME}-backend --global --quiet
gcloud compute network-endpoint-groups delete ${SERVICE_NAME}-neg --region=us-central1 --quiet
gcloud compute health-checks delete ${SERVICE_NAME}-health-check --quiet

# Remove SSL certificate
gcloud compute ssl-certificates delete ${SERVICE_NAME}-ssl-cert --global --quiet

# Remove static IP
gcloud compute addresses delete ${SERVICE_NAME}-ip --global --quiet

# Optional: Remove secrets (be careful - contains sensitive data)
gcloud secrets delete ${SERVICE_NAME}-mongodb-url --quiet
```

### Container Image Management

Container images can accumulate over time and increase storage costs:

```bash
# List images for your service
gcloud container images list-tags gcr.io/PROJECT_ID/SERVICE_NAME

# Delete old images (keep recent 5)
gcloud container images list-tags gcr.io/PROJECT_ID/SERVICE_NAME \
  --sort-by=~TIMESTAMP --limit=999 --format="get(digest)" | \
  tail -n +6 | \
  xargs -I {} gcloud container images delete gcr.io/PROJECT_ID/SERVICE_NAME@{} --quiet
```

### Secret Version Cleanup

Secret Manager charges for stored versions. Clean up old versions regularly:

```bash
# List all secret versions
gcloud secrets versions list SECRET_NAME --limit=10

# Secrets are now managed automatically
# Use Google Cloud Console for manual cleanup if needed

# Manual cleanup (if needed)
gcloud secrets versions destroy VERSION_ID --secret=SECRET_NAME --quiet
```

## Automation and Maintenance

### Automated Cost Optimization

Create a maintenance script for regular cleanup:

```bash
#!/bin/bash
# maintenance.sh - Run monthly for cost optimization

echo "Running meteor-cloud-run maintenance..."

# Clean up old secret versions
# Use Google Cloud Console Secret Manager section

# List current resources and costs
meteor-cloud-run info

echo "Maintenance complete. Check Cloud Console for current costs."
```

## Summary

Use `meteor-cloud-run remove` to clean up resources when no longer needed. The tool creates predictable resource names based on your service name, making it easy to identify and manage meteor-cloud-run specific resources in your Google Cloud project.

For more advanced resource management, see:
- [Multi-App Deployments](multi-app.md)
- [Troubleshooting Guide](troubleshooting.md)