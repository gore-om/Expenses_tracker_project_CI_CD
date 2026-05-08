# Ledgerly Expense Tracker

A polished full-stack expense tracker designed for end-to-end CI/CD practice with Jenkins, Docker, Azure Container Registry, Azure Kubernetes Service, NGINX Ingress, a custom domain and Let's Encrypt.

## What Makes It CI/CD Friendly

- Two deployable services: frontend and backend.
- Dockerfiles for both services.
- PostgreSQL-backed API with health and readiness endpoints.
- Login, profile preferences and user-scoped transaction data.
- Kubernetes manifests with services, probes, resource limits and ingress.
- Jenkinsfile that builds, pushes and deploys versioned images.
- Build metadata surfaced in the UI through the backend health endpoint.
- Version-driven release display through the root `VERSION` file.

## Run Locally

```bash
docker compose up --build
```

Open:

- Frontend: `http://localhost:3000`
- Backend health: `http://localhost:8080/health`

Create an account from the login screen, then use:

- Overview: financial metrics and category insights.
- Transactions: add and manage income/expense records.
- Profile: name, currency, monthly budget, savings goal, focus category, timezone and notification preferences.

## Production Notes

1. Create a managed PostgreSQL database.
2. Create the `ledgerly-secrets` Kubernetes secret in AKS.
3. Replace `expense.example.com` in `k8s/04-ingress.yaml`.
4. Configure Jenkins credentials listed in `docs/ARCHITECTURE.md`.
5. Connect your GitHub webhook to Jenkins.
6. Push to GitHub and watch the pipeline build, push and deploy.

## Testing The Webhook

Change the value in `VERSION`, commit it, and push to GitHub. The GitHub webhook should trigger Jenkins automatically. Jenkins exposes that clean version value in the app sidebar.

## Repository Layout

```text
frontend/       Static dashboard UI served by NGINX
backend/        Express API and PostgreSQL access
k8s/            AKS manifests for namespace, services, deployments and ingress
docs/           Architecture and deployment notes
Jenkinsfile     CI/CD pipeline
docker-compose.yml
```
