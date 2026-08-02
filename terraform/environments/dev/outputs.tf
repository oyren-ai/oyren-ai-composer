output "droplet_ids" {
  description = "IDs of the created droplets"
  value       = module.composer_server.droplet_ids
}

output "droplet_names" {
  description = "Names of the created droplets"
  value       = module.composer_server.droplet_names
}

output "public_ips" {
  description = "Public IP addresses of the droplets"
  value       = module.composer_server.ipv4_addresses
}

output "private_ips" {
  description = "Private IP addresses of the droplets"
  value       = module.composer_server.ipv4_addresses_private
}

output "vpc_id" {
  description = "ID of the VPC"
  value       = module.network.vpc_id
}

output "firewall_id" {
  description = "ID of the firewall"
  value       = module.network.firewall_id
}

output "volume_id" {
  description = "ID of the block storage volume (if created)"
  value       = module.storage.volume_id
}

output "bucket_endpoint" {
  description = "Endpoint URL for the Spaces bucket (if created)"
  value       = module.storage.bucket_endpoint
}

output "dns_records" {
  description = "Created DNS records"
  value       = var.enable_dns ? module.dns[0].record_fqdns : {}
}

output "connection_string" {
  description = "Connection command for SSH"
  value       = "ssh root@${module.composer_server.ipv4_addresses[0]}"
}
