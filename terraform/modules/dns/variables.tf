variable "domain" {
  type        = string
  description = "Domain name to manage"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]\\.[a-z]{2,}$", var.domain))
    error_message = "Domain must be a valid domain name."
  }
}

variable "create_domain" {
  type        = bool
  description = "Whether to create the domain resource (set to false if domain already exists)"
  default     = false
}

variable "records" {
  type = list(object({
    type     = string
    name     = string
    value    = string
    ttl      = optional(number)
    priority = optional(number)
    port     = optional(number)
    weight   = optional(number)
    flags    = optional(number)
    tag      = optional(string)
  }))
  description = "List of DNS records to create"
  default     = []

  validation {
    condition = alltrue([
      for record in var.records : contains(
        ["A", "AAAA", "CAA", "CNAME", "MX", "NS", "TXT", "SRV", "SOA"],
        record.type
      )
    ])
    error_message = "Record type must be one of: A, AAAA, CAA, CNAME, MX, NS, TXT, SRV, SOA."
  }
}
