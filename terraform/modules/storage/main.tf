resource "digitalocean_volume" "data" {
  count = var.create_volume ? 1 : 0

  region                  = var.region
  name                    = var.volume_name
  size                    = var.volume_size
  initial_filesystem_type = var.filesystem_type
  description             = var.description

  tags = concat(
    ["managed-by-terraform"],
    var.tags
  )
}

resource "digitalocean_spaces_bucket" "data" {
  count = var.create_spaces_bucket ? 1 : 0

  name   = var.bucket_name
  region = var.spaces_region

  acl = var.bucket_acl

  versioning {
    enabled = var.enable_versioning
  }

  dynamic "lifecycle_rule" {
    for_each = var.lifecycle_rules

    content {
      id      = lifecycle_rule.value.id
      enabled = lifecycle_rule.value.enabled
      prefix  = lookup(lifecycle_rule.value, "prefix", "")

      dynamic "expiration" {
        for_each = lookup(lifecycle_rule.value, "expiration", null) != null ? [lifecycle_rule.value.expiration] : []

        content {
          days = expiration.value.days
          date = lookup(expiration.value, "date", null)
        }
      }

      dynamic "noncurrent_version_expiration" {
        for_each = lookup(lifecycle_rule.value, "noncurrent_version_expiration", null) != null ? [lifecycle_rule.value.noncurrent_version_expiration] : []

        content {
          days = noncurrent_version_expiration.value.days
        }
      }
    }
  }
}

# CORS configuration for Spaces bucket
resource "digitalocean_spaces_bucket_cors_configuration" "data" {
  count = var.create_spaces_bucket && length(var.cors_rules) > 0 ? 1 : 0

  bucket = digitalocean_spaces_bucket.data[0].id
  region = var.spaces_region

  dynamic "cors_rule" {
    for_each = var.cors_rules

    content {
      allowed_headers = lookup(cors_rule.value, "allowed_headers", [])
      allowed_methods = cors_rule.value.allowed_methods
      allowed_origins = cors_rule.value.allowed_origins
      expose_headers  = lookup(cors_rule.value, "expose_headers", [])
      max_age_seconds = lookup(cors_rule.value, "max_age_seconds", 3000)
    }
  }
}
