output "volume_id" {
  description = "ID of the created volume"
  value       = var.create_volume ? digitalocean_volume.data[0].id : null
}

output "volume_urn" {
  description = "URN of the created volume"
  value       = var.create_volume ? digitalocean_volume.data[0].urn : null
}

output "volume_device_path" {
  description = "Device path of the volume when attached"
  value       = var.create_volume ? "/dev/disk/by-id/scsi-0DO_Volume_${digitalocean_volume.data[0].name}" : null
}

output "bucket_name" {
  description = "Name of the Spaces bucket"
  value       = var.create_spaces_bucket ? digitalocean_spaces_bucket.data[0].name : null
}

output "bucket_urn" {
  description = "URN of the Spaces bucket"
  value       = var.create_spaces_bucket ? digitalocean_spaces_bucket.data[0].urn : null
}

output "bucket_endpoint" {
  description = "Endpoint URL for the Spaces bucket"
  value       = var.create_spaces_bucket ? digitalocean_spaces_bucket.data[0].bucket_domain_name : null
}

output "bucket_region" {
  description = "Region of the Spaces bucket"
  value       = var.create_spaces_bucket ? digitalocean_spaces_bucket.data[0].region : null
}
