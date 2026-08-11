# Terraform Infrastructure for Oyren Composer

This directory contains Terraform configurations for managing Oyren's infrastructure as code.

## Overview

The infrastructure is organized into reusable modules and environment-specific configurations:

```
terraform/
├── modules/           # Reusable infrastructure modules
│   ├── compute/      # VM/droplet resources
│   ├── networking/   # VPC, firewall rules
│   ├── dns/          # Domain and DNS records
│   ├── storage/      # Volumes and object storage
│   ├── monitoring/   # Health checks and alerts
│   └── loadbalancer/ # Load balancer configuration
├── environments/     # Environment-specific configs
│   ├── dev/         # Development environment
│   ├── staging/     # Staging environment
│   └── prod/        # Production environment
└── backend.tf       # Remote state configuration

```

## Prerequisites

1. **Terraform** >= 1.5.0 installed ([download](https://www.terraform.io/downloads))
2. **DigitalOcean API Token** with write access
3. **Spaces Access Keys** for remote state (optional but recommended)

## Quick Start

### 1. Set up environment variables

```bash
export DIGITALOCEAN_TOKEN="your_do_token_here"
export SPACES_ACCESS_KEY_ID="your_spaces_key"
export SPACES_SECRET_ACCESS_KEY="your_spaces_secret"
```

### 2. Initialize Terraform

```bash
cd terraform/environments/dev
terraform init
```

### 3. Review the plan

```bash
terraform plan -var-file="dev.tfvars"
```

### 4. Apply the configuration

```bash
terraform apply -var-file="dev.tfvars"
```

## Environment Configuration

Each environment (`dev`, `staging`, `prod`) has:

- `main.tf` - Main configuration file
- `variables.tf` - Input variable definitions
- `outputs.tf` - Output values
- `<env>.tfvars` - Environment-specific values
- `backend.tf` - Remote state configuration

### Development Environment

Minimal resources for testing:
- 1 droplet (1 vCPU, 1GB RAM)
- Basic firewall rules
- No load balancer

### Staging Environment

Production-like setup with reduced capacity:
- 2 droplets (2 vCPU, 2GB RAM each)
- Full networking and security
- Optional load balancer

### Production Environment

High-availability, scalable setup:
- 3+ droplets (optimized size)
- Load balancer with health checks
- Automatic backups
- Monitoring and alerting
- CDN integration

## Module Usage

### Compute Module

Creates and manages VM instances:

```hcl
module "composer_server" {
  source = "../../modules/compute"
  
  name          = "composer-${var.environment}"
  region        = var.region
  size          = var.droplet_size
  image         = "ubuntu-22-04-x64"
  ssh_keys      = var.ssh_key_ids
  user_data     = file("${path.module}/cloud-init.yaml")
  
  tags = [
    "composer",
    var.environment
  ]
}
```

### Networking Module

Sets up VPC and firewall rules:

```hcl
module "network" {
  source = "../../modules/networking"
  
  name        = "composer-vpc-${var.environment}"
  region      = var.region
  ip_range    = var.vpc_cidr
  
  firewall_rules = {
    http  = { port = 80, protocol = "tcp", sources = ["0.0.0.0/0", "::/0"] }
    https = { port = 443, protocol = "tcp", sources = ["0.0.0.0/0", "::/0"] }
    ssh   = { port = 22, protocol = "tcp", sources = var.ssh_allowed_ips }
  }
}
```

### DNS Module

Manages domain and DNS records:

```hcl
module "dns" {
  source = "../../modules/dns"
  
  domain = "oyren.ai"
  
  records = [
    {
      type  = "A"
      name  = "composer"
      value = module.composer_server.ipv4_address
      ttl   = 300
    }
  ]
}
```

## State Management

Terraform state is stored remotely in DigitalOcean Spaces (S3-compatible):

```hcl
terraform {
  backend "s3" {
    endpoint                    = "nyc3.digitaloceanspaces.com"
    region                      = "us-east-1"  # Required but unused
    bucket                      = "oyren-terraform-state"
    key                         = "composer/dev/terraform.tfstate"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
  }
}
```

### State Locking

For production environments, enable state locking to prevent concurrent modifications:

1. Create a DynamoDB-compatible table or use a locking service
2. Configure the backend with lock table name

## Security Best Practices

### Secrets Management

**Never commit sensitive values to Git!**

Options for managing secrets:

1. **Environment variables** (recommended for local development):
   ```bash
   export TF_VAR_do_token="your_token"
   export TF_VAR_database_password="secure_password"
   ```

2. **`.tfvars` files** (add to `.gitignore`):
   ```hcl
   # secrets.tfvars
   do_token          = "your_token"
   database_password = "secure_password"
   ```

3. **Terraform Cloud/Enterprise** - Built-in secrets management

4. **HashiCorp Vault** - External secrets management

### Variable Validation

All inputs include validation rules:

```hcl
variable "environment" {
  type        = string
  description = "Environment name (dev, staging, prod)"
  
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}
```

## Cost Estimation

### Using Infracost

Install Infracost to estimate costs before applying:

```bash
# Install Infracost
brew install infracost  # macOS
# or
curl -fsSL https://raw.githubusercontent.com/infracost/infracost/master/scripts/install.sh | sh

# Set API key
infracost auth login

# Generate cost estimate
infracost breakdown --path .

# Compare cost changes
infracost diff --path .
```

### Approximate Monthly Costs

**Development:**
- 1 Basic Droplet (1GB): $6/month
- Minimal bandwidth: ~$0-2/month
- **Total: ~$8/month**

**Staging:**
- 2 Droplets (2GB each): $24/month
- Load Balancer: $12/month
- Increased bandwidth: ~$2-5/month
- **Total: ~$40/month**

**Production:**
- 3 Droplets (4GB each): $72/month
- Load Balancer: $12/month
- Spaces (250GB): $5/month
- Monitoring/Backups: $10/month
- Bandwidth: ~$10/month
- **Total: ~$110/month**

## CI/CD Integration

### GitHub Actions Workflow

The repository includes workflows for:

1. **Terraform Validate** - Runs on every PR
   - `terraform fmt -check`
   - `terraform validate`
   - `tflint` for best practices

2. **Terraform Plan** - Runs on PR to main
   - Generates plan for affected environments
   - Posts plan output as PR comment
   - Runs cost estimation

3. **Terraform Apply** - Runs on merge to main
   - Applies changes to staging automatically
   - Requires manual approval for production

### Example Workflow

```yaml
name: Terraform CI

on:
  pull_request:
    paths:
      - 'terraform/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      
      - name: Terraform Format
        run: terraform fmt -check -recursive
      
      - name: Terraform Init
        run: |
          cd terraform/environments/dev
          terraform init -backend=false
      
      - name: Terraform Validate
        run: |
          cd terraform/environments/dev
          terraform validate
```

## Common Operations

### Add a new server

1. Update the environment's `<env>.tfvars`:
   ```hcl
   droplet_count = 3  # increase from 2
   ```

2. Plan and apply:
   ```bash
   terraform plan -var-file="prod.tfvars"
   terraform apply -var-file="prod.tfvars"
   ```

### Update firewall rules

1. Edit `modules/networking/main.tf`
2. Test in dev first:
   ```bash
   cd terraform/environments/dev
   terraform plan
   terraform apply
   ```
3. Promote to staging, then production

### Disaster Recovery

1. **State backup**: State files are versioned in Spaces
   ```bash
   # List versions
   s3cmd --host=nyc3.digitaloceanspaces.com ls \
     s3://oyren-terraform-state/composer/prod/
   ```

2. **Infrastructure rebuild**:
   ```bash
   # From state file
   cd terraform/environments/prod
   terraform init
   terraform plan -var-file="prod.tfvars"
   terraform apply -var-file="prod.tfvars"
   ```

### Destroy resources

**⚠️ WARNING: This will delete all resources in the environment!**

```bash
terraform plan -destroy -var-file="dev.tfvars"
terraform destroy -var-file="dev.tfvars"
```

## Troubleshooting

### "Error acquiring state lock"

Another Terraform process is running or crashed without releasing the lock:

```bash
# Force unlock (use with caution!)
terraform force-unlock <lock-id>
```

### "Provider configuration not present"

Initialize the directory:

```bash
terraform init
```

### State drift detected

Someone made manual changes outside Terraform:

```bash
# See what changed
terraform plan -var-file="<env>.tfvars"

# Import existing resource
terraform import <resource_type>.<name> <resource_id>

# Or refresh state
terraform refresh -var-file="<env>.tfvars"
```

## Support

For issues or questions:
- Check the [Terraform DigitalOcean Provider docs](https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs)
- Open an issue in this repository
- Contact the DevOps team

## License

Same as parent project.
