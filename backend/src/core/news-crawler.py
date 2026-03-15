#!/usr/bin/env python3
"""
AllClaw — News Intelligence Crawler
Uses Scrapling to fetch real financial news headlines.
Runs as a subprocess called by Node.js backend.

Output: JSON to stdout
  {
    "headlines": [...],
    "signals": { "bullish": [...], "bearish": [...] },
    "market_mood": "bullish" | "bearish" | "neutral",
    "mood_score": float (-1.0 to 1.0),
    "sources": [...]
  }

Called by: backend/src/core/news-engine.js
"""

import json
import sys
import re
from datetime import datetime

try:
    from scrapling.fetchers import Fetcher
    Fetcher.configure(auto_match=False)
except ImportError:
    print(json.dumps({"error": "scrapling not installed", "headlines": [], "mood_score": 0}))
    sys.exit(1)

# ── Keyword signals ────────────────────────────────────────────────
BULLISH_KEYWORDS = [
    "surge", "rally", "soar", "gain", "rise", "jump", "breakout",
    "record", "high", "bull", "buy", "strong", "growth", "up",
    "outperform", "beat", "exceed", "milestone", "adoption", "launch",
    "win", "profit", "approval", "halving", "etf", "institutional",
    "partnership", "upgrade", "hold",
]

BEARISH_KEYWORDS = [
    "crash", "drop", "fall", "plunge", "decline", "sell", "dump",
    "fear", "panic", "bear", "loss", "low", "weak", "down",
    "warning", "risk", "ban", "regulation", "hack", "exploit",
    "delay", "miss", "cut", "layoff", "recession", "inflation",
    "downgrade", "investigation", "lawsuit", "iran", "war", "tariff",
    "sanction", "collapse", "crisis",
]

AI_KEYWORDS = [
    "nvidia", "nvda", "ai", "artificial intelligence", "chatgpt",
    "openai", "anthropic", "gemini", "llm", "model", "gpu", "chip",
    "semiconductor", "deepseek", "llama", "compute", "datacenter",
]

CRYPTO_KEYWORDS = [
    "bitcoin", "btc", "ethereum", "eth", "crypto", "solana", "sol",
    "blockchain", "defi", "nft", "web3", "coinbase", "binance",
]

def score_headline(text):
    """Score a headline: positive = bullish, negative = bearish"""
    text_lower = text.lower()
    score = 0
    for kw in BULLISH_KEYWORDS:
        if kw in text_lower:
            score += 1
    for kw in BEARISH_KEYWORDS:
        if kw in text_lower:
            score -= 1.2  # bearish weighted slightly higher (fear > greed)
    return score

def categorize(text):
    """Determine if headline is about AI, crypto, or macro"""
    text_lower = text.lower()
    cats = []
    if any(kw in text_lower for kw in AI_KEYWORDS):
        cats.append("ai")
    if any(kw in text_lower for kw in CRYPTO_KEYWORDS):
        cats.append("crypto")
    if not cats:
        cats.append("macro")
    return cats

def fetch_coindesk():
    """Fetch crypto/AI market news from CoinDesk"""
    try:
        f = Fetcher()
        p = f.get('https://www.coindesk.com/markets', timeout=12)
        if p.status != 200:
            return []
        headlines = []
        for elem in p.css('h2'):
            text = elem.text.strip() if elem.text else ""
            if text and len(text) > 20 and len(text) < 200:
                headlines.append({
                    "title": text,
                    "source": "CoinDesk",
                    "url": "https://www.coindesk.com/markets",
                    "categories": categorize(text),
                    "score": score_headline(text),
                })
        return headlines[:10]
    except Exception as e:
        return []

def fetch_coindesk_news():
    """Fetch latest crypto news"""
    try:
        f = Fetcher()
        p = f.get('https://www.coindesk.com/latest-crypto-news', timeout=12)
        if p.status != 200:
            return []
        headlines = []
        for elem in p.css('h2,h3'):
            text = elem.text.strip() if elem.text else ""
            if text and len(text) > 20 and len(text) < 200:
                headlines.append({
                    "title": text,
                    "source": "CoinDesk Latest",
                    "url": "https://www.coindesk.com/latest-crypto-news",
                    "categories": categorize(text),
                    "score": score_headline(text),
                })
        return headlines[:8]
    except Exception as e:
        return []

def fetch_decrypt():
    """Fetch from Decrypt.co - crypto news"""
    try:
        f = Fetcher()
        p = f.get('https://decrypt.co/news', timeout=12)
        if p.status != 200:
            return []
        headlines = []
        for elem in p.css('h3,h2'):
            text = elem.text.strip() if elem.text else ""
            if text and len(text) > 20 and len(text) < 200:
                headlines.append({
                    "title": text,
                    "source": "Decrypt",
                    "url": "https://decrypt.co/news",
                    "categories": categorize(text),
                    "score": score_headline(text),
                })
        return headlines[:8]
    except Exception as e:
        return []

def fetch_techcrunch_ai():
    """Fetch TechCrunch AI news"""
    try:
        f = Fetcher()
        p = f.get('https://techcrunch.com/category/artificial-intelligence/', timeout=12)
        if p.status != 200:
            return []
        headlines = []
        for elem in p.css('h2,h3'):
            text = elem.text.strip() if elem.text else ""
            if text and len(text) > 20 and len(text) < 200:
                headlines.append({
                    "title": text,
                    "source": "TechCrunch AI",
                    "url": "https://techcrunch.com/category/artificial-intelligence/",
                    "categories": categorize(text),
                    "score": score_headline(text),
                })
        return headlines[:8]
    except Exception as e:
        return []

def main():
    all_headlines = []

    # Fetch from multiple sources
    sources_tried = []

    cd = fetch_coindesk()
    if cd:
        all_headlines.extend(cd)
        sources_tried.append("CoinDesk Markets")

    cdn = fetch_coindesk_news()
    if cdn:
        all_headlines.extend(cdn)
        sources_tried.append("CoinDesk Latest")

    dc = fetch_decrypt()
    if dc:
        all_headlines.extend(dc)
        sources_tried.append("Decrypt")

    tc = fetch_techcrunch_ai()
    if tc:
        all_headlines.extend(tc)
        sources_tried.append("TechCrunch AI")

    # Deduplicate by title similarity
    seen = set()
    unique = []
    for h in all_headlines:
        key = h["title"][:40].lower()
        if key not in seen:
            seen.add(key)
            unique.append(h)

    # Sort by absolute score (most impactful first)
    unique.sort(key=lambda x: abs(x["score"]), reverse=True)

    # Separate bullish / bearish
    bullish = [h for h in unique if h["score"] > 0][:5]
    bearish = [h for h in unique if h["score"] < 0][:5]
    neutral = [h for h in unique if h["score"] == 0][:3]

    # Compute overall mood score (-1 to +1)
    if unique:
        total_score = sum(h["score"] for h in unique)
        mood_score = max(-1.0, min(1.0, total_score / len(unique)))
    else:
        mood_score = 0.0

    if mood_score > 0.2:
        market_mood = "bullish"
    elif mood_score < -0.2:
        market_mood = "bearish"
    else:
        market_mood = "neutral"

    # AI-specific signal
    ai_headlines = [h for h in unique if "ai" in h["categories"]]
    ai_score = sum(h["score"] for h in ai_headlines) / max(len(ai_headlines), 1) if ai_headlines else 0

    crypto_headlines = [h for h in unique if "crypto" in h["categories"]]
    crypto_score = sum(h["score"] for h in crypto_headlines) / max(len(crypto_headlines), 1) if crypto_headlines else 0

    result = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "headlines": unique[:20],
        "signals": {
            "bullish": bullish,
            "bearish": bearish,
            "neutral": neutral,
        },
        "market_mood": market_mood,
        "mood_score": round(mood_score, 3),
        "ai_score": round(ai_score, 3),
        "crypto_score": round(crypto_score, 3),
        "total_headlines": len(unique),
        "sources": sources_tried,
    }

    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
