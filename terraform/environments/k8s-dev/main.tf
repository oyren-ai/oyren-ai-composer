terraform {
  required_version = ">= 1.5.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.40"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.11"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.4"
    }
  }

  # Uncomment to enable remote state
  # backend "s3" {
  #   endpoint                    = "nyc3.digitaloceanspaces.com"
  #   region                      = "us-east-1"
  #   bucket                      = "oyren-terraform-state"
  #   key                         = "composer/k8s-dev/terraform.tfstate"
  #   skip_credentials_validation = true
  #   skip_metadata_api_check     = true
  # }
}

provider "digitalocean" {
  token = var.do_token
}

# Configure Kubernetes provider with cluster credentials
provider "kubernetes" {
  host  = module.k8s_cluster.cluster_endpoint
  token = module.k8s_cluster.kubeconfig

  cluster_ca_certificate = base64encode(module.k8s_cluster.cluster_ca_certificate)
}

provider "helm" {
  kubernetes {
    host  = module.k8s_cluster.cluster_endpoint
    token = module.k8s_cluster.kubeconfig

    cluster_ca_certificate = base64encode(module.k8s_cluster.cluster_ca_certificate)
  }
}

locals {
  common_tags = [
    "oyren-composer",
    "environment-${var.environment}",
    "managed-by-terraform"
  ]
}

# Networking
module "network" {
  source = "../../modules/networking"

  name     = "${var.project_name}-${var.environment}"
  region   = var.region
  ip_range = var.vpc_cidr

  firewall_tags = local.common_tags

  # K8s clusters manage their own security groups
  # This firewall is for any additional VMs in the VPC
  inbound_rules = [
    {
      protocol         = "tcp"
      port_range       = "22"
      source_addresses = var.ssh_allowed_ips
    },
    {
      protocol         = "tcp"
      port_range       = "80"
      source_addresses = ["0.0.0.0/0", "::/0"]
    },
    {
      protocol         = "tcp"
      port_range       = "443"
      source_addresses = ["0.0.0.0/0", "::/0"]
    }
  ]
}

# Kubernetes Cluster
module "k8s_cluster" {
  source = "../../modules/kubernetes"

  cluster_name       = "${var.project_name}-${var.environment}"
  region             = var.region
  kubernetes_version = var.kubernetes_version
  environment        = var.environment

  vpc_id = module.network.vpc_id

  # Default node pool for system services + light workloads
  node_pool_size  = var.node_pool_size
  node_pool_count = var.node_pool_count

  enable_autoscaling   = var.enable_autoscaling
  autoscale_min_nodes  = var.autoscale_min_nodes
  autoscale_max_nodes  = var.autoscale_max_nodes

  auto_upgrade  = var.auto_upgrade
  surge_upgrade = var.surge_upgrade

  maintenance_window = var.maintenance_window

  tags = local.common_tags

  node_labels = {
    "oyren.ai/pool-type" = "default"
    "oyren.ai/workload"  = "system"
  }

  # Optional: additional node pools for different workload types
  additional_node_pools = var.additional_node_pools

  save_kubeconfig = true
}

# DNS (optional)
module "dns" {
  source = "../../modules/dns"
  count  = var.enable_dns ? 1 : 0

  domain        = var.domain_name
  create_domain = var.create_domain

  records = [
    {
      type  = "A"
      name  = var.dns_subdomain
      value = module.k8s_cluster.cluster_ipv4
      ttl   = 300
    },
    {
      type  = "A"
      name  = "*.${var.dns_subdomain}"  # Wildcard for apps
      value = module.k8s_cluster.cluster_ipv4
      ttl   = 300
    }
  ]
}

# Create namespace for Oyren workloads
resource "kubernetes_namespace" "oyren" {
  metadata {
    name = "oyren-agents"

    labels = {
      "oyren.ai/managed"     = "true"
      "oyren.ai/environment" = var.environment
    }
  }

  depends_on = [module.k8s_cluster]
}

# Create namespace for system services
resource "kubernetes_namespace" "system" {
  metadata {
    name = "oyren-system"

    labels = {
      "oyren.ai/managed" = "true"
      "oyren.ai/system"  = "true"
    }
  }

  depends_on = [module.k8s_cluster]
}

# Create ServiceAccount for Oyren composer
resource "kubernetes_service_account" "composer" {
  metadata {
    name      = "oyren-composer"
    namespace = kubernetes_namespace.system.metadata[0].name

    labels = {
      "oyren.ai/component" = "composer"
    }
  }

  depends_on = [module.k8s_cluster]
}

# RBAC: Allow composer to create/manage pods in oyren-agents namespace
resource "kubernetes_role" "composer_pod_manager" {
  metadata {
    name      = "pod-manager"
    namespace = kubernetes_namespace.oyren.metadata[0].name
  }

  rule {
    api_groups = [""]
    resources  = ["pods", "pods/log", "pods/exec"]
    verbs      = ["create", "delete", "get", "list", "watch", "update", "patch"]
  }

  rule {
    api_groups = [""]
    resources  = ["services", "configmaps", "secrets"]
    verbs      = ["create", "delete", "get", "list", "watch"]
  }

  depends_on = [module.k8s_cluster]
}

resource "kubernetes_role_binding" "composer_pod_manager" {
  metadata {
    name      = "composer-pod-manager"
    namespace = kubernetes_namespace.oyren.metadata[0].name
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Role"
    name      = kubernetes_role.composer_pod_manager.metadata[0].name
  }

  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account.composer.metadata[0].name
    namespace = kubernetes_namespace.system.metadata[0].name
  }

  depends_on = [module.k8s_cluster]
}

# Create secret for Oyren composer API token
resource "kubernetes_secret" "composer_token" {
  count = var.composer_api_token != "" ? 1 : 0

  metadata {
    name      = "composer-api-token"
    namespace = kubernetes_namespace.system.metadata[0].name
  }

  data = {
    token = var.composer_api_token
  }

  type = "Opaque"

  depends_on = [module.k8s_cluster]
}

# Optional: Install NGINX Ingress Controller via Helm
resource "helm_release" "nginx_ingress" {
  count = var.install_nginx_ingress ? 1 : 0

  name       = "ingress-nginx"
  repository = "https://kubernetes.github.io/ingress-nginx"
  chart      = "ingress-nginx"
  version    = "4.8.3"

  namespace        = "ingress-nginx"
  create_namespace = true

  set {
    name  = "controller.service.type"
    value = "LoadBalancer"
  }

  set {
    name  = "controller.service.annotations.service\\.beta\\.kubernetes\\.io/do-loadbalancer-name"
    value = "${var.project_name}-${var.environment}-ingress"
  }

  depends_on = [module.k8s_cluster]
}

# Optional: Install cert-manager for automatic TLS certificates
resource "helm_release" "cert_manager" {
  count = var.install_cert_manager ? 1 : 0

  name       = "cert-manager"
  repository = "https://charts.jetstack.io"
  chart      = "cert-manager"
  version    = "v1.13.2"

  namespace        = "cert-manager"
  create_namespace = true

  set {
    name  = "installCRDs"
    value = "true"
  }

  depends_on = [module.k8s_cluster]
}
