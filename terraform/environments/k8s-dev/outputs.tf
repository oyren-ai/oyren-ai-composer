output "cluster_id" {
  description = "ID of the Kubernetes cluster"
  value       = module.k8s_cluster.cluster_id
}

output "cluster_name" {
  description = "Name of the Kubernetes cluster"
  value       = module.k8s_cluster.cluster_name
}

output "cluster_endpoint" {
  description = "Kubernetes API endpoint"
  value       = module.k8s_cluster.cluster_endpoint
}

output "cluster_version" {
  description = "Kubernetes version"
  value       = module.k8s_cluster.cluster_version
}

output "cluster_ipv4" {
  description = "Public IPv4 address of the cluster"
  value       = module.k8s_cluster.cluster_ipv4
}

output "vpc_id" {
  description = "ID of the VPC"
  value       = module.network.vpc_id
}

output "kubeconfig_path" {
  description = "Path to kubeconfig file"
  value       = module.k8s_cluster.kubeconfig_path
}

output "kubectl_config_command" {
  description = "Command to configure kubectl"
  value       = module.k8s_cluster.kubectl_config_command
}

output "namespaces" {
  description = "Created Kubernetes namespaces"
  value = {
    agents = kubernetes_namespace.oyren.metadata[0].name
    system = kubernetes_namespace.system.metadata[0].name
  }
}

output "composer_service_account" {
  description = "ServiceAccount for Oyren composer"
  value       = kubernetes_service_account.composer.metadata[0].name
}

output "dns_records" {
  description = "Created DNS records"
  value       = var.enable_dns ? module.dns[0].record_fqdns : {}
}

output "next_steps" {
  description = "Next steps to set up your cluster"
  value = <<-EOT

  ╔════════════════════════════════════════════════════════════════╗
  ║  Kubernetes Cluster Ready!                                      ║
  ╚════════════════════════════════════════════════════════════════╝

  1. Configure kubectl:
     ${module.k8s_cluster.kubectl_config_command}

     # Or use the generated kubeconfig:
     export KUBECONFIG=${module.k8s_cluster.kubeconfig_path}

  2. Verify cluster:
     kubectl get nodes
     kubectl get namespaces

  3. Check Oyren namespaces:
     kubectl get all -n ${kubernetes_namespace.oyren.metadata[0].name}
     kubectl get all -n ${kubernetes_namespace.system.metadata[0].name}

  4. Deploy Oyren Composer:
     # See terraform/k8s/composer-deployment.yaml for example

  5. Access cluster:
     Cluster Endpoint: ${module.k8s_cluster.cluster_endpoint}
     ${var.enable_dns ? "DNS: https://${var.dns_subdomain}.${var.domain_name}" : ""}

  Your Kubernetes cluster is ready to run Oyren agent pods!
  EOT
}
