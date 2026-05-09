# Sovereign CI/CD Runbook

This runbook explains the full deployment flow for running Sovereign with Jenkins on AWS EC2 and Azure AKS/ACR.

## Target Flow

```text
GitHub
  -> GitHub Webhook
  -> Jenkins on AWS EC2
  -> Docker Build
  -> Azure Container Registry
  -> Azure Kubernetes Service
  -> NGINX Ingress Controller
  -> GoDaddy Custom Domain
  -> Let's Encrypt HTTPS
```

## Services Needed

### AWS

- EC2 instance for Jenkins.
- Security group for Jenkins and SSH.
- Elastic IP for stable Jenkins access.
- IAM user or role only if you want AWS-native automation later.

Recommended EC2 inbound rules:

```text
22    SSH      Your IP only
8080  Jenkins  Your IP or GitHub webhook source ranges
80    HTTP     Optional, only if reverse proxying Jenkins
443   HTTPS    Optional, only if reverse proxying Jenkins
```

For practice, Jenkins on `http://EC2_PUBLIC_IP:8080` is okay. For production, put Jenkins behind HTTPS.

### Azure

- Resource Group.
- Azure Container Registry.
- Azure Kubernetes Service.
- Azure Database for PostgreSQL or another managed PostgreSQL provider.
- Service Principal for Jenkins.
- DNS public IP from NGINX Ingress controller.
- Optional: Log Analytics workspace for AKS monitoring.
- Optional: Key Vault for secrets.

### GoDaddy

- Domain or subdomain.
- DNS `A` record pointing to the NGINX Ingress external IP.

## Step 1: Prepare Jenkins EC2

Install on the EC2 instance:

- Java
- Jenkins
- Docker
- Azure CLI
- kubectl
- Git
- Terraform

The Jenkins user must be able to run Docker:

```bash
sudo usermod -aG docker jenkins
sudo systemctl restart jenkins
```

Then confirm:

```bash
docker version
az version
kubectl version --client
```

## Step 2: Create Azure Infrastructure

Use Terraform to create:

- Resource group
- ACR
- AKS
- AKS node pool
- Role assignment so AKS can pull from ACR

Important relationship:

```text
AKS needs AcrPull permission on ACR
Jenkins service principal needs permission to push to ACR and deploy to AKS
```

Useful Azure permissions for Jenkins service principal:

- AcrPush on ACR
- Azure Kubernetes Service Cluster User Role on AKS
- Contributor on the AKS resource group for easier practice

For stricter production setups, reduce Contributor later.

## Step 3: Create PostgreSQL

Use one of these:

- Azure Database for PostgreSQL Flexible Server
- Neon
- Supabase
- A PostgreSQL Helm chart inside AKS, practice only

Recommended for this project:

```text
Azure Database for PostgreSQL Flexible Server
```

You need:

- Hostname
- Database name
- Username
- Password
- SSL enabled

The app expects:

```text
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
DB_SSL=true
```

## Step 4: Configure Jenkins Credentials

Create these Jenkins secret text credentials:

```text
azure-client-id
azure-client-secret
azure-tenant-id
azure-subscription-id
postgres-admin-password
```

The Azure values come from a service principal:

```text
client id
client secret
tenant id
subscription id
```

The `postgres-admin-password` value is used by Terraform for Azure PostgreSQL and by Jenkins to create the AKS `ledgerly-secrets` secret. Use a URL-safe password for this project, because the pipeline builds a PostgreSQL connection string from it.

The Jenkins job also exposes these build parameters:

```text
RUN_TERRAFORM
APPLY_TERRAFORM
AZURE_LOCATION
RESOURCE_GROUP_NAME
ACR_NAME
AKS_NAME
POSTGRES_SERVER_NAME
POSTGRES_HOST
POSTGRES_DATABASE
POSTGRES_USER
```

Recommended beginner flow:

1. Create infrastructure manually from VS Code or Git Bash using Terraform.
2. Run Jenkins with `RUN_TERRAFORM=false`.
3. Fill `RESOURCE_GROUP_NAME`, `ACR_NAME`, `AKS_NAME`, `POSTGRES_HOST`, `POSTGRES_DATABASE` and `POSTGRES_USER` from Terraform outputs.

Alternative Jenkins-managed flow:

1. Run Jenkins with `RUN_TERRAFORM=true`.
2. For the first run, also enable `APPLY_TERRAFORM=true`.
3. For later app-only deployments, keep `RUN_TERRAFORM=true` and `APPLY_TERRAFORM=false` only if Jenkins has access to the same Terraform state.

## Step 5: Kubernetes Secret

Jenkins creates the namespace and database secret automatically during the deploy stage:

```bash
kubectl -n ledgerly create secret generic ledgerly-secrets \
  --from-literal=DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DBNAME' \
  --from-literal=DB_SSL='true' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Do not commit real secrets to GitHub.

## Step 6: Install NGINX Ingress Controller

Install NGINX Ingress in AKS:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace
```

Get the external IP:

```bash
kubectl -n ingress-nginx get service ingress-nginx-controller
```

Copy the `EXTERNAL-IP`.

## Step 7: Configure GoDaddy DNS

In GoDaddy DNS, create:

```text
Type: A
Name: expense
Value: <NGINX_INGRESS_EXTERNAL_IP>
TTL: Default
```

Example:

```text
expense.yourdomain.com -> 20.10.50.100
```

Then update [k8s/04-ingress.yaml](../k8s/04-ingress.yaml):

```yaml
hosts:
  - expense.yourdomain.com
```

Replace every `expense.example.com`.

## Step 8: Install cert-manager For HTTPS

Install cert-manager:

```bash
helm repo add jetstack https://charts.jetstack.io
helm repo update

helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set crds.enabled=true
```

Create a Let's Encrypt cluster issuer:

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

Apply it:

```bash
kubectl apply -f cluster-issuer.yaml
```

The app ingress already references:

```yaml
cert-manager.io/cluster-issuer: letsencrypt-prod
```

## Step 9: Configure GitHub Webhook

In GitHub repository settings:

```text
Settings -> Webhooks -> Add webhook
```

Payload URL:

```text
http://<JENKINS_EC2_PUBLIC_IP>:8080/github-webhook/
```

Content type:

```text
application/json
```

Events:

```text
Just the push event
```

In Jenkins job:

- Use Pipeline from SCM.
- Point it to your GitHub repository.
- Enable GitHub hook trigger for GITScm polling.

## Step 10: First Deployment

Push the repo to GitHub.

Jenkins should:

1. Checkout code.
2. Read `VERSION`.
3. Login to Azure.
4. Initialize, validate and plan Terraform.
5. Apply Terraform when `APPLY_TERRAFORM` is enabled.
6. Read ACR, AKS and PostgreSQL values from Terraform outputs.
7. Build frontend and backend Docker images.
8. Login to ACR and push images.
9. Get AKS credentials.
10. Create or update the Kubernetes database secret.
11. Apply Kubernetes manifests.
12. Update deployment images and backend `APP_VERSION`.
13. Wait for rollout.

## Step 11: Test Automatic Pipeline

Change [VERSION](../VERSION):

```text
v1.0.1
```

Commit and push:

```bash
git add VERSION
git commit -m "Bump app version to v1.0.1"
git push
```

Expected result:

- GitHub webhook triggers Jenkins.
- Jenkins builds and deploys.
- App sidebar shows:

```text
App Version
v1.0.1
```

## Step 12: Useful Verification Commands

Check pods:

```bash
kubectl -n ledgerly get pods
```

Check services:

```bash
kubectl -n ledgerly get svc
```

Check ingress:

```bash
kubectl -n ledgerly get ingress
```

Check rollout:

```bash
kubectl -n ledgerly rollout status deployment/ledgerly-frontend
kubectl -n ledgerly rollout status deployment/ledgerly-backend
```

Check logs:

```bash
kubectl -n ledgerly logs deployment/ledgerly-backend
```

Check TLS certificate:

```bash
kubectl -n ledgerly get certificate
kubectl -n ledgerly describe certificate ledgerly-tls
```

## Production Improvements

Add these later to make the setup more production-like:

- Jenkins behind HTTPS.
- Jenkins credentials locked down with least privilege.
- Azure Key Vault for database secrets.
- External Secrets Operator for syncing Key Vault to Kubernetes.
- AKS Horizontal Pod Autoscaler.
- Azure Monitor and Log Analytics.
- Separate dev/staging/prod namespaces.
- Branch-based deployments.
- Rollback stage in Jenkins.
- Image scanning before push or deploy.
- PostgreSQL backups and alerting.
- Private AKS or restricted API server access.
- ACR retention policy.

## Final Checklist

```text
[ ] Jenkins EC2 is running
[ ] Docker works on Jenkins
[ ] Azure CLI works on Jenkins
[ ] kubectl works on Jenkins
[ ] Jenkins can login to Azure
[ ] ACR exists
[ ] AKS exists
[ ] AKS can pull from ACR
[ ] PostgreSQL is ready
[ ] ledgerly-secrets exists in AKS
[ ] NGINX Ingress is installed
[ ] GoDaddy DNS points to ingress IP
[ ] cert-manager is installed
[ ] letsencrypt-prod ClusterIssuer exists
[ ] GitHub webhook is configured
[ ] Jenkinsfile credentials match Jenkins credential IDs
[ ] VERSION bump triggers the pipeline
```
