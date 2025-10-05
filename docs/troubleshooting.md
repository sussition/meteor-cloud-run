# Troubleshooting Guide

Comprehensive troubleshooting guide for common meteor-cloud-run issues and their solutions.

## Quick Diagnostics

### Authentication Test
```bash
gcloud auth list
gcloud projects list
```
These commands test Google Cloud authentication and show accessible projects.

### Deployment Status
```bash
meteor-cloud-run info --verbose
```

Shows detailed deployment status, resource configuration, and helpful debugging information.

⚠️ **Security note:** Verbose output may expose sensitive values. See the [--verbose security warning](commands.md#--verbose) for details.

## Authentication Issues

### Problem: "No active account found"

**Symptoms:**
- `gcloud: command not found`
- `No active account found`
- `Permission denied` errors

**Solutions:**

1. **Install Google Cloud CLI:**
   ```bash
   # Check if installed
   gcloud --version
   
   # If not installed, visit: https://cloud.google.com/sdk/docs/install
   ```

2. **Authenticate with Google Cloud:**
   ```bash
   gcloud auth application-default login
   gcloud auth login
   ```

3. **Set active project:**
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```

4. **Verify authentication:**
   ```bash
   gcloud auth list
   gcloud projects list
   ```

### Problem: "Permission denied on project"

**Symptoms:**
- `Permission denied`
- `User does not have permission`
- `403 Forbidden` errors

**Solutions:**

1. **Check your account has required permissions:**
   ```bash
   # Your account needs Editor or Owner role
   gcloud projects get-iam-policy PROJECT_ID \
     --flatten="bindings[].members" \
     --filter="bindings.members:user:your-email@domain.com"
   ```

2. **Grant required permissions (if you're project owner):**
   ```bash
   PROJECT_ID=$(gcloud config get-value project)
   PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
   
   # Grant Editor role to default service accounts
   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
     --role="roles/editor"
   
   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
     --role="roles/editor"
   ```

3. **Check organization policies:**
   ```bash
   # Some organizations restrict public access
   # Contact your Google Cloud administrator if needed
   ```

## Deployment Issues

### Problem: "Configuration file not found"

**Symptoms:**
- `Configuration file not found`
- `No .meteor-cloud-run/config.json found`

**Solutions:**

1. **Initialize configuration:**
   ```bash
   meteor-cloud-run init
   ```

2. **Check you're in the right directory:**
   ```bash
   ls .meteor-cloud-run/config.json
   ```

3. **Verify Meteor app directory:**
   ```bash
   ls .meteor/release  # Should exist in Meteor app directory
   ```

### Problem: "API not enabled"

**Symptoms:**
- `API [cloudbuild.googleapis.com] not enabled`
- `API [run.googleapis.com] not enabled`
- `API [artifactregistry.googleapis.com] not enabled`

**Solutions:**

1. **Enable APIs automatically:**
   ```bash
   # meteor-cloud-run enables APIs automatically during deployment
   meteor-cloud-run deploy --verbose
   ```

2. **Enable APIs manually:**
   ```bash
   gcloud services enable cloudbuild.googleapis.com \
     run.googleapis.com \
     artifactregistry.googleapis.com \
     secretmanager.googleapis.com \
     storage.googleapis.com \
     compute.googleapis.com
   ```

3. **Check API status:**
   ```bash
   gcloud services list --enabled --filter="name:(cloudbuild OR run OR artifactregistry)"
   ```

### Problem: Build failures

**Symptoms:**
- Build timeout errors
- `meteor: command not found` in build logs
- Package installation failures
- Memory or disk space errors

**Solutions:**

1. **Check build logs:**
   ```bash
   meteor-cloud-run deploy --verbose
   # Look for specific error messages in the build output
   ```

2. **Common build issues:**

   **Meteor version detection failed:**
   ```bash
   # Ensure .meteor/release file exists
   ls .meteor/release
   
   # Check Meteor version format
   cat .meteor/release
   # Should show: METEOR@3.2 (or similar)
   ```

   **Node modules issues:**
   ```bash
   # Clear local node_modules (they're excluded from build)
   rm -rf node_modules
   
   # Check package.json exists
   ls package.json
   ```

   **Build timeout:**
   ```bash
   # Large apps may need more time - this is handled automatically
   # Check for packages that take long to compile
   ```

3. **Verify Dockerfile generation:**
   ```bash
   cat .meteor-cloud-run/Dockerfile
   # Should use correct base image for your Meteor version
   ```

## Custom Domain Issues

### Problem: SSL certificate not provisioning

**Symptoms:**
- Certificate status stuck in `PROVISIONING`
- Domain returns SSL errors
- Certificate status shows `FAILED_NOT_VISIBLE`

**Solutions:**

1. **Check DNS configuration:**
   ```bash
   # Verify DNS A record points to correct IP
   nslookup your-domain.com
   
   # Get the correct IP from meteor-cloud-run
   meteor-cloud-run info | grep "Static IP"
   ```

2. **Check certificate status:**
   ```bash
   meteor-cloud-run info --verbose
   ```

3. **Common DNS fixes:**
   ```bash
   # Remove any CNAME records for the same name
   # Ensure TTL is set to 300 seconds or lower
   # Wait 30+ minutes for validation
   ```

4. **Verify domain is publicly accessible:**
   ```bash
   curl -I http://your-domain.com
   # Should return HTTP response (redirects are OK)
   ```

### Problem: Domain returns 404 or 502

**Symptoms:**
- Domain loads but shows 404 error
- 502 Bad Gateway errors
- Load balancer timeout errors

**Solutions:**

1. **Check Cloud Run service status:**
   ```bash
   meteor-cloud-run info
   # Verify service is "Running"
   ```

2. **Check load balancer configuration:**
   ```bash
   # Verify backend service is healthy
   gcloud compute backend-services get-health {service-name}-backend --global
   ```

3. **Test direct Cloud Run URL:**
   ```bash
   # Get Cloud Run URL from info command
   meteor-cloud-run info
   # Test the *.run.app URL directly
   ```

## Database Connection Issues

### Problem: "MongoNetworkError" or connection timeouts

**Symptoms:**
- App starts but crashes with MongoDB errors
- Connection timeout errors
- "No suitable servers found" errors

**Solutions:**

1. **Verify MongoDB URL format:**
   ```json
   {
     "meteor-cloud-run": {
       "env": {
         "MONGO_URL": "mongodb+srv://username:password@cluster.mongodb.net/database"
       }
     }
   }
   ```

2. **Test MongoDB connection locally:**
   ```bash
   # Test connection using mongo client or MongoDB Compass
   mongosh "mongodb+srv://username:password@cluster.mongodb.net/database"
   ```

3. **Check MongoDB Atlas network access:**
   - Login to MongoDB Atlas
   - Go to Network Access
   - Add `0.0.0.0/0` for testing (restrict later)
   - Or use static outbound IP from `meteor-cloud-run info`

4. **Check secret creation:**
   ```bash
   meteor-cloud-run list-secrets
   # Should show mongodb-url secret
   ```

## Organization Policy Issues

### Problem: "FAILED_PRECONDITION: One or more users named in the policy do not belong to a permitted customer"

**Symptoms:**
- Deployment succeeds but app returns 403
- `allUsers` policy binding fails
- "Customer" policy errors

**Cause:** Organization policy blocks public access (`allUsers` IAM bindings).

**Solutions:**

1. **Grant access to specific users (development):**
   ```bash
   gcloud run services add-iam-policy-binding YOUR_SERVICE_NAME \
     --member=user:your-email@domain.com \
     --role=roles/run.invoker \
     --region=YOUR_REGION
   ```

2. **Use Google Groups (teams):**
   ```bash
   gcloud run services add-iam-policy-binding YOUR_SERVICE_NAME \
     --member=group:team@yourdomain.com \
     --role=roles/run.invoker \
     --region=YOUR_REGION
   ```

3. **Use authenticated users (fallback):**
   ```bash
   # meteor-cloud-run automatically tries this fallback
   # Requires users to be logged into any Google account
   ```

4. **Test locally with proxy:**
   ```bash
   gcloud run services proxy YOUR_SERVICE_NAME --region=YOUR_REGION
   # Access at http://localhost:8080
   ```

### Problem: "The resource 'projects/PROJECT/global/networks/default' was not found"

**Symptoms:**
- VPC network errors during load balancer creation
- "Network not found" errors
- Custom domain setup fails

**Solutions:**

1. **meteor-cloud-run handles this automatically:**
   ```bash
   # The tool creates networks as needed
   meteor-cloud-run deploy --verbose
   ```

2. **Manual network creation (if needed):**
   ```bash
   # Create default network
   gcloud compute networks create default --subnet-mode=auto
   
   # Create required firewall rules
   gcloud compute firewall-rules create allow-internal \
     --network=default \
     --allow=tcp,udp,icmp \
     --source-ranges=10.128.0.0/9
   ```

## CI/CD Issues

### Problem: Authentication in CI/CD

**Symptoms:**
- CI/CD pipeline fails with authentication errors
- Service account permission errors
- "No active account" in CI logs

**Solutions:**

1. **Verify service account setup:**
   ```bash
   # Check service account exists
   gcloud iam service-accounts list --filter="displayName:CI/CD"
   
   # Check permissions
   gcloud projects get-iam-policy PROJECT_ID \
     --flatten="bindings[].members" \
     --filter="bindings.members:serviceAccount:sa@project.iam.gserviceaccount.com"
   ```

2. **Test service account locally:**
   ```bash
   # Download service account key for testing
   gcloud iam service-accounts keys create test-key.json \
     --iam-account=sa@project.iam.gserviceaccount.com
   
   # Test authentication
   export GOOGLE_APPLICATION_CREDENTIALS=test-key.json
   gcloud auth list
   
   # Clean up
   rm test-key.json
   ```

3. **Common CI/CD fixes:**
   ```yaml
   # GitHub Actions - ensure proper auth step
   - uses: google-github-actions/auth@v2
     with:
       credentials_json: ${{ secrets.GCP_SA_KEY }}
   
   # GitLab CI - check base64 encoding
   - echo $GCLOUD_SERVICE_KEY | base64 -d > /tmp/gcloud-key.json
   - gcloud auth activate-service-account --key-file /tmp/gcloud-key.json
   ```

## Performance Issues

### Problem: Slow cold starts

**Symptoms:**
- First request after inactivity is very slow
- Timeout errors on initial requests
- App works fine after "warming up"

**Solutions:**

1. **Configure minimum instances:**
   ```json
   {
     "minInstances": 1,
     "maxInstances": 10
   }
   ```

2. **Optimize container size:**
   ```bash
   # Check container image size
   gcloud container images list-tags gcr.io/PROJECT_ID/SERVICE_NAME
   ```

3. **Reduce startup time:**
   ```bash
   # Check startup logs
   gcloud logging read "resource.type=cloud_run_revision"
   ```

### Problem: High memory usage

**Symptoms:**
- Out of memory errors
- Container restarts
- Performance degradation

**Solutions:**

1. **Increase memory allocation:**
   ```json
   {
     "memory": "1Gi"  // Increase from 512Mi
   }
   ```

2. **Monitor memory usage:**
   ```bash
   # Check metrics in Cloud Console
   # Monitoring > Metrics Explorer > Cloud Run
   ```

## Debugging Commands

### Get detailed logs
```bash
# Application logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=SERVICE_NAME" --limit=50

# Build logs
gcloud logging read "resource.type=build" --limit=10

# Load balancer logs
gcloud logging read "resource.type=http_load_balancer" --limit=20
```

### Check resource quotas
```bash
# Check quotas
gcloud compute project-info describe --format="table(quotas.metric,quotas.limit,quotas.usage)"

# Check specific quotas
gcloud compute regions describe REGION --format="table(quotas.metric,quotas.limit,quotas.usage)"
```

### Verify service configuration
```bash
# Get service details
gcloud run services describe SERVICE_NAME --region=REGION --format=json

# Check revisions
gcloud run revisions list --service=SERVICE_NAME --region=REGION
```

## Getting Help

### Before asking for help:

1. **Run diagnostics:**
   ```bash
   gcloud auth list
   meteor-cloud-run info --verbose
   ```

2. **Check recent changes:**
   ```bash
   git log --oneline -5
   ```

3. **Collect error information:**
   ```bash
   meteor-cloud-run deploy --verbose 2>&1 | tee deployment.log
   ```

### Where to get help:

- **GitHub Issues**: [meteor-cloud-run/issues](https://github.com/sussition/meteor-cloud-run/issues)
- **Google Cloud Support**: For Google Cloud specific issues
- **Meteor Forums**: For Meteor.js related questions

### Information to include:

- meteor-cloud-run version: `meteor-cloud-run --version`
- Meteor version: `meteor --version`
- Node.js version: `node --version`
- Operating system
- Complete error messages
- Output of `meteor-cloud-run info --verbose`

## Common Error Messages

### "INVALID_ARGUMENT: The request has errors"
- Usually indicates malformed configuration
- Check `.meteor-cloud-run/config.json` syntax
- Run `meteor-cloud-run init` to regenerate

### "RESOURCE_EXHAUSTED: Quota exceeded"
- Check Google Cloud quotas
- Request quota increase if needed
- Consider different region

### "DEADLINE_EXCEEDED: The build did not complete"
- Build timeout (usually 20 minutes max)
- Check for packages that take long to compile
- Consider optimizing build process

### "FAILED_PRECONDITION: Invalid resource name"
- Service name contains invalid characters
- Check `package.json` name field
- Update `package.json` name with valid characters (lowercase, letters, numbers, hyphens only)

For more specific issues, see the relevant documentation:
- [Configuration Guide](configuration.md)
- [Custom Domains](custom-domains.md)
- [CI/CD Integration](ci-cd.md)