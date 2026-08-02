variable "do_token" {
  type        = string
  description = "DigitalOcean API token"
  sensitive   = true

  validation {
    condition     = length(var.do_token) > 0
    error_message = "DigitalOcean token must not be empty."
  }
}

variable "project_name" {
  type        = string
  description = "Project name prefix for resources"
  default     = "oyren-composer"
}

variable "environment" {
  type        = string
  description = "Environment name"
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "region" {
  type        = string
  description = "DigitalOcean region"
  default     = "nyc3"

  validation {
    condition = contains([
      "nyc1", "nyc3", "sfo3", "ams3", "sgp1", "lon1", "fra1", "tor1", "blr1"
    ], var.region)
    error_message = "Region must be a valid DigitalOcean region."
  }
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for VPC"
  default     = "10.10.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "VPC CIDR must be valid CIDR notation."
  }
}

variable "droplet_count" {
  type        = number
  description = "Number of droplets to create"
  default     = 1

  validation {
    condition     = var.droplet_count > 0 && var.droplet_count <= 10
    error_message = "Droplet count must be between 1 and 10."
  }
}

variable "droplet_size" {
  type        = string
  description = "Droplet size slug"
  default     = "s-1vcpu-1gb"
}

variable "droplet_image" {
  type        = string
  description = "Droplet image (OS)"
  default     = "ubuntu-22-04-x64"
}

variable "ssh_key_ids" {
  type        = list(string)
  description = "List of SSH key IDs to add to droplets"
  default     = []
}

variable "ssh_allowed_ips" {
  type        = list(string)
  description = "List of IP addresses allowed to SSH"
  default     = ["0.0.0.0/0", "::/0"]
}

variable "enable_backups" {
  type        = bool
  description = "Enable automated backups for droplets"
  default     = false
}

variable "enable_volume" {
  type        = bool
  description = "Create and attach a block storage volume"
  default     = false
}

variable "volume_size" {
  type        = number
  description = "Size of block storage volume in GB"
  default     = 10

  validation {
    condition     = var.volume_size >= 1 && var.volume_size <= 16384
    error_message = "Volume size must be between 1 and 16384 GB."
  }
}

variable "enable_spaces" {
  type        = bool
  description = "Create a Spaces (S3-compatible) bucket"
  default     = false
}

variable "spaces_bucket_name" {
  type        = string
  description = "Name of the Spaces bucket"
  default     = ""
}

variable "enable_dns" {
  type        = bool
  description = "Manage DNS records"
  default     = false
}

variable "domain_name" {
  type        = string
  description = "Domain name for DNS"
  default     = ""
}

variable "create_domain" {
  type        = bool
  description = "Create the domain resource (false if domain already exists)"
  default     = false
}

variable "dns_subdomain" {
  type        = string
  description = "Subdomain for the service"
  default     = "composer-dev"
}
