"""
LISSA Automated Evaluation Script
Week 4 — Day 22-23

Reads your ground_truth.csv, sends each question to LISSA,
then computes Exact Match and F1 scores — the same metrics used
in the SQuAD benchmark and referenced in your thesis methodology.

Usage (from project root in Git Bash):
    docker compose exec backend python scripts/evaluate.py

Output:
    - Prints a full results table to the terminal
    - Saves results to /app/evaluation_results.csv
    - Prints summary stats for Chapter IV Table
"""

import asyncio
import csv
import re
import sys
import os
import json
import httpx
from datetime import datetime
from collections import Counter

# ── Config ─────────────────────────────────────────────────────────────────────
GROUND_TRUTH_PATH = "/app/scripts/ground_truth.csv"
OUTPUT_PATH = "/app/evaluation_results.csv"
API_BASE = "http://localhost:8000"
ADMIN_EMAIL = "admin@liceo.edu.ph"
ADMIN_PASSWORD = "Admin@1234"


# ── SQuAD-style EM and F1 ──────────────────────────────────────────────────────
def normalize(text: str) -> str:
    """Lowercase, strip punctuation and extra whitespace."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def exact_match(prediction: str, ground_truth: str) -> int:
    return int(normalize(prediction) == normalize(ground_truth))


def f1_score(prediction: str, ground_truth: str) -> float:
    pred_tokens = normalize(prediction).split()
    truth_tokens = normalize(ground_truth).split()

    if not pred_tokens or not truth_tokens:
        return 0.0

    common = Counter(pred_tokens) & Counter(truth_tokens)
    num_common = sum(common.values())

    if num_common == 0:
        return 0.0

    precision = num_common / len(pred_tokens)
    recall = num_common / len(truth_tokens)
    f1 = (2 * precision * recall) / (precision + recall)
    return round(f1, 4)


# ── API helpers ────────────────────────────────────────────────────────────────
async def login(client: httpx.AsyncClient) -> str:
    res = await client.post(
        f"{API_BASE}/api/auth/login",
        json={"email_address": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    if res.status_code != 200:
        print(f"❌ Login failed: {res.text}")
        sys.exit(1)

    # Extract JWT from cookie
    cookie = res.headers.get("set-cookie", "")
    token = ""
    for part in cookie.split(";"):
        if "lissa_token=" in part:
            token = part.split("lissa_token=")[1].strip()
            break
    return token


async def ask_lissa(client: httpx.AsyncClient, token: str, question: str) -> dict:
    res = await client.post(
        f"{API_BASE}/api/query/",
        json={"question": question},
        cookies={"lissa_token": token},
    )
    if res.status_code == 200:
        return res.json()
    return {
        "answer": "",
        "confidence": 0.0,
        "confidence_label": "low",
        "source_filename": "",
        "escalated": True,
        "error": res.text,
    }


# ── Main evaluation loop ───────────────────────────────────────────────────────
async def evaluate():
    if not os.path.exists(GROUND_TRUTH_PATH):
        print(f"❌  Ground truth file not found at: {GROUND_TRUTH_PATH}")
        print("    Copy your filled ground_truth.csv into backend/scripts/")
        sys.exit(1)

    # Load ground truth
    with open(GROUND_TRUTH_PATH, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        qa_pairs = list(reader)

    print(f"📋 Loaded {len(qa_pairs)} question-answer pairs")
    print(f"🚀 Starting evaluation against LISSA...\n")

    async with httpx.AsyncClient(timeout=60.0) as client:
        token = await login(client)
        print(f"✅ Logged in as {ADMIN_EMAIL}\n")
        print("-" * 90)
        print(f"{'#':<4} {'Question':<45} {'EM':<4} {'F1':<6} {'Conf':<6} {'Esc'}")
        print("-" * 90)

        results = []
        total_em = 0
        total_f1 = 0.0
        total_conf = 0.0

        for i, row in enumerate(qa_pairs, 1):
            question = row["question"].strip()
            ground_truth = row["ground_truth_answer"].strip()

            # Skip unfilled template rows
            if ground_truth.startswith("REPLACE:"):
                print(f"{i:<4} SKIPPED (not filled in): {question[:50]}")
                continue

            response = await ask_lissa(client, token, question)
            predicted = response.get("answer", "")
            confidence = response.get("confidence", 0.0)
            escalated = response.get("escalated", True)

            em = exact_match(predicted, ground_truth)
            f1 = f1_score(predicted, ground_truth)

            total_em += em
            total_f1 += f1
            total_conf += confidence

            q_short = (question[:43] + "..") if len(question) > 45 else question
            esc_icon = "⚠" if escalated else "✓"

            print(
                f"{i:<4} {q_short:<45} {em:<4} {f1:<6.3f} "
                f"{confidence:<6.3f} {esc_icon}"
            )

            results.append({
                "question": question,
                "ground_truth_answer": ground_truth,
                "predicted_answer": predicted,
                "exact_match": em,
                "f1_score": f1,
                "confidence": confidence,
                "confidence_label": response.get("confidence_label", ""),
                "source_filename": response.get("source_filename", ""),
                "escalated": escalated,
                "category": row.get("category", ""),
                "evaluated_at": datetime.utcnow().isoformat(),
            })

            # Small delay to not overwhelm the backend
            await asyncio.sleep(0.5)

        # ── Summary stats ──────────────────────────────────────────────────────
        n = len(results)
        if n == 0:
            print("\n❌  No results computed. Check your ground truth CSV.")
            return

        avg_em   = total_em   / n
        avg_f1   = total_f1   / n
        avg_conf = total_conf / n
        escalated_count = sum(1 for r in results if r["escalated"])

        print("-" * 90)
        print(f"\n📊 EVALUATION SUMMARY ({n} questions)")
        print(f"{'─' * 50}")
        print(f"  Exact Match Score (EM)  : {avg_em:.4f}  ({avg_em*100:.1f}%)")
        print(f"  Average F1 Score        : {avg_f1:.4f}  ({avg_f1*100:.1f}%)")
        print(f"  Average Confidence      : {avg_conf:.4f}  ({avg_conf*100:.1f}%)")
        print(f"  Escalated (low conf)    : {escalated_count}/{n}  ({escalated_count/n*100:.1f}%)")
        print(f"{'─' * 50}")

        # Category breakdown
        categories = {}
        for r in results:
            cat = r["category"] or "uncategorized"
            if cat not in categories:
                categories[cat] = {"em": [], "f1": []}
            categories[cat]["em"].append(r["exact_match"])
            categories[cat]["f1"].append(r["f1_score"])

        if len(categories) > 1:
            print("\n  By category:")
            for cat, scores in sorted(categories.items()):
                cat_em = sum(scores["em"]) / len(scores["em"])
                cat_f1 = sum(scores["f1"]) / len(scores["f1"])
                print(f"    {cat:<20} EM={cat_em:.3f}  F1={cat_f1:.3f}  (n={len(scores['em'])})")

        # ── Save to CSV ────────────────────────────────────────────────────────
        fieldnames = list(results[0].keys())
        with open(OUTPUT_PATH, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(results)

        print(f"\n✅ Full results saved to: {OUTPUT_PATH}")
        print(f"   Copy this file to your laptop for Chapter IV tables.\n")

        # ── Chapter IV hint ────────────────────────────────────────────────────
        print("📝 CHAPTER IV TABLE VALUES TO REPORT:")
        print(f"   EM Score  = {avg_em:.4f}")
        print(f"   F1 Score  = {avg_f1:.4f}")
        print(f"   Avg Conf  = {avg_conf:.4f}")
        print(f"   Escalation Rate = {escalated_count/n:.4f}")


if __name__ == "__main__":
    asyncio.run(evaluate())
