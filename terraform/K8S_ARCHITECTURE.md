# Kubernetes-Based Self-Hosted Oyren Architecture

## Why Kubernetes?

Running Oyren on Kubernetes provides significant advantages over single-VM deployments:

### 1. **Pod-Based Agent Isolation** 
Instead of running agents as Docker containers on a single VM, each agent runs in its own **Kubernetes pod**:

- ✅ **Better Resource Isolation** - K8s enforces CPU/memory limits per pod
- ✅ **Automatic Cleanup** - Pods are deleted when agents finish (no leftover containers)
- ✅ **Resource Scheduling** - K8s places pods on nodes with available capacity
- ✅ **Multi-Tenancy** - Run many agents simultaneously across multiple nodes

### 2. **Automatic Scaling**
Kubernetes automatically adds/removes nodes based on demand:

```
Low usage (2 users):     2 nodes  →  $48/month
Medium usage (10 users): 3 nodes  →  $72/month
High usage (50 users):   5 nodes  →  $120/month
```

- ✅ **Cost Optimization** - Only pay for what you need
- ✅ **Handle Spikes** - Scale up during peak hours, down at night
- ✅ **No Manual Intervention** - K8s manages it automatically

### 3. **High Availability**
Multiple nodes mean no single point of failure:

- ✅ **Pod Rescheduling** - If a node fails, pods move to healthy nodes
- ✅ **Rolling Updates** - Update composer without downtime
- ✅ **Load Distribution** - Spread workload across nodes

### 4. **Production-Ready Features**
Kubernetes includes enterprise features out-of-the-box:

- ✅ **Service Discovery** - Pods find each other automatically
- ✅ **Load Balancing** - Distribute traffic across replicas
- ✅ **Secrets Management** - Secure API keys and tokens
- ✅ **ConfigMaps** - Centralized configuration
- ✅ **Persistent Volumes** - Stateful workloads
- ✅ **Network Policies** - Pod-to-pod firewall rules

### 5. **Self-Hosted "Oyren Edge"**
Your K8s cluster acts like Oyren's "edge" infrastructure:

```
oyren.ai (hosted)          Your K8s Cluster (self-hosted)
━━━━━━━━━━━━━━━━━━━        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────┐        ┌─────────────────────────┐
│ Oyren Platform  │        │ Your Oyren Composer     │
│ (web UI)        │        │ (pod launcher)          │
└────────┬────────┘        └────────┬────────────────┘
         │                          │
         │ Launches agents          │ Launches pods
         │ on Oyren's infra         │ on YOUR infra
         ▼                          ▼
┌─────────────────┐        ┌─────────────────────────┐
│ Oyren's K8s     │        │ Agent Pod 1: Claude     │
│ (shared)        │        │ Agent Pod 2: Gemini     │
└─────────────────┘        │ Agent Pod 3: Codex      │
                           │ ...                     │
                           └─────────────────────────┘
```

**Key Difference:**
- Hosted: Code runs on Oyren's shared infrastructure
- Self-Hosted: Code runs ONLY on YOUR K8s cluster ✅

## Architecture Overview

```
User's Browser
     │
     │ HTTPS
     ▼
┌──────────────────────────────────────────────────┐
│  Load Balancer (DigitalOcean)                    │
│  *.yourcluster.com → NGINX Ingress Controller    │
└──────────────┬───────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│  Kubernetes Cluster                              │
│                                                   │
│  ┌─────────────────────────────────────┐        │
│  │ Namespace: oyren-system             │        │
│  │                                      │        │
│  │  ┌─────────────────────────┐        │        │
│  │  │ Oyren Composer Service  │        │        │
│  │  │ - Receives launch reqs  │        │        │
│  │  │ - Creates agent pods    │        │        │
│  │  │ - Manages lifecycles    │        │        │
│  │  └──────────┬──────────────┘        │        │
│  │             │                        │        │
│  └─────────────┼────────────────────────┘        │
│                │                                  │
│                │ Creates pods                     │
│                ▼                                  │
│  ┌─────────────────────────────────────┐        │
│  │ Namespace: oyren-agents             │        │
│  │                                      │        │
│  │  ┌─────────┐  ┌─────────┐          │        │
│  │  │ Pod     │  │ Pod     │          │        │
│  │  │ Claude  │  │ Gemini  │  ...     │        │
│  │  │ Agent   │  │ Agent   │          │        │
│  │  └─────────┘  └─────────┘          │        │
│  │                                      │        │
│  └──────────────────────────────────────┘        │
│                                                   │
│  Nodes: 2-5 (autoscales)                         │
└──────────────────────────────────────────────────┘
```

## What the Terraform Deploys

### Core Infrastructure

1. **VPC (Virtual Private Cloud)**
   - Isolated network for your cluster
   - CIDR: `10.20.0.0/16` (4096 IPs)

2. **Kubernetes Cluster**
   - Managed by DigitalOcean
   - Kubernetes version: 1.28+
   - Automatic upgrades available
   - Certificate management included

3. **Node Pool (Default)**
   - 2-5 nodes (autoscales based on load)
   - Size: `s-2vcpu-4gb` (2 vCPUs, 4GB RAM per node)
   - ~30 agent pods can run simultaneously

### Kubernetes Resources

4. **Namespaces**
   - `oyren-system` - For composer service
   - `oyren-agents` - For agent pods

5. **ServiceAccount & RBAC**
   - `oyren-composer` service account
   - Permissions to create/manage pods in `oyren-agents` namespace
   - Follows principle of least privilege

6. **Secrets**
   - Composer API token (if provided)
   - Additional secrets can be added

### Optional Add-ons

7. **NGINX Ingress Controller** (optional, enabled by default)
   - Routes HTTP/HTTPS traffic to services
   - Automatic load balancer creation
   - WebSocket support for terminal connections

8. **cert-manager** (optional, enabled by default)
   - Automatic TLS certificate issuance
   - Let's Encrypt integration
   - Certificate renewal

9. **DNS Records** (optional)
   - A record: `composer-k8s-dev.yourdomain.com`
   - Wildcard: `*.composer-k8s-dev.yourdomain.com`

## Deployment Process

### What Happens When You Run Terraform

```bash
terraform apply -var-file="k8s-dev.tfvars"
```

**Step 1: Network Setup** (30 seconds)
- Creates VPC
- Creates firewall rules

**Step 2: Cluster Provisioning** (5-7 minutes)
- DigitalOcean provisions control plane
- Launches 2 worker nodes
- Configures networking (CNI plugin)
- Sets up load balancer

**Step 3: Kubernetes Resources** (1 minute)
- Creates namespaces
- Creates service accounts
- Sets up RBAC permissions
- Stores secrets

**Step 4: Add-on Installation** (2-3 minutes)
- Installs NGINX Ingress via Helm
- Installs cert-manager via Helm
- Waits for components to be ready

**Total Time: ~8-12 minutes**

### After Terraform Completes

You'll have:
- ✅ A fully functional Kubernetes cluster
- ✅ Kubeconfig file for `kubectl` access
- ✅ Namespaces ready for workloads
- ✅ NGINX Ingress Controller running
- ✅ cert-manager for TLS certificates
- ✅ Service account for composer

**What's NOT deployed yet:**
- ❌ Oyren Composer application (you deploy this separately)
- ❌ Agent container images (pulled from Docker Hub when pods start)

## Pod Lifecycle Example

### 1. User Requests Agent
```
User clicks "Launch Claude Agent" in web UI
  ↓
Request sent to YOUR composer service
  (running in oyren-system namespace)
```

### 2. Composer Creates Pod
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: claude-agent-abc123
  namespace: oyren-agents
spec:
  containers:
  - name: agent
    image: oyrendev/oyren-sandbox-claude:latest
    env:
    - name: GITHUB_TOKEN
      value: "ghs_..."
    - name: AGENT_KIND
      value: "claude-code"
    resources:
      requests:
        memory: "2Gi"
        cpu: "1000m"
      limits:
        memory: "4Gi"
        cpu: "2000m"
```

### 3. Kubernetes Schedules Pod
```
K8s scheduler finds a node with available resources
  ↓
Pod starts on node-2
  ↓
Downloads oyrendev/oyren-sandbox-claude:latest (if not cached)
  ↓
Container starts, agent launches
```

### 4. User Interacts with Agent
```
User connects to pod via WebSocket
  ↓
NGINX Ingress routes to pod
  ↓
Terminal session established
  ↓
User runs commands, agent executes
```

### 5. Session Ends
```
User closes session
  ↓
Composer deletes pod
  ↓
K8s terminates container
  ↓
Resources freed
```

**Key Benefit:** No manual cleanup needed! Pods auto-delete.

## Cost Breakdown

### Kubernetes Cluster (DigitalOcean)

**Development Setup:**
- 2 nodes × `s-2vcpu-4gb` = 2 × $24 = **$48/month**
- Load Balancer (for Ingress) = **$12/month**
- **Total: ~$60/month**

**Can run ~30 concurrent agent pods**

**Production Setup:**
- 3 nodes × `s-4vcpu-8gb` = 3 × $48 = **$144/month**
- Load Balancer = **$12/month**
- Block Storage (optional) = ~$10/month
- **Total: ~$166/month**

**Can run ~90 concurrent agent pods**

### Autoscaling Example

```
Idle (2 nodes):          $60/month
Light load (3 nodes):    $84/month
Heavy load (5 nodes):    $132/month
```

**Average over a month:** ~$90/month (if you hit peak 20% of the time)

### vs. Docker-only VM

**VM-based:**
- 1 large VM (8GB RAM) = $48/month
- Limited to ~10 concurrent agents
- Manual scaling required

**K8s-based:**
- 2-5 nodes (autoscales) = $60-132/month
- Supports ~30-150 concurrent agents
- Automatic scaling

**Verdict:** K8s costs more but provides 3-15x capacity + autoscaling

## Security Features

### 1. **Network Isolation**
- VPC isolates cluster from public internet
- Private networking between nodes
- Firewall rules on node level

### 2. **RBAC (Role-Based Access Control)**
- Composer can ONLY create pods in `oyren-agents` namespace
- Cannot access other namespaces
- Minimal permissions (principle of least privilege)

### 3. **Secrets Management**
- API tokens stored as Kubernetes secrets
- Encrypted at rest
- Mounted as environment variables (not in images)

### 4. **Pod Security**
- Resource limits prevent resource exhaustion
- Network policies can restrict pod-to-pod communication
- Can enable Pod Security Standards (PSS)

### 5. **Automatic Updates**
- Kubernetes patches applied automatically
- Node OS updates during maintenance window
- Zero-downtime rolling updates

## Kubernetes Benefits Summary

| Feature | Docker VM | Kubernetes | Benefit |
|---------|-----------|------------|---------|
| **Isolation** | Container | Pod (stricter) | ✅ Better security |
| **Scaling** | Manual | Automatic | ✅ Handles load spikes |
| **Availability** | Single VM | Multi-node | ✅ No single point of failure |
| **Resource Limits** | Best-effort | Enforced | ✅ Prevents resource starvation |
| **Cleanup** | Manual | Automatic | ✅ No leftover containers |
| **Updates** | Downtime | Rolling | ✅ Zero-downtime deploys |
| **Load Balancing** | None | Built-in | ✅ Distributes traffic |
| **Service Discovery** | Manual | Automatic | ✅ Pods find each other |
| **Cost** | Fixed | Variable | ✅ Pay for what you use |
| **Capacity** | ~10 agents | ~30-150 agents | ✅ 3-15x more capacity |

## When to Use Kubernetes vs. VM

### Use Kubernetes If:
- ✅ You expect more than 10 concurrent users
- ✅ You need autoscaling
- ✅ You want zero-downtime updates
- ✅ You need high availability
- ✅ You're comfortable with K8s complexity

### Use Single VM If:
- ✅ You have 1-5 users
- ✅ Downtime is acceptable
- ✅ Manual scaling is OK
- ✅ You want simplicity
- ✅ Cost is primary concern

## Next Steps

1. **Deploy the cluster:**
   ```bash
   cd terraform/environments/k8s-dev
   ./../../deploy.sh k8s-dev
   ```

2. **Configure kubectl:**
   ```bash
   doctl kubernetes cluster kubeconfig save <cluster-id>
   kubectl get nodes
   ```

3. **Deploy Oyren Composer:**
   ```bash
   kubectl apply -f ../../k8s/composer-deployment.yaml
   ```

4. **Verify it's working:**
   ```bash
   kubectl get pods -n oyren-system
   kubectl logs -n oyren-system -l app=oyren-composer
   ```

5. **Launch your first agent pod:**
   ```bash
   # Via composer API
   curl -X POST https://composer.yourdomain.com/launch \
     -H "Authorization: Bearer <token>" \
     -d '{"agent":"claude-code","repo":"owner/repo"}'
   ```

Your code stays 100% private on YOUR Kubernetes cluster! 🎉
