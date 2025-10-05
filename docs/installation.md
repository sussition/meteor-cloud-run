# Installation & Prerequisites

Complete guide to installing meteor-cloud-run and setting up your environment.

## Prerequisites

### Required Software
- **Node.js >= 18** - [Download Node.js](https://nodejs.org/)
- **Google Cloud CLI** - [Installation Guide](https://cloud.google.com/sdk/docs/install)
- **Git**

### Required Accounts & Services
- **Google Cloud Account** with billing enabled
- **MongoDB Database** (e.g., [MongoDB Atlas](https://www.mongodb.com/atlas))
- **Meteor.js Application** (1.x through 3.x supported)

### Google Cloud Requirements
- Google Cloud project with billing enabled
- Required APIs will be enabled automatically during deployment
- Service account permissions configured automatically

## Installation

### Install meteor-cloud-run

```bash
npm install -g meteor-cloud-run
```

### Verify Installation

```bash
meteor-cloud-run --version
```

## Google Cloud CLI Setup

### 1. Install Google Cloud CLI

Follow the [official installation guide](https://cloud.google.com/sdk/docs/install) for your operating system:

- **Linux/macOS**: Use the installer script
- **Windows**: Download the installer
- **Docker**: Use the `google/cloud-sdk` image

### 2. Initialize Google Cloud CLI

```bash
# Initialize and authenticate
gcloud init

# Set up application default credentials
gcloud auth application-default login
```

### 3. Verify Setup

```bash
# Check authentication
gcloud auth list

# Check current project
gcloud config get-value project

# Test with meteor-cloud-run
gcloud auth list
```

## Project Setup

### 1. Prepare Your Meteor Application

Ensure your Meteor app is ready:

```bash
cd /path/to/your/meteor/app

# Verify Meteor is working
meteor --version

# Ensure package.json exists (for service naming)
ls package.json

# Verify settings.json exists
ls settings.json
```

### 2. Settings.json Requirements

Your settings.json should contain database configuration:

```json
{
  "meteor-cloud-run": {
    "env": {
      "MONGO_URL": "mongodb+srv://username:password@cluster.mongodb.net/database",
      "ROOT_URL": "https://your-domain.com"
    }
  }
}
```

Alternative formats are also supported:
- Galaxy format: `"galaxy.meteor.com".env`
- Standard: `"env"` at root level

## Google Cloud Project Setup

### Create a New Project (Recommended)

**Best practice**: Use a dedicated GCP project for easier resource management, cost tracking, and cleanup.

```bash
# Create new project
gcloud projects create my-meteor-app --name="My Meteor App"

# Set as active project
gcloud config set project my-meteor-app
```

### Enable Billing

1. Visit [Google Cloud Console](https://console.cloud.google.com/billing)
2. Select your project
3. Link a billing account

**Note**: meteor-cloud-run will automatically enable required APIs during deployment.

## Verification

### Test Complete Setup

```bash
# In your Meteor app directory
gcloud auth list
```

This command verifies:
- Google Cloud CLI authentication
- Project access permissions
- Required API availability

### Common Issues During Setup

**Error: `gcloud: command not found`**
- Solution: Install Google Cloud CLI and restart terminal

**Error: `No active account found`**
- Solution: Run `gcloud auth application-default login`

**Error: `Project not found`**
- Solution: Set project with `gcloud config set project PROJECT_ID`

**Error: `Billing not enabled`**
- Solution: Enable billing in Google Cloud Console

## Next Steps

Once installation is complete:

1. **Initialize your deployment**: `meteor-cloud-run init`
2. **Deploy your application**: `meteor-cloud-run deploy`
3. **View deployment info**: `meteor-cloud-run info`

See the [Configuration Guide](configuration.md) for detailed setup options.

## Troubleshooting

For installation and setup issues, see:
- [Troubleshooting Guide](troubleshooting.md)
- [Authentication Problems](troubleshooting.md#authentication-test)

## Docker Requirements

**Note**: You don't need to install Docker locally. meteor-cloud-run uses Google Cloud Build for containerization. However, if you want to test locally:

```bash
# Optional: Install Docker for local testing
docker --version
```