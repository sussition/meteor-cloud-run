# Changelog

All notable changes to meteor-cloud-run will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2025-10-05

### Fixed
- **Critical**: Improved deployment success detection to check both stdout and stderr
- Added verbose logging to help debug deployment status detection
- Now correctly detects successful deployments when gcloud outputs to stderr

### Improved
- **Docker Base Image Selection**: Smarter Meteor version to Docker image mapping
- Improved version fallback logic with curated list of known stable versions
- Better handling of patch versions (e.g., 3.3.2 now correctly maps to 3.3.2 base image)
- Added comprehensive version fallback tests

## [1.0.1] - 2025-10-05

### Fixed
- **Critical**: Fixed false deployment failure when gcloud builds returns warnings (exit code 1)
- Deployment now correctly succeeds when Cloud Build completes with IAM policy warnings
- Added deployment success detection via output indicators instead of relying solely on exit codes

### Improved
- **CI/CD Documentation**: Complete GitHub Actions setup with Workload Identity Federation
- Added GitHub Secrets integration instructions for secure settings management
- Added all required IAM permissions (including `serviceusage.serviceUsageAdmin`)
- Added Cloud SDK setup and gsutil credentials configuration
- Added Cloud Run service account permissions for secret access
- Clarified GitHub owner/organization setup for attribute conditions
- Added settings file path configuration examples for subdirectory projects

## [1.0.0] - 2025-10-05

### Initial Release

meteor-cloud-run 1.0.0 is the first stable release of this CLI tool for deploying Meteor.js applications to Google Cloud Run.

#### Features

**Core Commands**
- `init` - Interactive deployment configuration setup
- `deploy` - Build and deploy to Cloud Run with automatic secrets management
- `info` - Display deployment status and resource information
- `list-secrets` - View secrets used by the application
- `migrate-domain` - Migrate domain mapping to load balancer for custom domains
- `remove` - Clean up Cloud Run resources and configuration

**Deployment Features**
- Automatic Meteor version detection from `.meteor/release`
- Smart Docker base image selection (compatible with Meteor 1.x through 3.x)
- Google Secret Manager integration for sensitive data
- Support for both environment variables and secrets deployment modes
- Zero-downtime rolling deployments
- Automatic API enablement and service account configuration

**Settings Integration**
- Seamless `settings.json` file processing
- Automatic environment variable extraction
- Support for nested settings structures
- METEOR_SETTINGS JSON serialization
- Secure secrets management for sensitive values

**Custom Domain Support**
- Automated HTTPS load balancer setup
- Google-managed SSL certificates
- Static IP address allocation
- HTTP to HTTPS redirect configuration
- Optional static outbound IP for database firewall rules

**Generated Files**
- `Dockerfile` - Multi-stage build with Meteor version detection
- `cloudbuild.yaml` - Cloud Build configuration
- `.dockerignore` - Build optimization
- `.meteor-cloud-run/config.json` - Deployment configuration
- `meteor-cloud-run-startup.sh` - Container startup script

**Documentation**
- Comprehensive README with quick start guide
- Detailed documentation for all features:
  - Installation and prerequisites
  - Configuration guide
  - Commands reference
  - Custom domains setup
  - CI/CD integration (GitHub Actions with Workload Identity)
  - Multi-app deployment patterns
  - Resource management and cost optimization
  - Troubleshooting guide
- Contributing guidelines
- AGPL-3.0 license

**Development**
- Manual test suite for validation
- Command validation tests
- npm scripts for testing and development

#### Technical Details

**Dependencies**
- commander: CLI framework
- inquirer: Interactive prompts
- chalk: Terminal output formatting
- fs-extra: Enhanced file system operations

**Requirements**
- Node.js >= 18.0.0
- Google Cloud account with billing enabled
- Meteor.js application
- MongoDB database
- Meteor settings.json file

**Package**
- Package size: 66.0 kB (compressed)
- Unpacked size: 271.2 kB
- 20 files included in npm package

#### Security

- Sensitive values stored in Google Secret Manager
- No long-lived credentials persisted locally
- Automatic cleanup of temporary files
- IAM-based access control
- Support for Workload Identity Federation in CI/CD

---

## Release Notes

### For v1.0.0

This is the first production-ready release of meteor-cloud-run. The tool has been tested with:
- Meteor versions 1.x, 2.x, and 3.x
- Various MongoDB hosting providers (Atlas, etc.)
- Multiple Google Cloud regions
- Custom domain configurations
- CI/CD pipelines

### Upgrade Path

As this is the initial release, there is no upgrade path from previous versions.

### Known Limitations

- Custom domain setup requires manual DNS configuration
- Load balancer resources incur additional costs (~$25/month)
- Automated testing requires manual verification with real GCP projects
- CLI is interactive by default (scriptable modes may be added in future)

### Future Roadmap

Potential features for future releases:
- Automated integration tests with GCP
- Non-interactive mode for full CI/CD automation
- Multi-region deployments
- Automatic database migration support
- Built-in monitoring and alerting setup
- Support for additional cloud providers

---

[1.0.0]: https://github.com/sussition/meteor-cloud-run/releases/tag/v1.0.0
