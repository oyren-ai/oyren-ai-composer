variable "name" {
  type        = string
  description = "Base name for the droplet(s)"

  validation {
    condition     = length(var.name) > 0 && length(var.name) <= 50
    error_message = "Name must be between 1 and 50 characters."
  }
}

variable "instance_count" {
  type        = number
  description = "Number of droplets to create"
  default     = 1

  validation {
    condition     = var.instance_count > 0 && var.instance_count <= 20
    error_message = "Instance count must be between 1 and 20."
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

variable "size" {
  type        = string
  description = "Droplet size slug"
  default     = "s-1vcpu-1gb"

  validation {
    condition = can(regex("^(s|c|g|so|m|gd)-[0-9]+vcpu-[0-9]+gb", var.size))
    error_message = "Size must be a valid DigitalOcean size slug."
  }
}

variable "image" {
  type        = string
  description = "Droplet image (OS)"
  default     = "ubuntu-22-04-x64"
}

variable "ssh_keys" {
  type        = list(string)
  description = "List of SSH key IDs to add to the droplet"
  default     = []
}

variable "user_data" {
  type        = string
  description = "Cloud-init user data script"
  default     = ""
}

variable "vpc_id" {
  type        = string
  description = "VPC UUID to attach the droplet to"
  default     = null
}

variable "enable_monitoring" {
  type        = bool
  description = "Enable DigitalOcean monitoring"
  default     = true
}

variable "enable_backups" {
  type        = bool
  description = "Enable automated backups"
  default     = false
}

variable "tags" {
  type        = list(string)
  description = "Additional tags for the droplet"
  default     = []
}

variable "environment" {
  type        = string
  description = "Environment name (dev, staging, prod)"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "volume_id" {
  type        = string
  description = "Volume ID to attach to the droplet(s)"
  default     = null
}

variable "assign_floating_ip" {
  type        = bool
  description = "Assign a floating IP to the first droplet"
  default     = false
}
