resource "digitalocean_droplet" "server" {
  count = var.instance_count

  name   = "${var.name}-${count.index + 1}"
  region = var.region
  size   = var.size
  image  = var.image

  ssh_keys  = var.ssh_keys
  user_data = var.user_data

  vpc_uuid = var.vpc_id

  monitoring = var.enable_monitoring
  backups    = var.enable_backups

  tags = concat(
    [
      "managed-by-terraform",
      "environment-${var.environment}"
    ],
    var.tags
  )

  lifecycle {
    create_before_destroy = true
  }
}

# Attach volume if specified
resource "digitalocean_volume_attachment" "data" {
  count = var.volume_id != null ? var.instance_count : 0

  droplet_id = digitalocean_droplet.server[count.index].id
  volume_id  = var.volume_id
}

# Floating IP (optional, typically for load-balanced setups)
resource "digitalocean_floating_ip" "server" {
  count = var.assign_floating_ip ? 1 : 0

  region = var.region
}

resource "digitalocean_floating_ip_assignment" "server" {
  count = var.assign_floating_ip ? 1 : 0

  ip_address = digitalocean_floating_ip.server[0].ip_address
  droplet_id = digitalocean_droplet.server[0].id
}
