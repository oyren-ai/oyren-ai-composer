variable "cluster_name" {
  type        = string
  description = "Name of the Kubernetes cluster"

  validation {
    condition     = length(var.cluster_name) > 0 && length(var.cluster_name) <= 63
    error_message = "Cluster name must be between 1 and 63 characters."
  }
}

variable "region" {
  type        = string
  description = "DigitalOcean region for the cluster"

  validation {
    condition = contains([
      "nyc1", "nyc3", "sfo3", "ams3", "sgp1", "lon1", "fra1", "tor1", "blr1"
    ], var.region)
    error_message = "Region must be a valid DigitalOcean region."
  }
}

variable "kubernetes_version" {
  type        = string
  description = "Kubernetes version (e.g., '1.28.2-do.0')"
  default     = "1.28.2-do.0"
}

variable "vpc_id" {
  type        = string
  description = "VPC UUID to attach the cluster to"
  default     = null
}

variable "environment" {
  type        = string
  description = "Environment name (dev, staging, prod)"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "node_pool_size" {
  type        = string
  description = "Droplet size for default node pool"
  default     = "s-2vcpu-4gb"

  validation {
    condition = can(regex("^(s|c|g|so|m|gd)-[0-9]+vcpu-[0-9]+gb", var.node_pool_size))
    error_message = "Size must be a valid DigitalOcean size slug."
  }
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
  description = "Enable autoscaling for the default node pool"
  default     = false
}

variable "autoscale_min_nodes" {
  type        = number
  description = "Minimum number of nodes when autoscaling"
  default     = 1

  validation {
    condition     = var.autoscale_min_nodes >= 1 && var.autoscale_min_nodes <= 100
    error_message = "Minimum nodes must be between 1 and 100."
  }
}

variable "autoscale_max_nodes" {
  type        = number
  description = "Maximum number of nodes when autoscaling"
  default     = 5

  validation {
    condition     = var.autoscale_max_nodes >= 1 && var.autoscale_max_nodes <= 100
    error_message = "Maximum nodes must be between 1 and 100."
  }
}

variable "auto_upgrade" {
  type        = bool
  description = "Enable automatic minor version upgrades"
  default     = true
}

variable "surge_upgrade" {
  type        = bool
  description = "Enable surge upgrade (parallel node replacement)"
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

  validation {
    condition = contains([
      "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "any"
    ], lower(var.maintenance_window.day))
    error_message = "Day must be a valid day of the week or 'any'."
  }

  validation {
    condition     = can(regex("^([0-1][0-9]|2[0-3]):[0-5][0-9]$", var.maintenance_window.start_time))
    error_message = "Start time must be in HH:MM format (24-hour)."
  }
}

variable "tags" {
  type        = list(string)
  description = "Tags to apply to cluster nodes"
  default     = []
}

variable "node_labels" {
  type        = map(string)
  description = "Labels to apply to all nodes in default pool"
  default     = {}
}

variable "node_taints" {
  type = list(object({
    key    = string
    value  = string
    effect = string
  }))
  description = "Taints to apply to nodes in default pool"
  default     = []

  validation {
    condition = alltrue([
      for taint in var.node_taints : contains(
        ["NoSchedule", "PreferNoSchedule", "NoExecute"],
        taint.effect
      )
    ])
    error_message = "Taint effect must be NoSchedule, PreferNoSchedule, or NoExecute."
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

variable "save_kubeconfig" {
  type        = bool
  description = "Save kubeconfig to local file"
  default     = true
}
