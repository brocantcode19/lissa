FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Step 1: Install CPU-only PyTorch first ────────────────────────────────────
# This prevents pip from downloading the 2.5 GB CUDA version by mistake.
# CPU torch is ~200 MB and perfectly fine for development.
RUN pip install torch==2.3.1 \
    --index-url https://download.pytorch.org/whl/cpu \
    --no-cache-dir

# ── Step 2: Install everything else ───────────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
