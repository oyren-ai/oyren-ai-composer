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
  default     = "10.20.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "VPC CIDR must be valid CIDR notation."
  }
}

variable "kubernetes_version" {
  type        = string
  description = "Kubernetes version (e.g., '1.28.2-do.0')"
  default     = "1.28.2-do.0"
}

variable "node_pool_size" {
  type        = string
  description = "Droplet size for Kubernetes nodes"
  default     = "s-2vcpu-4gb"
}

variable "node_pool_count" {
  type        = number
  description = "Number of nodes in default pool"
  default     = 2

  validation {
    condition     = var.node_pool_count >= 1 && var.node_pool_count <= 100
    error_message = "Node count must be between 1 and 100."
  }
}

variable "enable_autoscaling" {
  type        = bool
  description = "Enable autoscaling for the node pool"
  default     = true
}

variable "autoscale_min_nodes" {
  type        = number
  description = "Minimum nodes when autoscaling"
  default     = 2

  validation {
    condition     = var.autoscale_min_nodes >= 1
    error_message = "Minimum nodes must be at least 1."
  }
}

variable "autoscale_max_nodes" {
  type        = number
  description = "Maximum nodes when autoscaling"
  default     = 5

  validation {
    condition     = var.autoscale_max_nodes >= 1
    error_message = "Maximum nodes must be at least 1."
  }
}

variable "auto_upgrade" {
  type        = bool
  description = "Enable automatic Kubernetes version upgrades"
  default     = true
}

variable "surge_upgrade" {
  type        = bool
  description = "Enable surge upgrade (faster but more disruptive)"
  default     = false
}

variable "maintenance_window" {
  type = object({
    day        = string
    start_time = string
  })
  description = "Maintenance window for cluster upgrades"
  default = {
    day        = "sunday"
    start_time = "04:00"
  }
}

variable "additional_node_pools" {
  type = list(object({
    name       = string
    size       = string
    node_count = number
    auto_scale = optional(bool)
    min_nodes  = optional(number)
    max_nodes  = optional(number)
    tags       = optional(list(string))
    labels     = optional(map(string))
    taints = optional(list(object({
      key    = string
      value  = string
      effect = string
    })))
  }))
  description = "Additional node pools for specialized workloads"
  default     = []
}

variable "ssh_allowed_ips" {
  type        = list(string)
  description = "IP addresses allowed to SSH (for any additional VMs)"
  default     = ["0.0.0.0/0", "::/0"]
}

variable "composer_api_token" {
  type        = string
  description = "API token for Oyren composer (stored as K8s secret)"
  default     = ""
  sensitive   = true
}

variable "install_nginx_ingress" {
  type        = bool
  description = "Install NGINX Ingress Controller via Helm"
  default     = true
}

variable "install_cert_manager" {
  type        = bool
  description = "Install cert-manager for automatic TLS certificates"
  default     = true
}

variable "enable_dns" {
  type        = bool
  description = "Create DNS records for the cluster"
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
  description = "Subdomain for the cluster"
  default     = "composer-k8s-dev"
}
