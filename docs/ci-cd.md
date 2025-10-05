# CI/CD Integration

Complete guide to integrating meteor-cloud-run with continuous integration and deployment pipelines.

## Overview

meteor-cloud-run is designed for seamless CI/CD integration with automatic authentication, permission management, and deployment orchestration.

## Workflow

### 1. Local Setup
Configure your application locally first:

```bash
# Authenticate with your personal Google account
gcloud auth application-default login

# Initialize deployment configuration
meteor-cloud-run init

# Commit configuration to version control
git add .meteor-cloud-run/
git commit -m "Add meteor-cloud-run deployment configuration"
```

### 2. CI/CD Configuration
Set up automated deployments using service accounts or Workload Identity Federation.

### 3. Deploy
Both local and CI/CD use the same command:
```bash
meteor-cloud-run deploy
```

## Authentication Method

### Workload Identity Federation

 

## GitHub Actions Setup

#### Setup Steps

1. **Create service account:**
```bash
PROJECT_ID=$(gcloud config get-value project)

gcloud iam service-accounts create ci-cd-deploy \
  --display-name="CI/CD Deployment Service Account"
```

2. **Grant required permissions:**
```bash
SERVICE_ACCOUNT="ci-cd-deploy@${PROJECT_ID}.iam.gserviceaccount.com"

for role in roles/run.admin \
           roles/cloudbuild.builds.editor \
           roles/artifactregistry.admin \
           roles/secretmanager.admin \
           roles/storage.admin \
           roles/compute.admin \
           roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="$role"
done
```

3. **Set up Workload Identity Pool:**
```bash
# Create workload identity pool
gcloud iam workload-identity-pools create "github" \
  --project="$PROJECT_ID" \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Create workload identity provider
gcloud iam workload-identity-pools providers create-oidc "github" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="github" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.actor=assertion.actor" \
  --issuer-uri="https://token.actions.githubusercontent.com"
```

4. **Allow repository to impersonate service account:**
```bash
SERVICE_ACCOUNT="ci-cd-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
REPO="your-github-username/your-repository"

gcloud iam service-accounts add-iam-policy-binding $SERVICE_ACCOUNT \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
```

5. **Get your project details:**
```bash
# Get project number and ID
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')

echo "Project ID: $PROJECT_ID"
echo "Project Number: $PROJECT_NUMBER"
```

6. **GitHub Actions workflow:**

Replace `PROJECT_NUMBER` and `PROJECT_ID` with your actual values from step 5.

```yaml
name: Deploy to Cloud Run
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write  # Required for Workload Identity

    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: 'projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github'
          service_account: 'ci-cd-deploy@PROJECT_ID.iam.gserviceaccount.com'

      - name: Install meteor-cloud-run
        run: npm install -g meteor-cloud-run

      - name: Deploy to Cloud Run
        run: meteor-cloud-run deploy
```


## Environment Variables

### Project Configuration
Configuration comes from the committed `.meteor-cloud-run/config.json` file, ensuring consistent deployments across all environments.

### Optional Environment Variables

```bash
# Override project ID
export GOOGLE_CLOUD_PROJECT=my-project-id

# Override settings file
export METEOR_SETTINGS_FILE=production-settings.json

# Enable verbose logging
export VERBOSE=true
```

## Multi-Environment Deployments

### Branch-Based Deployments

```yaml
# GitHub Actions - Environment-specific deployments
name: Deploy
on:
  push:
    branches: [main, staging, develop]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write  # Required for Workload Identity
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: 'projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github'
          service_account: 'ci-cd-deploy@PROJECT_ID.iam.gserviceaccount.com'
      
      - run: npm install -g meteor-cloud-run
      
      # Deploy with different settings based on branch
      - name: Deploy Development
        if: github.ref == 'refs/heads/develop'
        run: meteor-cloud-run deploy --settings settings-dev.json
      
      - name: Deploy Staging
        if: github.ref == 'refs/heads/staging'
        run: meteor-cloud-run deploy --settings settings-staging.json
      
      - name: Deploy Production
        if: github.ref == 'refs/heads/main'
        run: meteor-cloud-run deploy --settings settings-production.json
```

### Separate Projects per Environment

Use different Google Cloud projects for each environment:

```yaml
jobs:
  deploy:
    strategy:
      matrix:
        include:
          - environment: development
            project: my-app-dev
            settings: settings-dev.json
          - environment: staging
            project: my-app-staging
            settings: settings-staging.json
          - environment: production
            project: my-app-prod
            settings: settings-prod.json
    
    steps:
      # ... auth steps ...
      - run: gcloud config set project ${{ matrix.project }}
      - run: meteor-cloud-run deploy --settings ${{ matrix.settings }}
```

## Required Permissions

### Service Account Permissions

```bash
# Required permissions for CI/CD with Workload Identity Federation
ROLES=(
  "roles/run.admin"                    # Deploy Cloud Run services
  "roles/cloudbuild.builds.editor"    # Trigger builds
  "roles/artifactregistry.admin"      # Push container images
  "roles/secretmanager.admin"         # Manage secrets
  "roles/storage.admin"               # Handle temporary files
  "roles/compute.admin"               # Manage load balancers (if needed)
  "roles/iam.serviceAccountUser"      # Use service account
)
```

## Troubleshooting CI/CD

### Authentication Test
```bash
gcloud auth list
gcloud projects list
```

### Common Issues

#### Permission Denied Errors

**Error:** `Permission denied on project`
```bash
# Solution: Verify service account has required roles
gcloud projects get-iam-policy $PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:$SERVICE_ACCOUNT"
```

#### API Not Enabled

**Error:** `API not enabled`
```bash
# Solution: Enable required APIs
gcloud services enable cloudbuild.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  compute.googleapis.com
```

#### Configuration Not Found

**Error:** `Configuration file not found`
```bash
# Solution: Ensure .meteor-cloud-run/ directory is committed
git add .meteor-cloud-run/
git commit -m "Add deployment configuration"
```

#### Build Timeouts

**Error:** `Build timeout exceeded`
```bash
# Solution: Increase timeout in cloudbuild.yaml or use larger machine
# This is automatically handled by meteor-cloud-run
```

### Debugging CI/CD Issues

**Enable verbose logging:**
```yaml
- run: meteor-cloud-run deploy --verbose
```

**Check service status:**
```yaml
- run: meteor-cloud-run info --verbose
```

**Test authentication separately:**
```yaml
- run: gcloud auth list
```

For advanced multi-app deployments, see [Multi-App Deployments](multi-app.md).