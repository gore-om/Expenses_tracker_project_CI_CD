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

- `AZURE_SERVICE_PRINCIPAL`: Azure service principal credential.
- `AZURE_ACR_NAME`: ACR name without `.azurecr.io`.
- `AZURE_AKS_RESOURCE_GROUP`: AKS resource group name.
- `AZURE_AKS_CLUSTER_NAME`: AKS cluster name.

## Kubernetes Secrets

Create the production database secret before deploying. Keep the example in `docs/ledgerly-secret.example.yaml`; do not put a placeholder secret inside `k8s/` because Jenkins applies that directory.

```bash
kubectl -n ledgerly create secret generic ledgerly-secrets \
  --from-literal=DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DBNAME' \
  --from-literal=DB_SSL='true'
```

## Domain Setup

Point your GoDaddy DNS record to the external IP address of the NGINX Ingress controller.

Replace `expense.example.com` in `k8s/04-ingress.yaml` with your real domain before deployment.
