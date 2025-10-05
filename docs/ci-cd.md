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
           roles/cloudbuild.builds.viewer \
           roles/artifactregistry.admin \
           roles/secretmanager.admin \
           roles/storage.admin \
           roles/compute.admin \
           roles/iam.serviceAccountUser \
           roles/serviceusage.serviceUsageAdmin \
           roles/resourcemanager.projectIamAdmin; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="$role"
done
```

**Permission notes**:
- `roles/cloudbuild.builds.viewer` - Required to view build logs in CI/CD pipelines
- `roles/resourcemanager.projectIamAdmin` - Allows automatic configuration of service account permissions for secrets

3. **Set up Workload Identity Pool:**

**Important**: In the command below, replace `YOUR_GITHUB_OWNER` with:
- Your **GitHub username** if the repo is under your personal account (e.g., `andsnw`)
- Your **organization name** if the repo is under an organization (e.g., `sussition`)

```bash
# Create workload identity pool
gcloud iam workload-identity-pools create "github" \
  --project="$PROJECT_ID" \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Create workload identity provider - REPLACE 'YOUR_GITHUB_OWNER' BELOW
gcloud iam workload-identity-pools providers create-oidc "github" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="github" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-condition="assertion.repository_owner == 'YOUR_GITHUB_OWNER'"
```

4. **Allow repository to impersonate service account:**

Replace `your-github-username/your-repository` with your actual repo (e.g., `sussition/meteor-cloud-run`).

```bash
SERVICE_ACCOUNT="ci-cd-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
REPO="your-github-username/your-repository"

gcloud iam service-accounts add-iam-policy-binding $SERVICE_ACCOUNT \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
```

5. **Grant Cloud Run service account permissions (optional):**

The CI/CD service account can now automatically configure permissions. However, if you want to set it up manually:

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**Note**: With `roles/resourcemanager.projectIamAdmin` granted in step 2, meteor-cloud-run will configure this automatically during deployment.

6. **Get your project details:**
```bash
# Get project number and ID (needed for workflow configuration)
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')

echo "Project ID: $PROJECT_ID"
echo "Project Number: $PROJECT_NUMBER"
```

7. **Add settings to GitHub Secrets:**

**Important**: Never commit `settings.json` files containing secrets to your repository.

- Go to your repository → Settings → Secrets and variables → Actions
- Click "New repository secret"
- Name: `METEOR_SETTINGS_PROD`
- Value: Paste the entire contents of your `settings-prod.json` file

Add to your `.gitignore`:
```gitignore
# Secrets and settings files
secrets/
settings*.json
!settings.example.json
```

8. **Create GitHub Actions workflow:**

Replace `PROJECT_NUMBER` and `PROJECT_ID` with your actual values from step 6.

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

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure gsutil credentials
        run: gcloud config set pass_credentials_to_gsutil true

      - name: Create settings file
        run: |
          mkdir -p secrets
          echo '${{ secrets.METEOR_SETTINGS_PROD }}' > secrets/settings-prod.json

      - name: Install meteor-cloud-run
        run: npm install -g meteor-cloud-run

      - name: Deploy to Cloud Run
        run: meteor-cloud-run deploy
```

**Important - Settings File Path Configuration:**

The path where you create the settings file in the workflow **must match** the path in your config file. Both paths are relative to where you run the deploy command.

For example, if your `.meteor-cloud-run/config.json` has:
```json
{
  "settingsFile": "secrets/settings-prod.json",
  ...
}
```

Then your workflow must create the file at the same relative path:
```yaml
- name: Create settings file
  run: |
    mkdir -p secrets
    echo '${{ secrets.METEOR_SETTINGS_PROD }}' > secrets/settings-prod.json
```

If your Meteor app is in a subdirectory (e.g., `webapp/`), adjust both accordingly:
```yaml
- name: Create settings file
  run: |
    mkdir -p webapp/secrets
    echo '${{ secrets.METEOR_SETTINGS_PROD }}' > webapp/secrets/settings-prod.json

- name: Deploy to Cloud Run
  run: |
    cd webapp
    meteor-cloud-run deploy
```

**Notes:**
- The settings file is created temporarily during the workflow from GitHub Secrets
- It's never committed to the repository
- Each deployment uses fresh secrets from GitHub Secrets

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

Create separate GitHub Secrets for each environment:
- `METEOR_SETTINGS_DEV`
- `METEOR_SETTINGS_STAGING`
- `METEOR_SETTINGS_PROD`

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

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure gsutil credentials
        run: gcloud config set pass_credentials_to_gsutil true

      - name: Install meteor-cloud-run
        run: npm install -g meteor-cloud-run

      # Deploy Development
      - name: Create development settings file
        if: github.ref == 'refs/heads/develop'
        run: |
          mkdir -p secrets
          echo '${{ secrets.METEOR_SETTINGS_DEV }}' > secrets/settings-dev.json

      - name: Deploy Development
        if: github.ref == 'refs/heads/develop'
        run: meteor-cloud-run deploy --settings secrets/settings-dev.json

      # Deploy Staging
      - name: Create staging settings file
        if: github.ref == 'refs/heads/staging'
        run: |
          mkdir -p secrets
          echo '${{ secrets.METEOR_SETTINGS_STAGING }}' > secrets/settings-staging.json

      - name: Deploy Staging
        if: github.ref == 'refs/heads/staging'
        run: meteor-cloud-run deploy --settings secrets/settings-staging.json

      # Deploy Production
      - name: Create production settings file
        if: github.ref == 'refs/heads/main'
        run: |
          mkdir -p secrets
          echo '${{ secrets.METEOR_SETTINGS_PROD }}' > secrets/settings-prod.json

      - name: Deploy Production
        if: github.ref == 'refs/heads/main'
        run: meteor-cloud-run deploy --settings secrets/settings-prod.json
```

### Separate Projects per Environment

Use different Google Cloud projects for each environment. You'll need to set up Workload Identity Federation for each project and create corresponding GitHub Secrets.

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    strategy:
      matrix:
        include:
          - environment: development
            project_id: my-app-dev
            project_number: '123456789'
            settings_secret: METEOR_SETTINGS_DEV
          - environment: staging
            project_id: my-app-staging
            project_number: '987654321'
            settings_secret: METEOR_SETTINGS_STAGING
          - environment: production
            project_id: my-app-prod
            project_number: '456789123'
            settings_secret: METEOR_SETTINGS_PROD

    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: 'projects/${{ matrix.project_number }}/locations/global/workloadIdentityPools/github/providers/github'
          service_account: 'ci-cd-deploy@${{ matrix.project_id }}.iam.gserviceaccount.com'

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure gsutil credentials
        run: gcloud config set pass_credentials_to_gsutil true

      - name: Create settings file
        run: |
          mkdir -p secrets
          echo '${{ secrets[matrix.settings_secret] }}' > secrets/settings-${{ matrix.environment }}.json

      - name: Install meteor-cloud-run
        run: npm install -g meteor-cloud-run

      - name: Deploy to ${{ matrix.environment }}
        run: meteor-cloud-run deploy --settings secrets/settings-${{ matrix.environment }}.json
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