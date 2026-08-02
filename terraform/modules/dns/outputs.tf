output "domain_name" {
  description = "Domain name"
  value       = var.domain
}

output "domain_urn" {
  description = "URN of the domain"
  value       = var.create_domain ? digitalocean_domain.main[0].urn : null
}

output "record_ids" {
  description = "IDs of created DNS records"
  value       = { for k, v in digitalocean_record.records : k => v.id }
}

output "record_fqdns" {
  description = "Fully qualified domain names of created records"
  value       = { for k, v in digitalocean_record.records : k => v.fqdn }
}
