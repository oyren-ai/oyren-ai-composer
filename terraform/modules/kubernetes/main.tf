# DigitalOcean Kubernetes Cluster Module
# Deploys a managed K8s cluster for self-hosted Oyren pods

resource "digitalocean_kubernetes_cluster" "main" {
  name    = var.cluster_name
  region  = var.region
  version = var.kubernetes_version

  vpc_uuid = var.vpc_id

  # Enable auto-upgrade for patch versions
  auto_upgrade = var.auto_upgrade
  surge_upgrade = var.surge_upgrade

  # Maintenance window
  maintenance_policy {
    start_time = var.maintenance_window.start_time
    day        = var.maintenance_window.day
  }

  # Default node pool
  node_pool {
    name       = "${var.cluster_name}-default-pool"
    size       = var.node_pool_size
    node_count = var.node_pool_count
    auto_scale = var.enable_autoscaling
    min_nodes  = var.enable_autoscaling ? var.autoscale_min_nodes : null
    max_nodes  = var.enable_autoscaling ? var.autoscale_max_nodes : null

    tags = concat(
      [
        "managed-by-terraform",
        "environment-${var.environment}",
        "cluster-${var.cluster_name}"
      ],
      var.tags
    )

    labels = merge(
      {
        "oyren.ai/managed"    = "true"
        "oyren.ai/environment" = var.environment
      },
      var.node_labels
    )

    # Taints for specialized workloads (optional)
    dynamic "taint" {
      for_each = var.node_taints
      content {
        key    = taint.value.key
        value  = taint.value.value
        effect = taint.value.effect
      }
    }
  }

  # Additional node pools (for different workload types)
  dynamic "node_pool" {
    for_each = var.additional_node_pools

    content {
      name       = "${var.cluster_name}-${node_pool.value.name}"
      size       = node_pool.value.size
      node_count = node_pool.value.node_count
      auto_scale = lookup(node_pool.value, "auto_scale", false)
      min_nodes  = lookup(node_pool.value, "min_nodes", null)
      max_nodes  = lookup(node_pool.value, "max_nodes", null)

      tags = concat(
        [
          "managed-by-terraform",
          "pool-${node_pool.value.name}"
        ],
        lookup(node_pool.value, "tags", [])
      )

      labels = lookup(node_pool.value, "labels", {})

      dynamic "taint" {
        for_each = lookup(node_pool.value, "taints", [])
        content {
          key    = taint.value.key
          value  = taint.value.value
          effect = taint.value.effect
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      # Ignore changes to node_count if autoscaling is enabled
      node_pool[0].node_count
    ]
  }
}

# Save kubeconfig to local file (optional)
resource "local_file" "kubeconfig" {
  count = var.save_kubeconfig ? 1 : 0

  content  = digitalocean_kubernetes_cluster.main.kube_config[0].raw_config
  filename = "${path.root}/kubeconfig-${var.cluster_name}.yaml"

  file_permission = "0600"
}
