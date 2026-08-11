variable "name" {
  type        = string
  description = "Name for the VPC and firewall"
}

variable "region" {
  type        = string
  description = "DigitalOcean region"

  validation {
    condition = contains([
      "nyc1", "nyc3", "sfo3", "ams3", "sgp1", "lon1", "fra1", "tor1", "blr1"
    ], var.region)
    error_message = "Region must be a valid DigitalOcean region."
  }
}

variable "ip_range" {
  type        = string
  description = "IP range for the VPC in CIDR notation"
  default     = "10.10.0.0/16"

  validation {
    condition     = can(cidrhost(var.ip_range, 0))
    error_message = "IP range must be a valid CIDR notation."
  }
}

variable "firewall_tags" {
  type        = list(string)
  description = "Tags for droplets to apply firewall rules to"
  default     = []
}

variable "inbound_rules" {
  type = list(object({
    protocol         = string
    port_range       = string
    source_addresses = optional(list(string))
    source_droplet_ids = optional(list(string))
    source_load_balancer_uids = optional(list(string))
    source_tags = optional(list(string))
  }))
  description = "List of inbound firewall rules"
  default = [
    {
      protocol         = "tcp"
      port_range       = "22"
      source_addresses = ["0.0.0.0/0", "::/0"]
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

variable "outbound_rules" {
  type = list(object({
    protocol              = string
    port_range            = string
    destination_addresses = optional(list(string))
    destination_droplet_ids = optional(list(string))
    destination_load_balancer_uids = optional(list(string))
    destination_tags = optional(list(string))
  }))
  description = "List of outbound firewall rules"
  default = [
    {
      protocol              = "tcp"
      port_range            = "1-65535"
      destination_addresses = ["0.0.0.0/0", "::/0"]
    },
    {
      protocol              = "udp"
      port_range            = "1-65535"
      destination_addresses = ["0.0.0.0/0", "::/0"]
    },
    {
      protocol              = "icmp"
      port_range            = ""
      destination_addresses = ["0.0.0.0/0", "::/0"]
    }
  ]
}
