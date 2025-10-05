# Commands Reference

Complete reference for all meteor-cloud-run commands.

## Core Commands

### `meteor-cloud-run init`

Initialize deployment configuration for your Meteor application.

```bash
meteor-cloud-run init [options]
```

**Options:**
- `--settings <file>` - Specify settings file path
- `--verbose` - Show detailed output

**What it does:**
- Checks Google Cloud CLI installation and authentication
- Lists available Google Cloud projects
- Auto-detects Meteor version from `.meteor/release`
- Auto-detects settings.json file
- Prompts for deployment configuration:
  - Project ID and region
  - CPU and memory allocation
  - Scaling configuration (min/max instances)
  - Concurrency settings
  - Custom domain setup (optional)
- Generates deployment files in `.meteor-cloud-run/` directory

**Generated files:**
- `config.json` - Deployment configuration
- `Dockerfile` - Container configuration
- `cloudbuild.yaml` - Build configuration
- `.dockerignore` - Build optimization
- `meteor-cloud-run-startup.sh` - Startup script

### `meteor-cloud-run deploy`

Deploy your application to Google Cloud Run.

```bash
meteor-cloud-run deploy [options]
```

**Options:**
- `--settings <file>` - Use different settings file for this deployment
- `--skip-migration` - Skip automatic domain mapping migration check (for existing deployments)
- `--verbose` - Show detailed build and deployment logs

**What it does:**
- Validates configuration and authentication
- Enables required Google Cloud APIs
- Configures service account permissions
- Processes settings.json and creates secrets
- Builds Docker container using Cloud Build
- Deploys to Cloud Run with zero-downtime
- Creates load balancer for custom domains (if configured)
- Updates ROOT_URL with deployment URL

### `meteor-cloud-run info`

Display comprehensive deployment information.

```bash
meteor-cloud-run info [options]
```

**Options:**
- `--verbose` - Show detailed debugging information

**Information shown:**
- Configuration details (service name, region, resources)
- Cloud Run service status and URL
- Load balancer and custom domain status
- Static IP addresses (inbound and outbound)
- SSL certificate status and domain validation
- Secret Manager secrets and versions
- Recent container images in Artifact Registry
- Helpful management commands

## Management Commands



### `meteor-cloud-run remove`

Remove deployment resources and configuration.

```bash
meteor-cloud-run remove [options]
```

**Options:**
- `--keep-files` - Keep generated deployment files in `.meteor-cloud-run/` directory
- `--service-only` - Only remove the Cloud Run service (useful for fixing deployment conflicts)
- `--verbose` - Show detailed debugging information

**Full removal (default):**
- Cloud Run service
- Load balancer resources (if any)
- Static IP addresses
- SSL certificates
- All related compute resources

**Service-only removal (`--service-only`):**
- Cloud Run service only
- Keeps all other resources intact
- Useful for redeploying with fresh configuration

**What it keeps by default:**
- Secrets in Secret Manager (for data safety)
- Container images in Artifact Registry

### `meteor-cloud-run list-secrets`

List all Secret Manager secrets for the current application.

```bash
meteor-cloud-run list-secrets
```

Shows:
- Secret names
- Creation dates
- Number of versions
- Last accessed time


## Custom Domain Commands

### `meteor-cloud-run migrate-domain`

Manually migrate from domain mapping to load balancer.

```bash
meteor-cloud-run migrate-domain [options]
```

**Options:**
- `--verbose` - Show detailed debugging information

**What it does:**
- Detects existing domain mapping configuration
- Creates new load balancer with static IP
- Removes old domain mapping
- Updates configuration automatically
- Displays new DNS configuration instructions

**Use case:** Upgrading existing deployments from the legacy domain mapping approach to static IP load balancers.

## Global Options

All commands support these global options:

### `--project <project-id>`

Override the Google Cloud project ID from configuration or environment.

```bash
meteor-cloud-run <command> --project my-other-project
```

### `--service-account-key <path-or-json>`

Specify path to service account JSON file or provide base64/raw JSON directly.

```bash
meteor-cloud-run <command> --service-account-key /path/to/key.json
```

### `--verbose`

Show detailed output and debugging information.

**⚠️ Security Warning:** The `--verbose` flag may expose sensitive information including database connection strings (`MONGO_URL`), API keys, and other secrets in terminal output and logs. Use with caution, especially in CI/CD environments where logs may be stored or publicly visible.

```bash
meteor-cloud-run <command> --verbose
```

**Recommended use:**
- Local development and debugging in private terminal sessions

**Avoid using in:**
- CI/CD pipelines (GitHub Actions, GitLab CI, etc.) where logs are stored
- Shared or recorded terminal sessions
- When redirecting output to files that may be shared

### `--help`

Show help for any command.

```bash
meteor-cloud-run <command> --help
```

### `--version`

Show meteor-cloud-run version.

```bash
meteor-cloud-run --version
```

## Command Usage Patterns

### Initial Setup
```bash
meteor-cloud-run init
meteor-cloud-run deploy
meteor-cloud-run info
```

### Regular Development
```bash
# Deploy changes
meteor-cloud-run deploy

# Check status
meteor-cloud-run info

# Use different settings
meteor-cloud-run deploy --settings production-settings.json
```

### Maintenance
```bash
# View application secrets
meteor-cloud-run list-secrets

# Migrate domain mapping to load balancer
meteor-cloud-run migrate-domain

# Check SSL status in Google Cloud Console
```

### Troubleshooting
```bash
# Detailed deployment info
meteor-cloud-run info --verbose

# Clean deployment with full logs
meteor-cloud-run deploy --verbose

# Remove just the service and redeploy
meteor-cloud-run remove --service-only
meteor-cloud-run deploy

# Complete reset
meteor-cloud-run remove
meteor-cloud-run init
meteor-cloud-run deploy
```

## Exit Codes

meteor-cloud-run uses standard exit codes:

- `0` - Success
- `1` - General error
- `2` - Invalid usage/arguments
- `130` - Process interrupted (Ctrl+C)

## Configuration File Location

Commands look for configuration in this order:

1. `.meteor-cloud-run/config.json` (current)
2. `.meteor-cloud-run/.meteor-cloud-run.json` (migration)
3. `.meteor-cloud-run.json` (legacy)

The tool automatically migrates from legacy locations to the current standard.

## Environment Variables

### Settings Path Override
```bash
export METEOR_SETTINGS_FILE=/path/to/settings.json
meteor-cloud-run deploy
```

### Project Override
```bash
export GOOGLE_CLOUD_PROJECT=my-project-id
meteor-cloud-run deploy
```

### Verbose Mode
```bash
export VERBOSE=true
meteor-cloud-run deploy
```

## Advanced Usage

### Batch Operations
```bash
# Deploy multiple apps in sequence
for app in app1 app2 app3; do
  cd $app && meteor-cloud-run deploy
done
```

### Conditional Deployment
```bash
# Deploy only if tests pass
npm test && meteor-cloud-run deploy
```

### Configuration Validation
```bash
# Verify config without deploying
meteor-cloud-run info --verbose
```

For more advanced usage patterns, see:
- [CI/CD Integration](ci-cd.md)
- [Multi-App Deployments](multi-app.md)