output "cluster_id" {
  description = "ID of the Kubernetes cluster"
  value       = digitalocean_kubernetes_cluster.main.id
}

output "cluster_name" {
  description = "Name of the Kubernetes cluster"
  value       = digitalocean_kubernetes_cluster.main.name
}

output "cluster_urn" {
  description = "URN of the Kubernetes cluster"
  value       = digitalocean_kubernetes_cluster.main.urn
}

output "cluster_endpoint" {
  description = "Kubernetes API endpoint"
  value       = digitalocean_kubernetes_cluster.main.endpoint
}

output "cluster_ipv4" {
  description = "Public IPv4 address of the cluster"
  value       = digitalocean_kubernetes_cluster.main.ipv4_address
}

output "cluster_status" {
  description = "Status of the cluster"
  value       = digitalocean_kubernetes_cluster.main.status
}

output "cluster_version" {
  description = "Kubernetes version of the cluster"
  value       = digitalocean_kubernetes_cluster.main.version
}

output "kubeconfig" {
  description = "Kubeconfig for accessing the cluster"
  value       = digitalocean_kubernetes_cluster.main.kube_config[0].raw_config
  sensitive   = true
}

output "cluster_ca_certificate" {
  description = "CA certificate for the cluster"
  value       = base64decode(digitalocean_kubernetes_cluster.main.kube_config[0].cluster_ca_certificate)
  sensitive   = true
}

output "client_certificate" {
  description = "Client certificate for authentication"
  value       = base64decode(digitalocean_kubernetes_cluster.main.kube_config[0].client_certificate)
  sensitive   = true
}

output "client_key" {
  description = "Client key for authentication"
  value       = base64decode(digitalocean_kubernetes_cluster.main.kube_config[0].client_key)
  sensitive   = true
}

output "node_pool_id" {
  description = "ID of the default node pool"
  value       = digitalocean_kubernetes_cluster.main.node_pool[0].id
}

output "node_pool_nodes" {
  description = "Nodes in the default pool"
  value       = digitalocean_kubernetes_cluster.main.node_pool[0].nodes
}

output "kubectl_config_command" {
  description = "Command to configure kubectl"
  value       = "doctl kubernetes cluster kubeconfig save ${digitalocean_kubernetes_cluster.main.id}"
}

output "kubeconfig_path" {
  description = "Path to saved kubeconfig file (if save_kubeconfig = true)"
  value       = var.save_kubeconfig ? "${path.root}/kubeconfig-${var.cluster_name}.yaml" : null
}
