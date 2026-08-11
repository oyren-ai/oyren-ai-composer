# Deploy Your Own Private Oyren Infrastructure

**Keep your code 100% private.** Run Oyren agents on your own infrastructure without sharing code or data with Oyren's hosted service.

## Why Self-Host?

✅ **Complete Privacy** - Your code never leaves your servers  
✅ **Full Control** - Manage your own infrastructure and scaling  
✅ **Compliance Ready** - Meet data residency and security requirements  
✅ **No Vendor Lock-In** - Your infrastructure, your rules  
✅ **Cost Effective** - Starting at just $8/month  

## One-Click Deployment

```bash
# 1. Clone the repository
git clone https://github.com/oyren-ai/oyren-ai-composer.git
cd oyren-ai-composer/terraform

# 2. Run the one-click deploy script
./deploy.sh dev
```

That's it! The script will:
1. Check prerequisites (Terraform installation)
2. Help you configure your DigitalOcean credentials
3. Show you a cost estimate
4. Deploy your private infrastructure
5. Give you connection details

## What You Get

### Infrastructure
- 🖥️ **Secure VPC Network** - Isolated from public internet
- 🔒 **Hardened Ubuntu Server** - Automatic security updates
- 🐳 **Docker Pre-Installed** - Ready for containers
- 🔥 **Firewall Configuration** - SSH/HTTP/HTTPS only
- 🛡️ **SSH Hardening** - Key-only auth + fail2ban

### Privacy Guarantees
- ❌ **No Oyren Access** - We can't see your deployment
- ❌ **No Code Sharing** - Everything stays on your servers  
- ❌ **No Data Collection** - Your data is yours alone
- ✅ **Full Encryption** - Optional volume encryption available
- ✅ **Network Isolation** - Strict firewall rules

## Cost Breakdown

### Development ($8/month)
Perfect for individual developers:
- 1 server (1GB RAM, 1 vCPU, 25GB SSD)
- VPC with secure networking
- Firewall protection
- Suitable for: Testing, personal projects, learning

### Small Team ($40/month)
For small teams:
- 2 servers (2GB RAM each, 2 vCPU, 50GB SSD)
- Load balancer for reliability
- Higher traffic capacity
- Suitable for: Team projects, staging environments

### Production ($110/month)
For serious workloads:
- 3+ servers (4GB RAM each, 2 vCPU, 80GB SSD)
- Load balancer with health checks
- Automated backups
- 24/7 monitoring
- Suitable for: Production apps, enterprise use

💡 **Tip:** Start with dev ($8/month), scale up as needed

## Manual Setup (If You Prefer)

### Prerequisites

1. **DigitalOcean Account**
   - Sign up at https://digitalocean.com
   - Get $200 free credit for new accounts

2. **DigitalOcean API Token**
   - Go to https://cloud.digitalocean.com/account/api/tokens
   - Click "Generate New Token"
   - Name: "Terraform"
   - Scopes: Read & Write
   - Copy the token (you won't see it again!)

3. **Terraform Installed**
   ```bash
   # macOS
   brew install terraform

   # Ubuntu/Debian
   wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
   echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
   sudo apt update && sudo apt install terraform

   # Windows
   choco install terraform
   ```

4. **SSH Key (Optional but Recommended)**
   ```bash
   # Generate a new SSH key if you don't have one
   ssh-keygen -t ed25519 -C "your_email@example.com"

   # Add to DigitalOcean
   # https://cloud.digitalocean.com/account/security

   # Get your SSH key ID
   doctl compute ssh-key list
   ```

### Step-by-Step Deployment

```bash
# Navigate to dev environment
cd terraform/environments/dev

# Create your configuration
cp dev.tfvars.example dev.tfvars

# Edit with your details
vim dev.tfvars  # or nano, code, etc.
```

**Required changes in `dev.tfvars`:**
```hcl
# Your DigitalOcean API token
do_token = "dop_v1_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Your SSH key IDs (from: doctl compute ssh-key list)
ssh_key_ids = ["12345678"]

# Optional: Restrict SSH to your IP for better security
ssh_allowed_ips = ["your.ip.address.here/32"]
```

**Deploy:**
```bash
# Initialize Terraform
terraform init

# Preview what will be created
terraform plan -var-file="dev.tfvars"

# Deploy (type 'yes' when prompted)
terraform apply -var-file="dev.tfvars"
```

**Connect:**
```bash
# Get your server's IP
terraform output public_ips

# SSH into your server
ssh root@<your-ip>

# Or use the provided connection string
terraform output connection_string
```

## After Deployment

### Set Up Oyren Composer

```bash
# SSH into your server
ssh root@<your-ip>

# Navigate to the app directory (created by cloud-init)
cd /srv/script-runner

# Clone Oyren Composer
git clone https://github.com/oyren-ai/oyren-ai-composer.git app
cd app

# Configure environment
cp .env.example .env
vim .env

# Add your token to .env:
# SCRIPT_RUNNER_TOKEN=<your-secret-token>  # Generate with: openssl rand -hex 32

# Start the services
docker compose up -d

# Verify it's running
docker compose ps
curl http://localhost:3000/healthz
```

### Configure Your Domain (Optional)

If you want to use a custom domain:

1. **Enable DNS in your tfvars:**
   ```hcl
   enable_dns     = true
   domain_name    = "yourdomain.com"
   dns_subdomain  = "oyren"  # Will create oyren.yourdomain.com
   ```

2. **Re-apply:**
   ```bash
   terraform apply -var-file="dev.tfvars"
   ```

3. **Set up SSL with Caddy:**
   ```bash
   ssh root@<your-ip>
   # Caddy is already installed by cloud-init
   # Edit Caddyfile to add your domain
   ```

## Scaling Your Infrastructure

### Add More Servers

```hcl
# In dev.tfvars
droplet_count = 3  # Was 1
```

```bash
terraform apply -var-file="dev.tfvars"
```

### Upgrade Server Size

```hcl
# In dev.tfvars
droplet_size = "s-2vcpu-4gb"  # Was s-1vcpu-1gb
```

```bash
terraform apply -var-file="dev.tfvars"
```

### Add Storage Volume

```hcl
# In dev.tfvars
enable_volume = true
volume_size   = 100  # GB
```

```bash
terraform apply -var-file="dev.tfvars"

# SSH in and mount the volume
ssh root@<your-ip>
mkfs.ext4 /dev/disk/by-id/scsi-0DO_Volume_<volume-name>
mkdir -p /mnt/data
mount /dev/disk/by-id/scsi-0DO_Volume_<volume-name> /mnt/data
```

### Add S3-Compatible Storage (Spaces)

```hcl
# In dev.tfvars
enable_spaces      = true
spaces_bucket_name = "oyren-data-dev"
```

```bash
terraform apply -var-file="dev.tfvars"
```

## Managing Costs

### Monitor Your Spending

1. DigitalOcean Dashboard: https://cloud.digitalocean.com/billing
2. Set up billing alerts in your account
3. Review resources monthly

### Reduce Costs

**When Not in Use:**
```bash
# Power off (keeps data, minimal charges)
terraform apply -var-file="dev.tfvars" -var="droplet_count=0"

# Or completely destroy (no charges)
terraform destroy -var-file="dev.tfvars"
```

**Restore Later:**
```bash
terraform apply -var-file="dev.tfvars"
# Same configuration, fresh deployment
```

## Disaster Recovery

### Backup Your Infrastructure

**State File:**
```bash
# Terraform state is local by default
# Back it up regularly:
cp terraform.tfstate terraform.tfstate.backup
```

**Enable Remote State (Recommended):**

Uncomment in `environments/dev/main.tf`:
```hcl
backend "s3" {
  endpoint = "nyc3.digitaloceanspaces.com"
  bucket   = "oyren-terraform-state"
  key      = "composer/dev/terraform.tfstate"
  # ... other settings
}
```

**Application Data:**
```bash
# SSH into server
ssh root@<your-ip>

# Create backup
cd /srv/script-runner/app
docker compose exec <service> backup  # If available

# Or manually copy data
```

### Restore From Backup

```bash
# With your terraform state intact:
terraform apply -var-file="dev.tfvars"

# SSH in and restore application data
```

## Security Best Practices

### ✅ Recommended

1. **Use SSH Keys Only**
   - Never use password authentication
   - Keys are configured by default in this setup

2. **Restrict SSH Access**
   ```hcl
   ssh_allowed_ips = ["your.ip.address/32"]  # Your IP only
   ```

3. **Enable Automated Backups (Production)**
   ```hcl
   enable_backups = true  # In tfvars
   ```

4. **Keep Software Updated**
   ```bash
   ssh root@<your-ip>
   apt update && apt upgrade -y
   ```

5. **Monitor Access Logs**
   ```bash
   tail -f /var/log/auth.log  # SSH attempts
   ```

### 🔴 Never Do This

- ❌ Commit `.tfvars` files to git (contains secrets)
- ❌ Share your DigitalOcean API token
- ❌ Disable the firewall
- ❌ Allow password SSH authentication
- ❌ Run as root in production

## Troubleshooting

### "Error creating droplet: 422"
- **Cause:** Invalid SSH key IDs
- **Fix:** Run `doctl compute ssh-key list` and update `ssh_key_ids`

### Can't SSH into server
1. Wait 2-3 minutes for cloud-init to complete
2. Check firewall allows your IP
3. Verify SSH key is correct
4. Try: `ssh -v root@<ip>` for debug info

### "Error locking state"
- **Cause:** Another terraform process running
- **Fix:** `terraform force-unlock <lock-id>`

### Deployment costs more than expected
- Check resource count: `terraform state list`
- Review sizes: `terraform show`
- See current cost in DigitalOcean dashboard

## Getting Help

- 📖 [Terraform Docs](https://www.terraform.io/docs)
- 🔧 [DigitalOcean Provider Docs](https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs)
- 💬 [DigitalOcean Community](https://www.digitalocean.com/community)
- 🐛 [Open an Issue](https://github.com/oyren-ai/oyren-ai-composer/issues)

## Comparison: Self-Hosted vs Oyren Hosted

| Feature | Self-Hosted | Oyren Hosted |
|---------|-------------|--------------|
| **Code Privacy** | ✅ 100% private | ⚠️ Code shared with Oyren |
| **Data Control** | ✅ Full control | ⚠️ Managed by Oyren |
| **Setup Time** | ⏱️ 10 minutes | ⚡ Instant |
| **Cost** | 💰 $8-110/month | 💰 Pay-per-use |
| **Maintenance** | 🔧 You manage | ✅ Managed for you |
| **Scaling** | 🔧 Manual | ✅ Automatic |
| **Best For** | Enterprises, compliance | Quick start, hobbyists |

Choose **Self-Hosted** if:
- You need complete code privacy
- Compliance requires data on your infrastructure
- You want full control over security
- You have technical resources for maintenance

Choose **Oyren Hosted** if:
- You want zero setup and maintenance
- You trust Oyren with your code
- You want automatic scaling
- You prefer pay-as-you-go pricing

## Next Steps

1. ✅ Deploy your infrastructure with `./deploy.sh dev`
2. 📦 Set up Oyren Composer on your server
3. 🤖 Start running agents privately
4. 📈 Scale up as your needs grow
5. 🔒 Sleep well knowing your code is private

Questions? Check the [full documentation](README.md) or [open an issue](https://github.com/oyren-ai/oyren-ai-composer/issues).
