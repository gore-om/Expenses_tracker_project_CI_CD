# Ledgerly Architecture

Ledgerly is a production-shaped expense tracker built for CI/CD practice across Jenkins, ACR, AKS, NGINX Ingress, a custom domain and Let's Encrypt.

## Services

- Frontend: Static HTML, CSS and JavaScript served by NGINX.
- Backend: Node.js Express API with auth, profile preferences, validation, redacted request logging, security headers, health checks and PostgreSQL persistence.
- Database: PostgreSQL. Use Azure Database for PostgreSQL, Neon, Supabase or another managed PostgreSQL service for AKS practice.
- Ingress: NGINX routes `/` to the frontend and `/api` to the backend.

## CI/CD Flow

1. GitHub webhook triggers Jenkins on AWS EC2.
2. Jenkins checks out the repository.
3. Jenkins builds two Docker images.
4. Jenkins logs in to Azure and ACR.
5. Jenkins pushes images to ACR.
6. Jenkins applies Kubernetes manifests to AKS.
7. Jenkins updates frontend and backend image tags.
8. Jenkins updates `APP_VERSION` on the backend deployment from `VERSION`.
9. AKS rolls out the deployments behind NGINX Ingress.
10. cert-manager issues HTTPS certificates through Let's Encrypt.

## Version Flow

The root `VERSION` file is the human release version. A version-only commit is useful for webhook testing:

```bash
git add VERSION
git commit -m "Bump app version"
git push
```

GitHub sends the webhook to Jenkins, Jenkins builds new images, deploys to AKS and sets `APP_VERSION` on the backend deployment.

## Required Jenkins Credentials

- `azure-client-id`: Azure service principal application/client ID.
- `azure-client-secret`: Azure service principal client secret.
- `azure-tenant-id`: Azure tenant ID.
- `azure-subscription-id`: Azure subscription ID.
- `postgres-admin-password`: PostgreSQL administrator password used by Terraform and the AKS `ledgerly-secrets` secret.

The Jenkins build parameters provide the Azure resource names used by Terraform:

- `RUN_TERRAFORM`
- `APPLY_TERRAFORM`
- `RESOURCE_GROUP_NAME`
- `ACR_NAME`
- `AKS_NAME`
- `POSTGRES_SERVER_NAME`
- `POSTGRES_HOST`
- `POSTGRES_DATABASE`
- `POSTGRES_USER`
- `AZURE_LOCATION`

For the recommended manual-infra flow, create Terraform infrastructure from your local terminal, then run Jenkins with `RUN_TERRAFORM=false` and provide the output values as Jenkins parameters.

## Kubernetes Secrets

Jenkins creates or updates the production database secret during deployment from Terraform outputs and the `postgres-admin-password` credential. Keep the example in `docs/ledgerly-secret.example.yaml`; do not put a placeholder secret inside `k8s/`.

```bash
kubectl -n ledgerly create secret generic ledgerly-secrets \
  --from-literal=DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DBNAME' \
  --from-literal=DB_SSL='true'
```

## Domain Setup

Point your GoDaddy DNS record to the external IP address of the NGINX Ingress controller.

Replace `expense.example.com` in `k8s/04-ingress.yaml` with your real domain before deployment.
