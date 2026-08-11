resource "digitalocean_vpc" "main" {
  name     = var.name
  region   = var.region
  ip_range = var.ip_range
}

resource "digitalocean_firewall" "main" {
  name = "${var.name}-firewall"

  tags = var.firewall_tags

  # Inbound rules
  dynamic "inbound_rule" {
    for_each = var.inbound_rules

    content {
      protocol         = inbound_rule.value.protocol
      port_range       = inbound_rule.value.port_range
      source_addresses = lookup(inbound_rule.value, "source_addresses", [])
      source_droplet_ids = lookup(inbound_rule.value, "source_droplet_ids", [])
      source_load_balancer_uids = lookup(inbound_rule.value, "source_load_balancer_uids", [])
      source_tags = lookup(inbound_rule.value, "source_tags", [])
    }
  }

  # Outbound rules
  dynamic "outbound_rule" {
    for_each = var.outbound_rules

    content {
      protocol              = outbound_rule.value.protocol
      port_range            = outbound_rule.value.port_range
      destination_addresses = lookup(outbound_rule.value, "destination_addresses", [])
      destination_droplet_ids = lookup(outbound_rule.value, "destination_droplet_ids", [])
      destination_load_balancer_uids = lookup(outbound_rule.value, "destination_load_balancer_uids", [])
      destination_tags = lookup(outbound_rule.value, "destination_tags", [])
    }
  }
}
