# Custom Domains Setup

Complete guide to setting up custom domains with automated HTTPS load balancers.

## Overview

meteor-cloud-run deploys your app with a default `*.run.app` domain that includes automatic HTTPS. For custom domains, meteor-cloud-run provides automated HTTPS load balancer setup with Google-managed SSL certificates.

## Quick Setup

### During Initialization

```bash
meteor-cloud-run init
# When prompted "Do you want to configure a custom domain?", answer Yes
# Enter your custom domain (e.g., app.example.com)
# Choose whether to create a static outbound IP for MongoDB Atlas
```

### Deploy and Configure DNS

```bash
meteor-cloud-run deploy
# Follow the DNS configuration instructions provided
```

## Custom Domain Configuration Process

### Step 1: Initialize with Custom Domain

Run `meteor-cloud-run init` and configure your domain:

**Prompts you'll see:**
- "Do you want to configure a custom domain?" → **Yes**
- "Enter your custom domain (e.g., app.example.com):" → **your-domain.com**
- "Create a static outbound IP for MongoDB Atlas whitelisting?" → **Yes/No**

**What gets configured:**
- Global static IP address for your domain
- Google-managed SSL certificates (automatically configured)
- Application Load Balancer
- HTTPS traffic with automatic SSL
- Optional outbound static IP for database whitelisting

### Step 2: Deploy Your Application

```bash
meteor-cloud-run deploy
```

**What happens during deployment:**
- Deploys your application to Cloud Run
- Creates load balancer infrastructure
- Configures SSL certificate provisioning
- Displays DNS configuration instructions

### Step 3: Configure DNS Records

After deployment, you'll see output like this:

```
🌐 Custom Domain Configuration Required:
┌─────────────────────────────────────────────────────────┐
│  Configure your DNS to point to the static IP address: │
│                                                         │
│  Type: A                                                │
│  Name: app (or @ for root domain)                       │
│  Value: 34.102.136.180                                  │
│  TTL: 300                                               │
└─────────────────────────────────────────────────────────┘
```

**Create DNS records in your DNS provider:**

For subdomain `app.example.com`:
```
Type: A
Name: app
Value: 34.102.136.180
TTL: 300
```

For root domain `example.com`:
```
Type: A
Name: @ (or leave blank)
Value: 34.102.136.180
TTL: 300
```

### Step 4: Wait for SSL Certificate Provisioning

Google-managed SSL certificates typically provision within 10-30 minutes after DNS is configured correctly.

**Check SSL status:**
```bash
meteor-cloud-run info --verbose
```

**Expected output during provisioning:**
```
SSL Certificate Status: PROVISIONING
Domain Status: example.com - PENDING_CERTIFICATE
```

**When ready:**
```
SSL Certificate Status: ACTIVE
Domain Status: example.com - ACTIVE
```

## DNS Configuration Details

### DNS Providers

The exact steps vary by DNS provider, but the concept is the same. Here's an example with Cloudflare:

#### Example: Cloudflare
1. Login to Cloudflare dashboard
2. Select your domain
3. Go to DNS → Records
4. Add A record pointing to the static IP
5. Ensure proxy status is "DNS only" (gray cloud)

#### Other Providers
For other DNS providers (Namecheap, GoDaddy, Google Domains, etc.), follow similar steps:
1. Login to your DNS provider's dashboard
2. Navigate to DNS management for your domain
3. Add an A record pointing to the static IP address
4. Set TTL to 300 seconds (5 minutes) for faster propagation
5. Save changes and wait for DNS propagation (typically 5-30 minutes)

### DNS Validation

**Check DNS propagation:**
```bash
# Check if DNS is propagated
nslookup app.example.com

# Or use online tools
dig app.example.com @8.8.8.8
```

**Common DNS issues:**
- **CNAME conflicts**: Remove any existing CNAME records for the same name
- **TTL too high**: Lower TTL to 300 seconds for faster propagation
- **Wrong record type**: Must be A record, not CNAME
- **Proxy enabled**: Disable CDN/proxy during initial setup

## Load Balancer Resources

When you configure a custom domain, meteor-cloud-run creates these Google Cloud resources:

### Core Resources
- **Static IP Address** - Global IPv4 address for your domain
- **SSL Certificate** - Google-managed certificate with automatic renewal
- **Network Endpoint Group (NEG)** - Links Cloud Run service to load balancer
- **Backend Service** - Manages traffic distribution and health checks
- **URL Map** - Routes requests to your service
- **HTTPS Target Proxy** - Handles SSL termination
- **Forwarding Rule** - Directs traffic from IP to proxy

### Optional Resources (if static outbound IP enabled)
- **VPC Connector** - Connects Cloud Run to VPC network
- **Cloud NAT Gateway** - Provides static outbound IP
- **Static IP Address (Regional)** - For outbound connections

**Resource naming pattern:**
```
{service-name}-ip              # Static IP
{service-name}-ssl-cert        # SSL Certificate  
{service-name}-neg             # Network Endpoint Group
{service-name}-backend         # Backend Service
{service-name}-url-map         # URL Map
{service-name}-https-proxy     # Target Proxy
{service-name}-https-rule      # Forwarding Rule
{service-name}-nat-ip          # NAT IP (if enabled)
```

## Static IP Addresses

### Inbound Traffic (Always Created)

**Load Balancer IP:**
- Global static IP for your custom domain
- Used for DNS A record configuration
- Always created when using custom domains
- Provides consistent endpoint for your application

 

### Outbound Traffic (Optional)

**NAT Gateway IP:**
- Regional static IP for outbound connections
- Created only when `useStaticIP: true`
- Routes all outbound traffic through this IP

 
## Cost Considerations

### Load Balancer Costs

**Monthly estimates (US regions):**
- Forwarding Rule: ~$18/month
- Static IP (in use): ~$7/month
- Data processing: $0.008-0.012 per GB

**With static outbound IP:**
- Cloud NAT Gateway: ~$32/month
- Static outbound IP: ~$7/month
- NAT data processing: $0.045 per GB

**Total monthly cost:**
- Custom domain only: ~$25-30/month
- Custom domain + static outbound: ~$55-70/month


**Configuration:**
```json
{
  "customDomain": "app.example.com",
  "useStaticIP": true
}
```

**Find your outbound IP:**
```bash
meteor-cloud-run info
# Look for "NAT Static IP" in the output
```

## SSL Certificate Management

### Google-Managed Certificates

**Features:**
- Automatic provisioning and renewal
- No certificate management required
- Supports multiple domains per certificate
- 90-day automatic renewal cycle

**Domain validation process:**
1. DNS A record must point to load balancer IP
2. Domain must be accessible via HTTP
3. Google validates domain ownership
4. Certificate provisioned automatically

**Troubleshooting SSL provisioning:**

**Certificate stuck in PROVISIONING:**
- Verify DNS A record is correct
- Check DNS propagation with `nslookup`
- Ensure no conflicting CNAME records
- Wait up to 30 minutes for validation
- Check for DNSSEC issues

**Certificate in FAILED_NOT_VISIBLE:**
- Domain is not pointing to the correct IP
- DNS propagation not complete
- Firewall blocking HTTP validation
- Domain not accessible publicly

### SSL Status Monitoring

```bash
# Check certificate status
meteor-cloud-run info --verbose

# Detailed certificate info (optional)
gcloud compute ssl-certificates describe {service-name}-ssl-cert --global
```

## Multiple Domains

### Adding Additional Domains

Currently, meteor-cloud-run supports one domain per service. For multiple domains:

**Option 1: Multiple Services**
```bash
# Deploy separate service for each domain
cd app
# Edit package.json: "name": "app-main"
meteor-cloud-run init
# Configure domain1.com

cd ../app-secondary
# Edit package.json: "name": "app-secondary"
meteor-cloud-run init
# Configure domain2.com
```


## Subdomain vs Root Domain

### Subdomain
```
Domain: app.example.com
DNS Record: A record for "app" pointing to static IP
```

 

### Root Domain
```
Domain: example.com
DNS Record: A record for "@" or blank pointing to static IP
```

 

### www Subdomain Handling

For root domain setup, consider www redirect:

```bash
# Use either example.com OR www.example.com during init
# Set up redirect at DNS level for the other if needed
```

## Troubleshooting

### Common DNS Issues

**Domain not accessible after DNS configuration:**
```bash
# Check DNS propagation
nslookup app.example.com 8.8.8.8

# Verify A record points to correct IP
meteor-cloud-run info | grep "Static IP"
```

**SSL Certificate not provisioning:**
```bash
# Check certificate status
meteor-cloud-run info --verbose

# Common fixes:
# 1. Verify DNS A record is correct
# 2. Remove any CNAME records for same name
# 3. Wait 30+ minutes for validation
# 4. Check domain is publicly accessible
```

### Load Balancer Issues

**"Failed to create load balancer" error:**
- Ensure billing is enabled
- Check API quotas in Cloud Console
- Verify required APIs are enabled
- Check IAM permissions

**Domain returns 404 or 502:**
- Verify Cloud Run service is deployed and healthy
- Check backend service configuration
- Ensure NEG is properly configured
- Verify SSL certificate is ACTIVE

**Slow response times:**
- Load balancer adds ~10-50ms latency
- Consider regional load balancer for single region
- Check Cloud Run service performance

### Migration Issues

**Migrating from domain mapping:**
```bash
# Automatic migration
meteor-cloud-run migrate-domain

# Manual cleanup if needed
gcloud run domain-mappings delete old-domain.com --region=us-central1
```

For more advanced configurations, see:
- [Resource Management](resource-management.md)
- [Multi-App Deployments](multi-app.md)