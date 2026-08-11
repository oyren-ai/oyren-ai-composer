output "vpc_id" {
  description = "ID of the VPC"
  value       = digitalocean_vpc.main.id
}

output "vpc_urn" {
  description = "URN of the VPC"
  value       = digitalocean_vpc.main.urn
}

output "vpc_ip_range" {
  description = "IP range of the VPC"
  value       = digitalocean_vpc.main.ip_range
}

output "firewall_id" {
  description = "ID of the firewall"
  value       = digitalocean_firewall.main.id
}

output "firewall_name" {
  description = "Name of the firewall"
  value       = digitalocean_firewall.main.name
}
