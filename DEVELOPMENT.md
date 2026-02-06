# Development & Deployment Guide

## 🏗️ Architecture Overview

This project (`hacker-podcast`) uses a **dual Worker architecture** on Cloudflare:

```
┌───────────────────────────────────────────────────────────────┐
│                      Cloudflare Cloud                         │
├────────────────────────────┬──────────────────────────────────┤
│  hacker-podcast (Frontend) │  hacker-podcast-worker (Backend) │
│  OpenNext-based Next.js    │  Standalone Cloudflare Worker    │
│  Handles UI/page rendering │  Background tasks/cron/workflows │
└────────────────────────────┴──────────────────────────────────┘
           ▲                            ▲
           │                            │
     pnpm deploy                 pnpm deploy:worker
           │                            │
           ▼                            ▼
┌───────────────────────────────────────────────────────────────┐
│                     Local Development                         │
├────────────────────────────┬──────────────────────────────────┤
│  pnpm dev (Next.js)        │  pnpm dev:worker (Wrangler)      │
│  Edit app/components/etc   │  Edit worker/ directory          │
└────────────────────────────┴──────────────────────────────────┘
```

---

## 📦 Two Workers

| Worker                    | Config File             | Responsibilities                                                                                   |
| ------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| **hacker-podcast**        | Root `wrangler.jsonc`   | Frontend Next.js app via `@opennextjs/cloudflare` - page rendering, user interaction, R2/KV access |
| **hacker-podcast-worker** | `worker/wrangler.jsonc` | Backend - cron jobs, Workflows, Browser binding (Puppeteer)                                        |

---

## 🔧 Local Development vs Cloudflare Deployment

### Local Development Commands

| Command            | Purpose                                            |
| ------------------ | -------------------------------------------------- |
| `pnpm dev`         | Start Next.js dev server (frontend)                |
| `pnpm dev:worker`  | Start backend Worker local emulator (via Wrangler) |
| `pnpm logs:worker` | View real-time logs of deployed Worker             |

### Deployment Commands

| Command              | Purpose                                                 |
| -------------------- | ------------------------------------------------------- |
| `pnpm deploy`        | Build and deploy Next.js frontend to Cloudflare Workers |
| `pnpm deploy:worker` | Deploy backend Worker to Cloudflare                     |

---

## 🔄 Development Workflow

```
1. Modify code locally
   ├── Frontend (app/, components/) → pnpm dev to preview
   └── Backend Worker (worker/)     → pnpm dev:worker to test locally

2. Deploy after testing
   ├── pnpm deploy        → Deploy frontend to Cloudflare
   └── pnpm deploy:worker → Deploy backend Worker to Cloudflare
```

---

## ☁️ Shared Cloudflare Resources

Both Workers share these Cloudflare resources:

- **KV Store**: `HACKER_PODCAST_KV` (ID: `437fecc1...`)
- **R2 Bucket**: `hacker-podcast`

The backend Worker also has:

- **Browser binding**: For Puppeteer scraping
- **Workflows**: `HackerNewsWorkflow`
- **Cron trigger**: Runs daily at 23:30

---

## 🎯 Summary

| Question                        | Answer                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **What deploys to Cloudflare?** | Both Workers deploy to Cloudflare                                                                      |
| **What's developed locally?**   | Both Next.js frontend (`pnpm dev`) and Worker (`pnpm dev:worker`)                                      |
| **How do they relate?**         | Frontend handles UI; backend Worker handles cron/scraping/workflows; they communicate via shared KV/R2 |
