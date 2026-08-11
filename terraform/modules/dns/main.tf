resource "digitalocean_domain" "main" {
  count = var.create_domain ? 1 : 0
  name  = var.domain
}

resource "digitalocean_record" "records" {
  for_each = { for idx, record in var.records : "${record.type}-${record.name}" => record }

  domain = var.domain
  type   = each.value.type
  name   = each.value.name
  value  = each.value.value
  ttl    = lookup(each.value, "ttl", 3600)

  priority = lookup(each.value, "priority", null)
  port     = lookup(each.value, "port", null)
  weight   = lookup(each.value, "weight", null)
  flags    = lookup(each.value, "flags", null)
  tag      = lookup(each.value, "tag", null)

  depends_on = [digitalocean_domain.main]
}
