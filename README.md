# meteor-cloud-run

[![npm version](https://img.shields.io/npm/v/meteor-cloud-run.svg)](https://www.npmjs.com/package/meteor-cloud-run)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js Version](https://img.shields.io/node/v/meteor-cloud-run.svg)](https://nodejs.org)
[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-☕-orange)](https://buymeacoffee.com/sussition)

Deploy Meteor.js applications to Google Cloud Run with automatic scaling, secure secrets management, and zero-downtime updates.

## 🚀 Quick Start

```bash
# Install
npm install -g meteor-cloud-run

# In your Meteor app directory
meteor-cloud-run init   # Interactive setup
meteor-cloud-run deploy # Deploy to Cloud Run

# Your app is live at *.run.app!
```

The tool handles all Google Cloud setup, authentication, permissions, and configuration automatically.

## ✨ Key Features

- **🚀 One-Command Deployment** - Simple `init` then `deploy`
- **🔐 Secure Secrets** - MongoDB URLs stored in Google Secret Manager
- **🐳 Smart Containerization** - Automatic Meteor version detection
- **📦 Full Meteor Support** - Compatible with Meteor 1.x through 3.x
- **⚡ Zero-Downtime Updates** - Rolling deployments
- **💰 Cost Optimized** - Scale-to-zero capability
- **🔄 Settings Integration** - Works with existing settings.json files
- **🌐 Custom Domains** - Automated HTTPS load balancer setup

## 📋 Prerequisites

- Node.js >= 18
- Google Cloud account with billing enabled
- **New GCP project recommended** (for resource isolation and easier cleanup)
- Meteor.js application
- MongoDB database (e.g., MongoDB Atlas)
- Meteor settings.json file with database credentials

## 📥 Installation

```bash
npm install -g meteor-cloud-run
```

## 🎯 Basic Usage

### 1. Initialize Your Project

```bash
meteor-cloud-run init
```

This interactive command will:
- Guide you through Google Cloud authentication
- Help you select or create a Google Cloud project
- Auto-detect your Meteor version and settings
- Configure deployment options (CPU, memory, scaling)
- Generate all necessary deployment files

### 2. Deploy Your Application

```bash
meteor-cloud-run deploy
```

Your application will be deployed with:
- Automatic API enablement
- Service account permission configuration
- Secure secrets management
- Zero-downtime rolling updates

### 3. Manage Your Deployment

```bash
# View deployment information
meteor-cloud-run info

# List application secrets
meteor-cloud-run list-secrets

# Clean up resources
meteor-cloud-run remove
```

## 🛠️ Essential Commands

| Command | Description |
|---------|-------------|
| `meteor-cloud-run init` | Initialize deployment configuration |
| `meteor-cloud-run deploy` | Deploy your application |
| `meteor-cloud-run info` | Show deployment status and details |
| `meteor-cloud-run list-secrets` | View secrets used by the application |
| `meteor-cloud-run migrate-domain` | Migrate domain mapping to load balancer |
| `meteor-cloud-run remove` | Remove resources and configuration |
| `meteor-cloud-run remove --service-only` | Remove only the Cloud Run service |

For the complete command reference, see [docs/commands.md](docs/commands.md).

## 🔧 Configuration

### Settings.json Integration

meteor-cloud-run works seamlessly with your existing settings.json, just put environment variables under the `env` field in the `meteor-cloud-run` key:

#### Settings File Lifecycle

Settings are processed from your `settings.json` file and managed securely:

- **Processing**: During deployment, environment variables from `settings.json` are extracted
- **Secrets**: Sensitive values (containing passwords, secrets, keys, tokens) are stored in Google Secret Manager
- **Environment Variables**: Non-sensitive values are set as regular environment variables
- **Rollback**: Cloud Run revisions maintain references to their specific secret versions for safe rollbacks

Example settings.json structure:
```json
{
  "meteor-cloud-run": {
    "env": {
      "MONGO_URL": "mongodb+srv://user:pass@cluster.mongodb.net/db",
      "ROOT_URL": "https://myapp.com"
    }
  },
  "private": {
    "API_KEY": "your-secret-key"
  },
  "public": {
    "analyticsSettings": {
      "googleAnalytics": {
        "trackingId": "GA-XXXXX-X"
      }
    }
  }
}
```

### Generated Configuration

After running `meteor-cloud-run init`, you'll get:

```
.meteor-cloud-run/
├── config.json              # Deployment configuration
├── Dockerfile               # Container configuration
├── cloudbuild.yaml          # Build configuration
├── .dockerignore            # Build optimization
└── meteor-cloud-run-startup.sh  # Startup script
```

## 🌐 Custom Domains

Enable custom domains with automated HTTPS during initialization:

```bash
meteor-cloud-run init
# Answer "Yes" when prompted for custom domain
# Enter your domain (e.g., app.example.com)
# Deploy and configure DNS as instructed
```

This automatically sets up:
- Static IP address
- Google-managed SSL certificates
- Load balancer with HTTP → HTTPS redirect
- Optional static outbound IP for MongoDB Atlas firewall

For detailed setup instructions, see [docs/custom-domains.md](docs/custom-domains.md).

## 🚀 CI/CD Integration

### GitHub Actions (Workload Identity Federation)

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
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: 'projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github'
          service_account: 'ci-cd-deploy@PROJECT_ID.iam.gserviceaccount.com'
      - run: npm install -g meteor-cloud-run
      - run: meteor-cloud-run deploy
```

For setup steps, see [docs/ci-cd.md](docs/ci-cd.md).

## 💰 Pricing

**Basic deployment (no custom domain):**
- Cloud Run: $0 (free tier) or ~$5-15/month
- Container storage: ~$1-5/month
- **Total: ~$1-20/month**

**With custom domain:**
- Basic deployment: ~$1-20/month
- Load balancer: ~$18/month
- Static IP: ~$7/month
- **Total: ~$25-45/month**

For detailed cost breakdown and management, see [docs/resource-management.md](docs/resource-management.md).

## 📚 Documentation

### Getting Started
- [Installation & Prerequisites](docs/installation.md)
- [Configuration Guide](docs/configuration.md)
- [Commands Reference](docs/commands.md)

### Advanced Topics
- [Custom Domains Setup](docs/custom-domains.md)
- [CI/CD Integration](docs/ci-cd.md)
- [Multi-App Deployments](docs/multi-app.md)
- [Resource Management & Costs](docs/resource-management.md)

### Support
- [Troubleshooting Guide](docs/troubleshooting.md)

## 🆘 Quick Help

### Common Issues

⚠️ **Security note:** Using `--verbose` may expose sensitive values (e.g., `MONGO_URL`, API keys) in terminal output. Avoid using in public CI logs or shared sessions. See [Commands Reference](docs/commands.md#--verbose) for details.

**Authentication problems:**
```bash
gcloud auth application-default login
gcloud auth list  # Verify authentication
```

**Deployment failures:**
```bash
meteor-cloud-run info --verbose
meteor-cloud-run remove  # Clean up and retry
meteor-cloud-run deploy
```

**Cost management:**
```bash
meteor-cloud-run remove           # Remove unused deployments
meteor-cloud-run remove --keep-files  # Remove resources but keep files
```

For complete troubleshooting, see [docs/troubleshooting.md](docs/troubleshooting.md).

## 🔒 Security

- Secrets handling: Sensitive values (e.g., `MONGO_URL`, `MAIL_URL`, keys/tokens) are stored in Google Secret Manager; services read them at runtime.
- Data flow: `settings.json` → secrets created (or updated) → environment variables reference secrets in deployment.
- IAM: Grants secret access to the Cloud Run service account used for deployment.
- Auth in CI: Use GitHub Actions with Workload Identity Federation (requires `id-token: write`).
- Local files: No long-lived credentials are persisted by the tool; temporary files are cleaned up.

## 🤝 Contributing

Issues and pull requests are welcome! Please see:
- [GitHub Issues](https://github.com/sussition/meteor-cloud-run/issues)
- [Contributing Guidelines](CONTRIBUTING.md)

## 📄 License

GNU Affero General Public License v3.0 (AGPL-3.0) - see [LICENSE](LICENSE) file for details.

For commercial use or different licensing, please contact the author.

## ☕ Support the Project

If meteor-cloud-run helps your project, consider [buying me a coffee](https://buymeacoffee.com/sussition)!

---

**meteor-cloud-run** - Production-ready Meteor.js deployments to Google Cloud Run  
Created by Andrew Snow ([@sussition](https://x.com/sussition))

Let's connect: **hey(at)sussition(dot)com**

*This project is not affiliated with Meteor Software or Google Cloud.*