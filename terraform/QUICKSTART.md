# Terraform Quick Start Guide

This guide will help you get started with managing Oyren Composer infrastructure using Terraform.

## Prerequisites

1. **Install Terraform**
   ```bash
   # macOS
   brew tap hashicorp/tap
   brew install hashicorp/tap/terraform

   # Linux
   wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
   echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
   sudo apt update && sudo apt install terraform

   # Verify installation
   terraform version
   ```

2. **Get DigitalOcean API Token**
   - Go to https://cloud.digitalocean.com/account/api/tokens
   - Click "Generate New Token"
   - Name: "Terraform Access"
   - Scopes: Read & Write
   - Copy the token (you won't see it again!)

3. **Get SSH Key IDs** (optional but recommended)
   ```bash
   # Install doctl if you haven't
   brew install doctl  # macOS
   # or download from https://github.com/digitalocean/doctl/releases

   # Authenticate
   doctl auth init

   # List your SSH keys
   doctl compute ssh-key list
   ```

## Step 1: Configure Your Environment

1. **Navigate to the environment directory**
   ```bash
   cd terraform/environments/dev
   ```

2. **Create your configuration file**
   ```bash
   cp dev.tfvars.example dev.tfvars
   ```

3. **Edit dev.tfvars with your values**
   ```bash
   vim dev.tfvars  # or use your favorite editor
   ```

   Minimum required changes:
   ```hcl
   do_token    = "dop_v1_your_actual_token_here"
   ssh_key_ids = ["12345678"]  # Your SSH key ID from step 3 above
   ```

## Step 2: Initialize Terraform

```bash
terraform init
```

This downloads the required providers (DigitalOcean) and sets up the workspace.

## Step 3: Review the Plan

```bash
terraform plan -var-file="dev.tfvars"
```

This shows you what Terraform will create:
- 1 VPC (Virtual Private Cloud)
- 1 Firewall with rules for SSH, HTTP, HTTPS
- 1 Droplet (virtual machine)

Review the output carefully. It should say something like:
```
Plan: 4 to add, 0 to change, 0 to destroy.
```

## Step 4: Apply the Configuration

```bash
terraform apply -var-file="dev.tfvars"
```

Type `yes` when prompted to confirm.

Terraform will:
1. Create the VPC
2. Create firewall rules
3. Launch the droplet
4. Run cloud-init to set up Docker and other tools

This takes about 2-3 minutes.

## Step 5: Verify Your Infrastructure

1. **Check the outputs**
   ```bash
   terraform output
   ```

   You should see:
   - `public_ips` - The IP address of your server
   - `connection_string` - SSH command to connect
   - Other resource IDs

2. **Connect to your server**
   ```bash
   # Use the connection string from output
   ssh root@<your-ip-address>

   # Or directly from Terraform output
   $(terraform output -raw connection_string)
   ```

3. **Verify Docker is running**
   ```bash
   docker --version
   docker ps
   ```

## Step 6: Deploy the Composer Application

Once connected to the server:

```bash
# Clone the repository
cd /srv/script-runner
git clone https://github.com/oyren-ai/oyren-ai-composer.git app
cd app

# Create .env file
cp .env.example .env
vim .env  # Add your SCRIPT_RUNNER_TOKEN

# Start the application
docker compose up -d

# Check it's running
docker compose ps
curl http://localhost:3000/healthz
```

## Managing Your Infrastructure

### Make Changes

1. Edit your `dev.tfvars` or the module configurations
2. Plan: `terraform plan -var-file="dev.tfvars"`
3. Apply: `terraform apply -var-file="dev.tfvars"`

### Scale Up (Add More Droplets)

Edit `dev.tfvars`:
```hcl
droplet_count = 2  # was 1
```

Then apply:
```bash
terraform apply -var-file="dev.tfvars"
```

### Add Block Storage

Edit `dev.tfvars`:
```hcl
enable_volume = true
volume_size   = 50  # GB
```

Apply and attach:
```bash
terraform apply -var-file="dev.tfvars"
ssh root@<ip> "mkfs.ext4 /dev/disk/by-id/scsi-0DO_Volume_oyren-composer-dev-data"
ssh root@<ip> "mkdir -p /mnt/data && mount /dev/disk/by-id/scsi-0DO_Volume_oyren-composer-dev-data /mnt/data"
```

### View Current State

```bash
# List all resources
terraform state list

# Show details of a resource
terraform state show module.composer_server.digitalocean_droplet.server[0]

# View outputs
terraform output
terraform output -json  # JSON format
```

### Destroy Everything

⚠️ **WARNING: This deletes all resources!**

```bash
terraform plan -destroy -var-file="dev.tfvars"
terraform destroy -var-file="dev.tfvars"
```

## Common Issues

### "Error: Error creating droplet: POST ... 422"

Your SSH key IDs might be wrong. Check them:
```bash
doctl compute ssh-key list
```

Update `ssh_key_ids` in your `dev.tfvars`.

### "Error: Error locking state"

Another terraform process is running, or crashed. Force unlock:
```bash
terraform force-unlock <lock-id>
```

### Can't SSH to the server

1. Check the firewall rules allow your IP
2. Verify your SSH key is correct
3. Wait 1-2 minutes for cloud-init to complete
4. Try with the oyren user: `ssh oyren@<ip>`

### Changes not applying

Make sure you're passing the tfvars file:
```bash
terraform apply -var-file="dev.tfvars"  # ✓ Correct
terraform apply                          # ✗ Won't work
```

## Next Steps

- **Enable Remote State**: Uncomment the backend configuration in `main.tf` to store state in DigitalOcean Spaces
- **Set Up DNS**: Enable DNS module to automatically create DNS records
- **Add Monitoring**: Set up monitoring dashboards and alerts
- **Configure Backups**: Enable automated backups in production
- **Review Security**: Restrict SSH access to your IP only

## Cost Breakdown

Current dev configuration (~$8/month):
- 1 Droplet (s-1vcpu-1gb): $6/month
- VPC: Free
- Bandwidth (1TB included): $0
- Firewall: Free

To reduce costs further:
- Destroy when not in use: `terraform destroy`
- Use smaller droplet sizes
- Disable monitoring (saves $0, but not recommended)

## Need Help?

- Terraform Docs: https://www.terraform.io/docs
- DigitalOcean Provider: https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs
- Terraform Discord: https://discord.gg/terraform
- Internal docs: See `terraform/README.md`
