output "droplet_ids" {
  description = "IDs of created droplets"
  value       = digitalocean_droplet.server[*].id
}

output "droplet_names" {
  description = "Names of created droplets"
  value       = digitalocean_droplet.server[*].name
}

output "ipv4_addresses" {
  description = "Public IPv4 addresses"
  value       = digitalocean_droplet.server[*].ipv4_address
}

output "ipv4_addresses_private" {
  description = "Private IPv4 addresses"
  value       = digitalocean_droplet.server[*].ipv4_address_private
}

output "ipv6_addresses" {
  description = "IPv6 addresses"
  value       = digitalocean_droplet.server[*].ipv6_address
}

output "floating_ip" {
  description = "Floating IP address (if assigned)"
  value       = var.assign_floating_ip ? digitalocean_floating_ip.server[0].ip_address : null
}

output "urn" {
  description = "Uniform Resource Names of the droplets"
  value       = digitalocean_droplet.server[*].urn
}
