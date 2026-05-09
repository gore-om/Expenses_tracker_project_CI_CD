# Ledgerly CI/CD SOP

This SOP provisions and deploys the Ledgerly expense tracker using Terraform, Jenkins on AWS EC2, Azure Container Registry, Azure Kubernetes Service, Azure Database for PostgreSQL, NGINX Ingress, DNS and HTTPS.

## Architecture

```text
GitHub
  -> Jenkins on AWS EC2
  -> Docker build
  -> Azure Container Registry
  -> Azure Kubernetes Service
  -> Azure PostgreSQL
  -> NGINX Ingress Controller
  -> DNS domain
  -> cert-manager / Let's Encrypt HTTPS
```

## Prerequisites

- AWS EC2 instance for Jenkins.
- Azure subscription.
- Domain name, for example `riskybusiness.online`.
- GitHub repository connected to Jenkins.
- Local machine with VS Code or Git Bash for Terraform execution.

Install these tools on the Jenkins EC2 instance:

```bash
java
jenkins
git
docker
azure-cli
kubectl
helm
```

Allow Jenkins to run Docker:

```bash
sudo usermod -aG docker jenkins
sudo systemctl restart jenkins
```

Verify:

```bash
docker version
git --version
az version
kubectl version --client
helm version
```

## Step 1: Provision Azure Infrastructure With Terraform

From local VS Code or Git Bash:

```bash
cd terraform_code_infra/Code_1
az login
az account set --subscription "<subscription-id>"
terraform init
terraform validate
terraform plan
terraform apply
```

Terraform provisions:

- Azure Resource Group
- Azure Container Registry
- Azure Kubernetes Service
- Azure Database for PostgreSQL Flexible Server
- AKS permission to pull images from ACR

After apply, collect outputs:

```bash
terraform output
terraform output -raw acr_login_server
terraform output -raw resource_group_name
terraform output -raw aks_cluster_name
terraform output -raw postgres_host
terraform output -raw postgres_database
terraform output -raw postgres_user
```

Save these values for Jenkins parameters.

## Step 2: Configure Azure Permission For Jenkins

Create an Azure service principal for Jenkins or use an existing one.

Minimum practical permissions for this project:

- `AcrPush` on the Azure Container Registry.
- AKS access sufficient for `az aks get-credentials` and `kubectl apply`.
- Contributor on the target resource group for simple project practice.

Ensure AKS can pull from ACR:

```bash
az aks update \
  --resource-group "<resource-group-name>" \
  --name "<aks-cluster-name>" \
  --attach-acr "<acr-name>"
```

## Step 3: Configure Jenkins Credentials

Create these Jenkins credentials as Secret text:

```text
azure-client-id
azure-client-secret
azure-tenant-id
azure-subscription-id
postgres-admin-password
```

`postgres-admin-password` must match the PostgreSQL password used during Terraform provisioning.

Use a URL-safe PostgreSQL password for this project, because the pipeline builds a PostgreSQL connection string:

```text
postgres://USER:PASSWORD@HOST:5432/DB
```

Avoid special characters like `@`, `/`, `#`, `?`, `&` unless they are URL encoded.

## Step 4: Create Jenkins Pipeline Job

Create a Jenkins Pipeline from SCM:

- SCM: Git
- Repository URL: GitHub repository URL
- Branch: `main`
- Script path: `Jenkinsfile`
- Enable GitHub webhook trigger if using automatic deployment.

Add GitHub webhook:

```text
http://<JENKINS_EC2_PUBLIC_IP>:8080/github-webhook/
```

## Step 5: Run Jenkins Deployment

For the manual-infra flow, use:

```text
RUN_TERRAFORM=false
APPLY_TERRAFORM=false
RESOURCE_GROUP_NAME=<terraform resource_group_name>
ACR_NAME=<acr name without .azurecr.io>
AKS_NAME=<terraform aks_cluster_name>
POSTGRES_HOST=<terraform postgres_host>
POSTGRES_DATABASE=expensesdb
POSTGRES_USER=pgadmin
```

The pipeline performs:

1. Checkout repository.
2. Validate backend JavaScript syntax.
3. Login to Azure with service principal.
4. Load deployment configuration from Jenkins parameters.
5. Build frontend Docker image.
6. Build backend Docker image.
7. Login to ACR.
8. Push both images to ACR.
9. Get AKS credentials.
10. Create or update namespace `ledgerly`.
11. Create or update Kubernetes secret `ledgerly-secrets`.
12. Apply Kubernetes manifests.
13. Update frontend and backend images.
14. Set backend `APP_VERSION` from the `VERSION` file.
15. Wait for frontend and backend rollout.

## Step 6: Verify AKS Deployment

Run on the Jenkins EC2 instance:

```bash
sudo -u jenkins kubectl -n ledgerly get pods
sudo -u jenkins kubectl -n ledgerly get svc
sudo -u jenkins kubectl -n ledgerly get ingress
```

Expected pods:

```text
ledgerly-backend    1/1 Running
ledgerly-frontend   1/1 Running
```

Test backend health with port-forward:

```bash
sudo -u jenkins kubectl -n ledgerly port-forward svc/ledgerly-backend 18080:8080
```

In another terminal:

```bash
curl http://127.0.0.1:18080/health
```

Expected response includes:

```json
{"status":"ok","service":"ledgerly-api","environment":"production"}
```

## Step 7: Install NGINX Ingress Controller

Install NGINX Ingress:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/azure-load-balancer-health-probe-request-path"=/healthz
```

Verify:

```bash
kubectl -n ingress-nginx get pods
kubectl -n ingress-nginx get svc ingress-nginx-controller
```

Copy the `EXTERNAL-IP`.

If the public load balancer times out, confirm the health probe path:

```bash
NODE_RG=$(az aks show \
  --resource-group "<resource-group-name>" \
  --name "<aks-cluster-name>" \
  --query nodeResourceGroup \
  -o tsv)

az network lb probe list \
  --resource-group "$NODE_RG" \
  --lb-name kubernetes \
  -o table
```

The HTTP probe should use `/healthz`.

## Step 8: Configure DNS

In the domain provider DNS panel, create an A record:

```text
Type: A
Name: @
Value: <NGINX_INGRESS_EXTERNAL_IP>
TTL: Default
```

For a subdomain:

```text
Type: A
Name: app
Value: <NGINX_INGRESS_EXTERNAL_IP>
```

Verify:

```bash
nslookup riskybusiness.online
curl -Iv http://riskybusiness.online
```

## Step 9: Configure Ingress Host

Update `k8s/04-ingress.yaml`:

```yaml
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - riskybusiness.online
      secretName: ledgerly-tls
  rules:
    - host: riskybusiness.online
```

For initial HTTP testing, keep:

```yaml
nginx.ingress.kubernetes.io/ssl-redirect: "false"
```

Commit and push:

```bash
git add k8s/04-ingress.yaml
git commit -m "Configure production ingress domain"
git push
```

Jenkins redeploys the ingress.

## Step 10: Install cert-manager

Install cert-manager:

```bash
helm repo add jetstack https://charts.jetstack.io
helm repo update

helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set crds.enabled=true
```

Verify:

```bash
kubectl -n cert-manager get pods
```

## Step 11: Create Let's Encrypt ClusterIssuer

Create `cluster-issuer.yaml`:

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

Apply:

```bash
kubectl apply -f cluster-issuer.yaml
kubectl get clusterissuer
kubectl describe clusterissuer letsencrypt-prod
```

Check certificate:

```bash
kubectl -n ledgerly get certificate
kubectl -n ledgerly describe certificate ledgerly-tls
kubectl -n ledgerly get order
kubectl -n ledgerly get challenge
```

Test HTTPS:

```bash
curl -Iv https://riskybusiness.online
```

## Step 12: Enable HTTP To HTTPS Redirect

After HTTPS works, update `k8s/04-ingress.yaml`:

```yaml
nginx.ingress.kubernetes.io/ssl-redirect: "true"
```

Commit and push:

```bash
git add k8s/04-ingress.yaml
git commit -m "Enable HTTPS redirect"
git push
```

Verify:

```bash
curl -Iv http://riskybusiness.online
curl -Iv https://riskybusiness.online
```

## Troubleshooting Commands

Pipeline rollout diagnostics:

```bash
sudo -u jenkins kubectl -n ledgerly get pods -o wide
sudo -u jenkins kubectl -n ledgerly describe deployment ledgerly-backend
sudo -u jenkins kubectl -n ledgerly describe pods -l app=ledgerly-backend
sudo -u jenkins kubectl -n ledgerly logs -l app=ledgerly-backend --tail=100 --all-containers=true --previous
sudo -u jenkins kubectl -n ledgerly get events --sort-by=.lastTimestamp
```

Ingress diagnostics:

```bash
kubectl -n ingress-nginx get pods -o wide
kubectl -n ingress-nginx get svc ingress-nginx-controller
kubectl -n ingress-nginx describe svc ingress-nginx-controller
kubectl -n ingress-nginx logs deployment/ingress-nginx-controller --tail=100
```

Azure Load Balancer diagnostics:

```bash
NODE_RG=$(az aks show \
  --resource-group "<resource-group-name>" \
  --name "<aks-cluster-name>" \
  --query nodeResourceGroup \
  -o tsv)

az network lb rule list \
  --resource-group "$NODE_RG" \
  --lb-name kubernetes \
  -o table

az network lb probe list \
  --resource-group "$NODE_RG" \
  --lb-name kubernetes \
  -o table
```

## Final Validation Checklist

```text
[ ] Terraform infrastructure created successfully
[ ] ACR exists
[ ] AKS exists
[ ] PostgreSQL exists
[ ] AKS has AcrPull permission on ACR
[ ] Jenkins credentials are configured
[ ] Jenkins pipeline builds frontend and backend images
[ ] Jenkins pushes images to ACR
[ ] Jenkins deploys app to AKS
[ ] Frontend pods are Running
[ ] Backend pods are Running
[ ] Backend health endpoint works
[ ] NGINX Ingress has public IP
[ ] DNS points to ingress public IP
[ ] HTTP works
[ ] cert-manager is installed
[ ] Let's Encrypt certificate is Ready
[ ] HTTPS works
[ ] HTTP redirects to HTTPS
```

## Resume Highlights

- Built an end-to-end CI/CD pipeline using Jenkins, Docker, Azure Container Registry and Azure Kubernetes Service.
- Provisioned cloud infrastructure with Terraform, including AKS, ACR, Azure PostgreSQL and role assignments.
- Deployed a full-stack Node.js and NGINX frontend application to Kubernetes using declarative manifests.
- Implemented Kubernetes services, deployments, readiness/liveness probes, secrets and ingress routing.
- Integrated GitHub webhook-triggered Jenkins deployments with versioned Docker image tags.
- Configured NGINX Ingress Controller, custom domain DNS and HTTPS with cert-manager and Let's Encrypt.
- Troubleshot real production-style issues including ACR pull permissions, Azure PostgreSQL extension restrictions, Kubernetes CrashLoopBackOff and Azure Load Balancer health probes.
- Delivered a working public HTTPS application with automated build, push and rollout workflow.
