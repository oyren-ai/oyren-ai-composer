terraform {
  required_version = ">= 1.5.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.40"
    }
  }

  # Uncomment to enable remote state
  # backend "s3" {
  #   endpoint                    = "nyc3.digitaloceanspaces.com"
  #   region                      = "us-east-1"
  #   bucket                      = "oyren-terraform-state"
  #   key                         = "composer/dev/terraform.tfstate"
  #   skip_credentials_validation = true
  #   skip_metadata_api_check     = true
  # }
}

provider "digitalocean" {
  token = var.do_token
}

locals {
  common_tags = [
    "composer",
    "environment-${var.environment}",
    "managed-by-terraform"
  ]
}

# Networking
module "network" {
  source = "../../modules/networking"

  name     = "${var.project_name}-${var.environment}"
  region   = var.region
  ip_range = var.vpc_cidr

  firewall_tags = local.common_tags

  inbound_rules = [
    {
      protocol         = "tcp"
      port_range       = "22"
      source_addresses = var.ssh_allowed_ips
    },
    {
      protocol         = "tcp"
      port_range       = "80"
      source_addresses = ["0.0.0.0/0", "::/0"]
    },
    {
      protocol         = "tcp"
      port_range       = "443"
      source_addresses = ["0.0.0.0/0", "::/0"]
    }
  ]
}

# Compute
module "composer_server" {
  source = "../../modules/compute"

  name           = "${var.project_name}-${var.environment}"
  instance_count = var.droplet_count
  region         = var.region
  size           = var.droplet_size
  image          = var.droplet_image
  ssh_keys       = var.ssh_key_ids
  user_data      = templatefile("${path.module}/user-data.yaml", {
    hostname = "${var.project_name}-${var.environment}"
  })

  vpc_id = module.network.vpc_id

  enable_monitoring = true
  enable_backups    = var.enable_backups

  environment = var.environment
  tags        = local.common_tags
}

# Storage (optional)
module "storage" {
  source = "../../modules/storage"

  region = var.region

  create_volume   = var.enable_volume
  volume_name     = "${var.project_name}-${var.environment}-data"
  volume_size     = var.volume_size
  filesystem_type = "ext4"
  description     = "Data volume for ${var.project_name} ${var.environment}"
  tags            = local.common_tags

  create_spaces_bucket = var.enable_spaces
  bucket_name          = var.spaces_bucket_name
  spaces_region        = var.region
  bucket_acl           = "private"
  enable_versioning    = false
}

# DNS (optional)
module "dns" {
  source = "../../modules/dns"
  count  = var.enable_dns ? 1 : 0

  domain        = var.domain_name
  create_domain = var.create_domain

  records = [
    {
      type  = "A"
      name  = var.dns_subdomain
      value = module.composer_server.ipv4_addresses[0]
      ttl   = 300
    }
  ]
}
