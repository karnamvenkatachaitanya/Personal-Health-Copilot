<div align="center">

# 🚀 Deployment Guide

### Personal Health Copilot

[![Vercel + Render](https://img.shields.io/badge/Option_A-Vercel_+_Render-000?style=for-the-badge&logo=vercel)](https://vercel.com)
[![All Render](https://img.shields.io/badge/Option_B-All_Render-46E3B7?style=for-the-badge)](https://render.com)
[![AWS](https://img.shields.io/badge/Option_C-AWS_App_Runner_+_Amplify-FF9900?style=for-the-badge&logo=amazonaws)](https://aws.amazon.com)

</div>

---

## Architecture Overview

The app is two services plus Supabase (already hosted — project `health-copilot-india`, Mumbai `ap-south-1`):

| Component | Technology | Deployment Target |
|---|---|---|
| `backend/` | FastAPI + Uvicorn, Python 3.12 | Render, AWS App Runner, or any Docker host |
| `frontend/` | Next.js 15 App Router | Vercel, Render, or AWS Amplify |
| Supabase | Postgres + Auth + Storage bucket `documents` | Already live — nothing to deploy |

> **Pick a host, then complete the Supabase steps in [Section 5](#5-supabase-settings).** Every option below works on free tiers for a demo.

---

## 1. Environment Variables

> ⚠️ **Never commit these.** `backend/.env.example` lists all backend names.

### Backend Variables

| Variable | Value | Notes |
|---|---|---|
| `GROQ_API_KEY` | Groq key | Qwen text + Whisper |
| `GEMINI_API_KEY` | Google AI Studio key | Vision OCR |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` | |
| `SUPABASE_KEY` | `sb_secret_…` service key | **Server only** — bypasses RLS |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | |
| `SUPABASE_JWKS_URL` | `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` | |
| `FRONTEND_ORIGIN` | Public frontend URL | Comma-separate multiple origins. Used for CORS |
| `HOST` / `PORT` | `0.0.0.0` / auto | Render and App Runner set `PORT` themselves |
| `MCP_DATA_DIR` | A writable folder, e.g. `/var/lib/health-copilot` | Where ChatGPT/MCP access tokens, policies and their audit trail are stored (file readable only by the app user). Defaults to `backend/data`. Run **one** backend instance until this moves into the database |

Get Supabase keys via CLI or Dashboard → Project Settings → API Keys:

```bash
supabase projects api-keys --project-ref <project-ref> --reveal
```

### Frontend Variables

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | Backend URL **with** prefix | e.g. `https://health-copilot-api.onrender.com/api/v1` |
| `NEXT_PUBLIC_SUPABASE_URL` | Same as `SUPABASE_URL` | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same as `SUPABASE_PUBLISHABLE_KEY` | Safe in browser |
| `NEXT_PUBLIC_SITE_URL` | Public frontend URL | Used for Open Graph links |

> **Deploy order**: Backend first → Frontend → then set `FRONTEND_ORIGIN` on the backend to match the frontend URL.

---

## 2. Option A: Vercel + Render *(Recommended for Quick Managed Setup)*

### Backend on Render

1. **Render Dashboard** → New → Web Service → connect the GitHub repo
2. Configure:

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Python |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` |
| Region | Singapore (closest to Mumbai Supabase) |
| Environment | `PYTHON_VERSION=3.12.7` + all backend variables. Set `FRONTEND_ORIGIN=http://localhost:3000` temporarily |

3. Deploy. Verify: `https://<service>.onrender.com/health` → should return `{"status":"ok","vision":true,"language_model":true}`. A `false` means that API key is missing.

**Alternative — Blueprint deployment**: commit this `render.yaml` at the repo root:

```yaml
services:
  - type: web
    name: health-copilot-api
    runtime: python
    rootDir: backend
    region: singapore
    plan: free
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /health
    envVars:
      - key: PYTHON_VERSION
        value: 3.12.7
      - key: GROQ_API_KEY
        sync: false
      - key: GEMINI_API_KEY
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_KEY
        sync: false
      - key: SUPABASE_PUBLISHABLE_KEY
        sync: false
      - key: SUPABASE_JWKS_URL
        sync: false
      - key: FRONTEND_ORIGIN
        sync: false
```

`sync: false` means Render asks you for the value in the dashboard instead of reading it from git.

> ⚠️ **Free-tier warning**: Render free services sleep after 15 minutes idle and take ~50 seconds to wake. Before a live demo, open the `/health` URL a minute early, or move to the Starter plan for the day.

### Frontend on Vercel

1. **Vercel** → Add New → Project → import the repo
2. **Root Directory**: `frontend` (Next.js detected automatically)
3. **Environment Variables**: the four frontend variables from Section 1. Set `NEXT_PUBLIC_BACKEND_URL` to the Render URL + `/api/v1`
4. Deploy

### Wire Them Together

1. **Render** → backend service → Environment → set `FRONTEND_ORIGIN` to the Vercel URL (e.g. `https://health-copilot.vercel.app`). Add preview domains comma-separated. Save → Render redeploys.
2. Complete [Section 5: Supabase Settings](#5-supabase-settings).

---

## 3. Option B: Everything on Render

Backend: exactly as in Option A. Add a **second Web Service** for the frontend:

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Runtime | Node |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm run start` (Next.js reads Render's `PORT` automatically) |
| Environment | The four frontend variables; `NEXT_PUBLIC_BACKEND_URL` is the backend's `.onrender.com` URL + `/api/v1` |

> `NEXT_PUBLIC_*` values are baked in at build time, so changing one needs a **redeploy**, not just a restart.

---

## 4. Option C: AWS

Use region **ap-south-1 (Mumbai)** so the backend sits next to Supabase.

### Backend on App Runner (Container)

Add `backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Build, push to ECR, create the service:

```bash
AWS_REGION=ap-south-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws ecr create-repository --repository-name health-copilot-api --region $AWS_REGION
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com
docker build --platform linux/amd64 -t health-copilot-api backend
docker tag health-copilot-api:latest $ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/health-copilot-api:latest
docker push $ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/health-copilot-api:latest
```

Then: **App Runner console** → Create service → Source: Container registry → Port `8000` → Environment: all backend variables → Health check: `/health` → Create.

The App Runner URL + `/api/v1` becomes the frontend's `NEXT_PUBLIC_BACKEND_URL`.

> Minimum configuration (1 vCPU, 2 GB) is sufficient. App Runner does not sleep — no cold start.

**EC2 alternative**: A `t3.small` Ubuntu instance with Docker, `docker run -d --env-file .env -p 80:8000 health-copilot-api`, with a security group open on 80/443. Put Caddy or an ALB in front for TLS (browsers block mixed content on HTTPS frontends).

### Frontend on Amplify Hosting

1. **Amplify console** → New app → Host web app → GitHub → pick the repo and `main`
2. Set **monorepo root** to `frontend`. Amplify detects Next.js SSR.
3. **Environment variables**: the four frontend variables
4. Deploy. Then set `FRONTEND_ORIGIN` on App Runner to the `https://main.….amplifyapp.com` URL and redeploy it.

> Mixing Vercel (frontend) with App Runner (backend) is also fine — only the URLs change.

---

## 5. Supabase Settings

Only **one setting** needs to change. The project is otherwise ready.

### Required Change

**Auth → URL Configuration:**
- Change **Site URL** from `http://localhost:3010` to the public frontend URL
- Add `https://<frontend>/**` to **Redirect URLs**

This only affects links inside auth emails (password reset, magic links). Sign-in and sign-up work before you do it, but do it anyway.

### Schema

The original tables are applied. **The care plan (reminders, follow-ups, repeat tests) adds two tables in `supabase/migrations/20261024120000_care_plan.sql`; apply it with `supabase db push` before deploying the backend that uses it.** Until then the Care plan tab still works, computed live from the records, but taken / snooze / edit cannot be saved.

If deploying to a fresh project:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

This creates the tables, RLS policies, and the private `documents` bucket.

### Keys

The service key (`SUPABASE_KEY`) is only ever set on the backend host. The browser only sees the publishable key.

### Things You Do NOT Need to Touch

| Setting | Status | Why |
|---|---|---|
| IP Allowlist | Open (`0.0.0.0/0`) | Any host can reach the database |
| Email Confirmation | Auto-confirm ON | Judges sign up and log in immediately |
| Storage CORS | Not needed | Files served via signed URLs from the backend |
| Row-Level Security | Applied via migrations | Already enforced |

> **Email limit**: Supabase sends at most 2 emails/hour. Sign-up doesn't trigger one, but password reset does — avoid reset during the demo. For more, add a custom SMTP provider under Auth → SMTP Settings.

> **Demo account**: A demo user with the sample Kumar family exists in Auth → Users. Login shared privately, never in the repo. Change its password in Auth → Users before the link goes public.

---

## 6. Post-Deploy Checklist

- [ ] `GET https://<backend>/health` returns `{"status":"ok","vision":true,"language_model":true}`
- [ ] Frontend loads, sign in works, upload a sample from `docs/sample-documents/`
- [ ] No CORS errors in browser console (if present, `FRONTEND_ORIGIN` doesn't match the frontend URL exactly)
- [ ] Document previews load (if not, check `SUPABASE_URL` and `SUPABASE_KEY`)
- [ ] **Model quotas**: Gemini free tier limits vision requests/day; Groq caps tokens/minute. Use paid tier before a demo, or uploads fall back to lower-quality models
- [ ] **Rotate any key** that was ever pasted in a chat, ticket, or screenshot before sharing with judges
- [ ] Upload limit is 15 MB per file. If using Cloudflare or an ALB in front, raise its body limit too

---

<div align="center">

*Personal Health Copilot · Cloud Deployment Guide*

</div>
