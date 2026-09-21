# LISSA — Setup Guide (Blank Machine → Running System)

## Prerequisites — Install These First

| Tool | Version | Download |
|------|---------|----------|
| Docker Desktop | Latest | https://www.docker.com/products/docker-desktop |
| Git | Latest | https://git-scm.com/downloads |
| VS Code | Latest | https://code.visualstudio.com |
| Node.js | 18+ | https://nodejs.org (only needed if running frontend outside Docker) |

> After installing Docker Desktop, open it and make sure it shows "Engine running" in the bottom left.

---

## Day 1 Setup — Run This Once

### Step 1: Clone / open the project

```bash
# If starting from this zip, just open the folder in VS Code
# If using Git:
git clone https://github.com/YOUR-USERNAME/lissa.git
cd lissa
```

### Step 2: Create your .env file

```bash
# Windows (Command Prompt)
copy .env.example .env

# Windows (PowerShell) or Mac/Linux
cp .env.example .env
```

Open `.env` in VS Code and generate a real JWT secret:
```bash
# Run this in any Python terminal to get a secure secret:
python -c "import secrets; print(secrets.token_hex(32))"
```
Paste the output as the value of `JWT_SECRET` in `.env`.

### Step 3: Build and start all containers

```bash
docker compose up --build
```

First run takes 3–5 minutes (downloading images + installing packages).
You'll know it worked when you see:

```
✅ MongoDB connected
✅ Qdrant collection 'lissa_kb' created
✅ All connections established. LISSA is ready.
```

### Step 4: Seed the database (run ONCE, in a new terminal)

```bash
docker compose exec backend python scripts/seed_db.py
```

Expected output:
```
✅ Admin account created:
   Email    : admin@liceo.edu.ph
   Password : Admin@1234
✅ Demo student account created:
   Email    : student@liceo.edu.ph
   Password : Student@1234
✅ Database indexes created
🎉 Seed complete!
```

---

## Verify Everything Works

| URL | What you should see |
|-----|-------------------|
| http://localhost:3000 | LISSA login page |
| http://localhost:8000/docs | FastAPI Swagger UI |
| http://localhost:8000/health | `{"status": "ok"}` |
| http://localhost:6333/dashboard | Qdrant web dashboard |

Try logging in at http://localhost:3000 with `admin@liceo.edu.ph` / `Admin@1234`.

---

## Daily Development

```bash
# Start everything
docker compose up

# Stop everything
docker compose down

# Rebuild after changing requirements.txt or package.json
docker compose up --build

# View backend logs only
docker compose logs -f backend

# Run a command inside the backend container
docker compose exec backend python scripts/seed_db.py
```

---

## Project Structure

```
lissa/
├── docker-compose.yml      # All services defined here
├── .env                    # Your secrets (never commit this)
├── .env.example            # Template (safe to commit)
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt    # Python packages
│   └── app/
│       ├── main.py         # FastAPI entry point
│       ├── config.py       # All env var settings
│       ├── database.py     # MongoDB + Qdrant connections
│       ├── models/         # Pydantic schemas
│       ├── routers/        # Route handlers (auth.py, ...)
│       └── services/       # Business logic (auth_service.py, ...)
│
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── next.config.js      # Proxy rewrites to backend
    ├── tailwind.config.ts
    └── app/
        ├── layout.tsx      # Root layout
        ├── login/          # Login page
        ├── chat/           # Student chat (Week 3)
        └── admin/          # Admin panel (Week 3)
```

---

## Week-by-Week Build Plan

| Week | Focus | Branch |
|------|-------|--------|
| 1 | ✅ Infrastructure + Auth | `week-1-auth` |
| 2 | RAG pipeline (Qdrant + RoBERTa) | `week-2-pipeline` |
| 3 | Frontend UI + Admin panel + Knowledge Base | `week-3-ui` |
| 4 | Evaluation + Chapter IV & V | `week-4-eval` |

---

## Troubleshooting

**Docker Desktop not starting?**
Make sure WSL 2 is enabled: `wsl --install` in PowerShell as Administrator, then restart.

**Port 3000 already in use?**
Change `"3000:3000"` to `"3001:3000"` in docker-compose.yml and visit localhost:3001.

**MongoDB healthcheck keeps failing?**
Give it 30 seconds. If it still fails: `docker compose down -v` then `docker compose up --build`.

**`seed_db.py` says "Admin already exists"?**
That's fine — it means you already ran it. Your accounts are intact.
