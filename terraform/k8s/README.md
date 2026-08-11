# Kubernetes Manifests for Oyren Composer

This directory contains Kubernetes deployment manifests for running Oyren Composer on your self-hosted cluster.

## Prerequisites

1. **Kubernetes cluster deployed** - Use Terraform to deploy:
   ```bash
   cd ../environments/k8s-dev
   terraform apply -var-file="k8s-dev.tfvars"
   ```

2. **kubectl configured**:
   ```bash
   doctl kubernetes cluster kubeconfig save <cluster-id>
   # Or use the generated kubeconfig:
   export KUBECONFIG=../environments/k8s-dev/kubeconfig-oyren-composer-dev.yaml
   ```

3. **Verify cluster access**:
   ```bash
   kubectl get nodes
   kubectl get namespaces
   ```

## Deploy Oyren Composer

### 1. Update the configuration

Edit `composer-deployment.yaml` and replace:
- `composer.yourdomain.com` → Your actual domain
- `oyrendev/oyren-composer:latest` → Your composer image (if different)

### 2. Apply the manifests

```bash
kubectl apply -f composer-deployment.yaml
```

This creates:
- **ConfigMap** - Environment configuration
- **Deployment** - 2 replicas of composer (auto-scales 2-10)
- **Service** - ClusterIP service for internal access
- **Ingress** - External HTTPS access via NGINX
- **HorizontalPodAutoscaler** - Auto-scaling based on CPU/memory

### 3. Verify deployment

```bash
# Check pods are running
kubectl get pods -n oyren-system

# Check service
kubectl get svc -n oyren-system oyren-composer

# Check ingress
kubectl get ingress -n oyren-system

# View logs
kubectl logs -n oyren-system -l app=oyren-composer --tail=100 -f
```

### 4. Get the external IP

```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
```

Look for the `EXTERNAL-IP` column. This is your load balancer IP.

### 5. Configure DNS

Point your domain to the external IP:
```
composer.yourdomain.com  →  <EXTERNAL-IP>
```

### 6. Test access

```bash
curl https://composer.yourdomain.com/healthz
# Should return: {"status":"ok"}
```

## Enable TLS (HTTPS)

### Option 1: Let's Encrypt (Recommended)

1. **Create ClusterIssuer** (cert-manager must be installed):

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
```

```bash
kubectl apply -f letsencrypt-issuer.yaml
```

2. **Uncomment TLS section** in `composer-deployment.yaml`:

```yaml
annotations:
  cert-manager.io/cluster-issuer: letsencrypt-prod
tls:
- hosts:
  - composer.yourdomain.com
  secretName: composer-tls
```

3. **Re-apply**:
```bash
kubectl apply -f composer-deployment.yaml
```

4. **Wait for certificate** (1-2 minutes):
```bash
kubectl get certificate -n oyren-system
kubectl describe certificate composer-tls -n oyren-system
```

### Option 2: Bring Your Own Certificate

```bash
kubectl create secret tls composer-tls \
  --cert=path/to/tls.crt \
  --key=path/to/tls.key \
  -n oyren-system
```

Then uncomment the TLS section in the Ingress.

## Scaling

### Manual Scaling

```bash
# Scale to 5 replicas
kubectl scale deployment oyren-composer -n oyren-system --replicas=5

# Scale back to 2
kubectl scale deployment oyren-composer -n oyren-system --replicas=2
```

### Automatic Scaling (HPA)

The HorizontalPodAutoscaler automatically scales based on CPU/memory:

```bash
# View HPA status
kubectl get hpa -n oyren-system

# Example output:
# NAME             REFERENCE                   TARGETS         MINPODS   MAXPODS   REPLICAS
# oyren-composer   Deployment/oyren-composer   45%/70%, 60%/80%   2         10        3
```

**Behavior:**
- Scales UP when CPU > 70% or Memory > 80%
- Scales DOWN when usage drops (waits 5 minutes)
- Min: 2 replicas (always), Max: 10 replicas

## Monitoring

### View Logs

```bash
# All pods
kubectl logs -n oyren-system -l app=oyren-composer --tail=100 -f

# Specific pod
kubectl logs -n oyren-system oyren-composer-<pod-id> -f

# Previous crashed pod
kubectl logs -n oyren-system oyren-composer-<pod-id> --previous
```

### Pod Status

```bash
# List all pods
kubectl get pods -n oyren-system

# Detailed pod info
kubectl describe pod oyren-composer-<pod-id> -n oyren-system

# Resource usage
kubectl top pods -n oyren-system
kubectl top nodes
```

### Events

```bash
# Recent events
kubectl get events -n oyren-system --sort-by='.lastTimestamp'

# Watch events live
kubectl get events -n oyren-system --watch
```

## Updating Composer

### Rolling Update (Zero Downtime)

```bash
# Update image
kubectl set image deployment/oyren-composer \
  composer=oyrendev/oyren-composer:v2.0.0 \
  -n oyren-system

# Or edit deployment
kubectl edit deployment oyren-composer -n oyren-system

# Watch rollout
kubectl rollout status deployment/oyren-composer -n oyren-system
```

### Rollback

```bash
# View rollout history
kubectl rollout history deployment/oyren-composer -n oyren-system

# Rollback to previous version
kubectl rollout undo deployment/oyren-composer -n oyren-system

# Rollback to specific revision
kubectl rollout undo deployment/oyren-composer -n oyren-system --to-revision=2
```

## Troubleshooting

### Pods not starting

```bash
# Check pod status
kubectl get pods -n oyren-system

# View events
kubectl describe pod oyren-composer-<pod-id> -n oyren-system

# Common issues:
# - ImagePullBackOff: Image doesn't exist or is private
# - CrashLoopBackOff: Container is crashing, check logs
# - Pending: Insufficient resources or scheduling issues
```

### Can't access via Ingress

```bash
# Check ingress
kubectl describe ingress oyren-composer -n oyren-system

# Check NGINX ingress controller
kubectl get pods -n ingress-nginx
kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx

# Test service directly (port-forward)
kubectl port-forward -n oyren-system svc/oyren-composer 8080:80
curl http://localhost:8080/healthz
```

### High CPU/Memory usage

```bash
# Check resource usage
kubectl top pods -n oyren-system

# Increase limits in composer-deployment.yaml:
resources:
  limits:
    memory: "2Gi"  # Was 1Gi
    cpu: "2000m"   # Was 1000m
```

## Cleanup

### Delete Composer (Keep Cluster)

```bash
kubectl delete -f composer-deployment.yaml
```

### Delete Everything (Including Cluster)

```bash
cd ../environments/k8s-dev
terraform destroy -var-file="k8s-dev.tfvars"
```

## Next Steps

- Configure monitoring with Prometheus + Grafana
- Set up log aggregation with Loki or ELK
- Add Network Policies for pod-to-pod security
- Configure PodDisruptionBudget for HA
- Set up backup/restore procedures

## Support

- [Kubernetes Docs](https://kubernetes.io/docs/)
- [NGINX Ingress Docs](https://kubernetes.github.io/ingress-nginx/)
- [cert-manager Docs](https://cert-manager.io/docs/)
- [Open an Issue](https://github.com/oyren-ai/oyren-ai-composer/issues)
