# Docker & Kubernetes Deployment Guide - WRMS Backend

This guide details how to build, run, and deploy the **WRMS Backend API** using Docker, Docker Compose, Kubernetes, NGINX Ingress, and GitHub Actions.

---

## 1. Local Docker Quick Start

Ensure you have a valid `.env` file in the root directory (see `.env.example`):

```bash
cp .env.example .env
docker compose up -d --build
```

Verify the server and MongoDB connection:

```bash
curl http://localhost:5000/api/health
docker compose logs -f
```

Stop the container:

```bash
docker compose down
```

### Pure Docker CLI

```bash
docker build -t wrms-backend .
docker run -d --name wrms-backend-api --env-file .env -p 5000:5000 wrms-backend
```

---

## 2. Kubernetes & NGINX Ingress Architecture

Requests flow from HTTPS through NGINX Ingress to the internal ClusterIP Service and across 2 load-balanced Node.js pods:

```text
HTTPS Client / WRMS.Agent
   │
   ▼
NGINX Ingress (k8s/04-ingress.yaml + TLS Secret, proxy-body-size: 10m)
   │
   ▼
ClusterIP Service (k8s/03-service.yaml :80 -> targetPort 5000)
   │
   ▼
Deployment Pods x2 (k8s/02-deployment.yaml, port 5000)
   ├─ Readiness: GET /api/health (HTTP 200 when MongoDB connected, else 503)
   ├─ Liveness:  GET /api/live   (HTTP 200 while Express event loop is healthy)
   └─ Env Vars:  Loaded from Secret 'wrms-backend-secrets'
```

Before deploying to your cluster:
1. Ingress in `k8s/04-ingress.yaml` is configured for `https://wrms-api.oru.link/api` (single-level subdomain compatible with `*.oru.link` wildcard DNS + TLS). Ensure `wrms-tls-secret` holds your `*.oru.link` certificate in namespace `wrms` (via `TLS_CRT`/`TLS_KEY` GitHub Secrets or `kubectl`).
2. Update `image` in `k8s/02-deployment.yaml` if your registry differs from `tangentcloud.azurecr.io` (GitHub Actions overrides this dynamically on every deploy).

### Manual `kubectl` Deploy (Optional)

```bash
kubectl apply -f k8s/01-namespace.yaml

# Create runtime secrets (never commit real secrets to Git)
kubectl create secret generic wrms-backend-secrets -n wrms \
  --from-literal=MONGODB_URI="mongodb+srv://..." \
  --from-literal=JWT_SECRET="your-strong-random-secret" \
  --from-literal=CLIENT_URL="*"

# Create TLS certificate secret if not managed by cert-manager
kubectl create secret tls wrms-tls-secret -n wrms \
  --cert=/path/to/fullchain.pem \
  --key=/path/to/privkey.pem

kubectl apply -f k8s/02-deployment.yaml
kubectl apply -f k8s/03-service.yaml
kubectl apply -f k8s/04-ingress.yaml
```

---

## 3. GitHub Actions CI/CD Configuration

Configure these **Variables** and **Secrets** in your GitHub Repository (`Settings -> Secrets and variables -> Actions`):

### Repository Variables
| Name | Example Value | Description |
|---|---|---|
| `REGISTRY_URL` | `tangentcloud.azurecr.io` | Container registry host |
| `CLIENT_URL` | `*` or `https://wrms.oru.link` | Allowed CORS origins (comma-separated) |

### Repository Secrets
| Name | Required | Description |
|---|---|---|
| `REGISTRY_USERNAME` | Yes | Container registry username |
| `REGISTRY_PASSWORD` | Yes | Container registry password/token |
| `DO_KUBE_CONFIG` | Yes | Base64-encoded `~/.kube/config` for the cluster |
| `MONGODB_URI` | Yes | MongoDB Atlas / cluster connection string |
| `JWT_SECRET` | Recommended | Strong random secret shared across all pod replicas |
| `TLS_CRT` | Optional | Base64-encoded TLS certificate (if not using `cert-manager` or pre-created `wrms-tls-secret`) |
| `TLS_KEY` | Optional | Base64-encoded TLS private key |

---

## 4. Connect Frontend & Windows Agents

Once `https://wrms-api.oru.link/api/health` returns `{"status":"ok","database":{"connected":true}}`:
- Set `VITE_API_URL=https://wrms-api.oru.link` in `WRMS-Frontend` environment settings (frontend appends `/api` automatically).
- Set `"ApiBaseUrl": "https://wrms-api.oru.link"` in `WRMS.Agent/appsettings.json` (and update `BackendServerUrl` in `WRMS.Installer/MainForm.cs` before publishing installer).
