variable "region" {
  type        = string
  description = "DigitalOcean region for block storage"
  default     = "nyc3"
}

variable "create_volume" {
  type        = bool
  description = "Whether to create a block storage volume"
  default     = false
}

variable "volume_name" {
  type        = string
  description = "Name of the volume"
  default     = ""
}

variable "volume_size" {
  type        = number
  description = "Size of the volume in GB"
  default     = 10

  validation {
    condition     = var.volume_size >= 1 && var.volume_size <= 16384
    error_message = "Volume size must be between 1 and 16384 GB."
  }
}

variable "filesystem_type" {
  type        = string
  description = "Initial filesystem type (ext4 or xfs)"
  default     = "ext4"

  validation {
    condition     = contains(["ext4", "xfs"], var.filesystem_type)
    error_message = "Filesystem type must be ext4 or xfs."
  }
}

variable "description" {
  type        = string
  description = "Description of the volume"
  default     = ""
}

variable "tags" {
  type        = list(string)
  description = "Tags for the volume"
  default     = []
}

variable "create_spaces_bucket" {
  type        = bool
  description = "Whether to create a Spaces (S3-compatible) bucket"
  default     = false
}

variable "bucket_name" {
  type        = string
  description = "Name of the Spaces bucket"
  default     = ""

  validation {
    condition     = var.bucket_name == "" || can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "Bucket name must be 3-63 characters, lowercase, start/end with alphanumeric."
  }
}

variable "spaces_region" {
  type        = string
  description = "Spaces region"
  default     = "nyc3"

  validation {
    condition = contains([
      "nyc3", "ams3", "sfo3", "sgp1", "fra1"
    ], var.spaces_region)
    error_message = "Spaces region must be one of: nyc3, ams3, sfo3, sgp1, fra1."
  }
}

variable "bucket_acl" {
  type        = string
  description = "ACL for the bucket"
  default     = "private"

  validation {
    condition     = contains(["private", "public-read"], var.bucket_acl)
    error_message = "ACL must be private or public-read."
  }
}

variable "enable_versioning" {
  type        = bool
  description = "Enable versioning for the bucket"
  default     = false
}

variable "lifecycle_rules" {
  type = list(object({
    id      = string
    enabled = bool
    prefix  = optional(string)
    expiration = optional(object({
      days = number
      date = optional(string)
    }))
    noncurrent_version_expiration = optional(object({
      days = number
    }))
  }))
  description = "Lifecycle rules for the bucket"
  default     = []
}

variable "cors_rules" {
  type = list(object({
    allowed_headers = optional(list(string))
    allowed_methods = list(string)
    allowed_origins = list(string)
    expose_headers  = optional(list(string))
    max_age_seconds = optional(number)
  }))
  description = "CORS rules for the bucket"
  default     = []
}
