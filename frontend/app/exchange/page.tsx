"use client";
/**
 * AllClaw - Agent Stock Exchange v5
 *
 * Design principle: Show real AI behaviour, not a framework.
 * Every trade is real. Every price move has a cause.
 * Humans must be able to SEE the AI making decisions.
 *
 * v5 changes:
 *  - Fix: buy endpoint → POST /api/v1/exchange/buy (human-facing)
 *  - Fix: add Sell button + POST /api/v1/exchange/sell
 *  - Feat: rich portfolio (value, avg_cost, unrealized P&L, 24h%, per-position sell)
 *  - Feat: WS price_update refreshes portfolio current price
 *  - Feat: HIP balance display after handle set
 *  - UI: agent list search filter
 *  - UI: buy/sell toast notification (bottom-right, 1.5s auto-dismiss)
 *  - UI: CandleChart first/last time labels (HH:MM)
 */
import { useState, useEffect, useRef } from "react";
import Link from "next/link";

const API    = process.env.NEXT_PUBLIC_API_URL || "";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "wss://allclaw.io";

// ── Helpers ───────────────────────────────────────────────────────
function fmt(n: any, d = 2) { const v = parseFloat(n); return isNaN(v) ? "-" : v.toFixed(d); }
function fmtK(n: number) {
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n/1_000).toFixed(1)}K`;
  return n.toFixed(0);
}
function pctColor(v: number) { return v > 0 ? "#4ade80" : v < 0 ? "#f87171" : "#94a3b8"; }
function timeAgo(ts: string) {
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  return `${Math.floor(d/3600)}h ago`;
}

// ─── Candlestick SVG chart ────────────────────────────────────────
function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
}

function CandleChart({ candles, color }: { candles: any[], color: string }) {
  if (!candles.length) return (
    <div style={{ height:160, display:"flex", alignItems:"center", justifyContent:"center",
      color:"rgba(255,255,255,0.15)", fontSize:12 }}>Loading chart...</div>
  );
  const W=480, H=140, PAD=8;
  const prices = candles.flatMap(c=>[c.high,c.low]);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  const y = (p: number) => PAD + (1-(p-minP)/range)*(H-2*PAD);
  const cw = Math.floor((W-PAD*2)/candles.length) - 1;
  const firstTs = candles[0]?.ts;
  const lastTs  = candles[candles.length-1]?.ts;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:H }}>
        <defs>
          <linearGradient id="cg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.15"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {/* Area fill */}
        <path d={[
          `M ${PAD} ${H-PAD}`,
          ...candles.map((c,i)=>`L ${PAD+i*(cw+1)+cw/2} ${y(c.close)}`),
          `L ${PAD+(candles.length-1)*(cw+1)+cw/2} ${H-PAD}`, "Z"
        ].join(" ")} fill="url(#cg)"/>
        {candles.map((c,i)=>{
          const x  = PAD + i*(cw+1);
          const rise = c.close >= c.open;
          const col  = rise ? "#4ade80":"#f87171";
          const top  = Math.min(y(c.open),y(c.close));
          const bot  = Math.max(y(c.open),y(c.close));
          const bodyH= Math.max(1,bot-top);
          return (
            <g key={i}>
              <line x1={x+cw/2} y1={y(c.high)} x2={x+cw/2} y2={y(c.low)}
                stroke={col} strokeWidth="0.8" opacity="0.6"/>
              <rect x={x} y={top} width={cw} height={bodyH}
                fill={rise?"rgba(74,222,128,0.85)":"rgba(248,113,113,0.85)"}
                rx="0.5"/>
            </g>
          );
        })}
        {/* Last price line */}
        <line x1="0" y1={y(candles[candles.length-1]?.close||0)}
          x2={W} y2={y(candles[candles.length-1]?.close||0)}
          stroke={color} strokeWidth="0.7" strokeDasharray="3 2" opacity="0.5"/>
      </svg>
      {/* Time axis labels */}
      {firstTs && lastTs && (
        <div style={{ display:"flex", justifyContent:"space-between",
          fontSize:9, color:"rgba(255,255,255,0.2)",
          fontFamily:"JetBrains Mono,monospace", marginTop:2, padding:"0 4px" }}>
          <span>{fmtTime(firstTs)}</span>
          <span>{fmtTime(Math.floor((firstTs+lastTs)/2))}</span>
          <span>{fmtTime(lastTs)}</span>
        </div>
      )}
    </div>
  );
}

// ─── AI Ticker strip ─────────────────────────────────────────────
function AITicker({ listings }: { listings: any[] }) {
  const items = [...listings, ...listings];
  return (
    <div style={{ overflow:"hidden", background:"rgba(0,229,255,0.04)",
      borderBottom:"1px solid rgba(0,229,255,0.08)", padding:"5px 0" }}>
      <div style={{ display:"flex", whiteSpace:"nowrap",
        animation:"ticker-scroll 45s linear infinite", willChange:"transform" }}>
        {/* Label */}
        <div style={{ position:"sticky", left:0, zIndex:2,
          background:"rgba(9,9,18,0.9)", paddingLeft:14, paddingRight:20,
          display:"inline-flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <span style={{ width:5,height:5,borderRadius:"50%",background:"#00e5ff",
            boxShadow:"0 0 6px #00e5ff", display:"inline-block",
            animation:"pulse-icon 1.5s ease-in-out infinite alternate" }}/>
          <span style={{ fontSize:8,fontWeight:900,letterSpacing:"0.18em",
            color:"#00e5ff",fontFamily:"JetBrains Mono,monospace",textTransform:"uppercase" }}>
            AI ASX
          </span>
        </div>
        {items.map((l: any, i: number) => {
          const chg = parseFloat(l.change_pct)||0;
          return (
            <span key={i} style={{ display:"inline-flex", alignItems:"center", gap:5,
              padding:"0 14px", fontSize:10, fontFamily:"JetBrains Mono,monospace",
              borderRight:"1px solid rgba(255,255,255,0.05)" }}>
              {l.is_online && <span style={{ width:4,height:4,borderRadius:"50%",
                background:"#34d399",boxShadow:"0 0 4px #34d399",display:"inline-block" }}/>}
              <span style={{ color:"rgba(255,255,255,0.5)" }}>{l.name}</span>
              <span style={{ color:"white",fontWeight:800 }}>{fmt(l.price)}</span>
              <span style={{ color:pctColor(chg),fontWeight:700 }}>
                {chg===0?"-":`${chg>0?"+":""}${chg.toFixed(2)}%`}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── Real market ticker ──────────────────────────────────────────
function RealTicker({ prices, signal }: { prices: any[], signal: any }) {
  if (!prices.length) return null;
  const items = [...prices, ...prices];
  return (
    <div style={{ overflow:"hidden", background:"rgba(251,191,36,0.03)",
      borderBottom:"1px solid rgba(251,191,36,0.1)", padding:"5px 0" }}>
      <div style={{ display:"flex", whiteSpace:"nowrap",
        animation:"ticker-scroll 60s linear infinite", willChange:"transform" }}>
        {/* Label + signal */}
        <div style={{ position:"sticky", left:0, zIndex:2,
          background:"rgba(9,9,18,0.9)", paddingLeft:14, paddingRight:16,
          display:"inline-flex", alignItems:"center", gap:8, flexShrink:0 }}>
          <span style={{ fontSize:8,fontWeight:900,letterSpacing:"0.16em",
            color:"rgba(251,191,36,0.7)",fontFamily:"JetBrains Mono,monospace",
            textTransform:"uppercase" }}>🌍 REAL</span>
          {signal && (
            <span style={{ fontSize:8,fontWeight:800,padding:"1px 6px",borderRadius:4,
              background:`${signal.color}20`,color:signal.color,
              fontFamily:"JetBrains Mono,monospace",border:`1px solid ${signal.color}30` }}>
              {signal.label}
            </span>
          )}
        </div>
        {items.map((p: any, i: number) => {
          const chg = parseFloat(p.change_pct)||0;
          const isCrypto = p.symbol.includes("-");
          const priceStr = isCrypto
            ? parseFloat(p.price).toLocaleString(undefined,{maximumFractionDigits:0})
            : parseFloat(p.price).toFixed(2);
          return (
            <span key={i} style={{ display:"inline-flex",alignItems:"center",gap:5,
              padding:"0 13px",fontSize:10,fontFamily:"JetBrains Mono,monospace",
              borderRight:"1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ fontSize:11 }}>{p.icon}</span>
              <span style={{ color:"rgba(255,255,255,0.5)" }}>{p.symbol}</span>
              <span style={{ color:"white",fontWeight:800 }}>{priceStr}</span>
              <span style={{ color:pctColor(chg),fontWeight:700 }}>
                {chg===0?"-":`${chg>0?"+":""}${chg.toFixed(2)}%`}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── News Intelligence Panel ─────────────────────────────────────
function NewsPulse() {
  const [news, setNews] = useState<any>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch(`${API}/api/v1/news/latest`).then(r=>r.json())
        .then(d => setNews(d)).catch(()=>{});
    load();
    const t = window.setInterval(load, 5 * 60 * 1000);
    return () => window.clearInterval(t);
  }, []);

  if (!news || !news.headlines?.length) return null;

  const moodColor = news.market_mood === "bullish" ? "#4ade80"
                  : news.market_mood === "bearish"  ? "#f87171"
                  : "#fbbf24";
  const moodIcon  = news.market_mood === "bullish" ? "📈"
                  : news.market_mood === "bearish"  ? "📉" : "⚖️";

  return (
    <div style={{
      background:`linear-gradient(135deg, ${moodColor}08 0%, transparent 50%)`,
      border:`1px solid ${moodColor}20`,
      borderRadius:14, overflow:"hidden",
    }}>
      {/* Header */}
      <div onClick={() => setExpanded(e=>!e)}
        style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"12px 18px", cursor:"pointer" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:9, fontWeight:900, letterSpacing:"0.18em",
            textTransform:"uppercase" as const, color:moodColor,
            fontFamily:"JetBrains Mono,monospace" }}>
            📰 NEWS INTELLIGENCE
          </span>
          <span style={{ fontSize:9, padding:"2px 8px", borderRadius:4,
            background:`${moodColor}15`, color:moodColor, fontWeight:800,
            fontFamily:"JetBrains Mono,monospace",
            border:`1px solid ${moodColor}25` }}>
            {moodIcon} {news.market_mood?.toUpperCase()}
          </span>
          <span style={{ fontSize:9, color:"rgba(255,255,255,0.3)",
            fontFamily:"JetBrains Mono,monospace" }}>
            {news.total_headlines} headlines · {news.sources?.join(" · ")}
          </span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          {[
            {l:"Overall", v:news.mood_score,   c:"rgba(255,255,255,0.6)"},
            {l:"AI",      v:news.ai_score,     c:"#00e5ff"},
            {l:"Crypto",  v:news.crypto_score, c:"#f97316"},
          ].map(s=>(
            <div key={s.l} style={{ textAlign:"right" as const }}>
              <span style={{ fontSize:12, fontWeight:900,
                fontFamily:"JetBrains Mono,monospace",
                color: parseFloat(s.v)>0?"#4ade80":parseFloat(s.v)<0?"#f87171":s.c }}>
                {parseFloat(s.v||0)>0?"+":""}{parseFloat(s.v||0).toFixed(2)}
              </span>
              <span style={{ fontSize:8, color:"rgba(255,255,255,0.25)",
                marginLeft:3, textTransform:"uppercase" as const }}>{s.l}</span>
            </div>
          ))}
          <span style={{ fontSize:11, color:"rgba(255,255,255,0.25)" }}>
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {/* Expanded headlines */}
      {expanded && (
        <div style={{ borderTop:`1px solid ${moodColor}15`, padding:"12px 18px" }}>
          <div style={{ display:"flex", gap:12, flexWrap:"wrap" as const }}>
            {/* Bearish */}
            <div style={{ flex:1, minWidth:200 }}>
              <div style={{ fontSize:8, fontWeight:800, letterSpacing:"0.14em",
                color:"rgba(248,113,113,0.7)", fontFamily:"JetBrains Mono,monospace",
                marginBottom:8, textTransform:"uppercase" as const }}>
                📉 Bearish Signals ({news.signals?.bearish?.length||0})
              </div>
              {(news.signals?.bearish||[]).slice(0,4).map((h:any,i:number)=>(
                <div key={i} style={{ marginBottom:6, paddingBottom:6,
                  borderBottom:"1px solid rgba(248,113,113,0.08)" }}>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.65)", lineHeight:1.4 }}>
                    {h.title?.slice(0,85)}{h.title?.length>85?"...":""}
                  </div>
                  <div style={{ fontSize:8, color:"rgba(248,113,113,0.5)", marginTop:2,
                    fontFamily:"JetBrains Mono,monospace" }}>
                    {h.source} · score {h.score?.toFixed(1)}
                    {h.categories?.includes("ai") && " · 🤖AI"}
                    {h.categories?.includes("crypto") && " · ₿Crypto"}
                  </div>
                </div>
              ))}
            </div>
            {/* Bullish */}
            <div style={{ flex:1, minWidth:200 }}>
              <div style={{ fontSize:8, fontWeight:800, letterSpacing:"0.14em",
                color:"rgba(74,222,128,0.7)", fontFamily:"JetBrains Mono,monospace",
                marginBottom:8, textTransform:"uppercase" as const }}>
                📈 Bullish Signals ({news.signals?.bullish?.length||0})
              </div>
              {(news.signals?.bullish||[]).slice(0,4).map((h:any,i:number)=>(
                <div key={i} style={{ marginBottom:6, paddingBottom:6,
                  borderBottom:"1px solid rgba(74,222,128,0.08)" }}>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.65)", lineHeight:1.4 }}>
                    {h.title?.slice(0,85)}{h.title?.length>85?"...":""}
                  </div>
                  <div style={{ fontSize:8, color:"rgba(74,222,128,0.5)", marginTop:2,
                    fontFamily:"JetBrains Mono,monospace" }}>
                    {h.source} · score +{h.score?.toFixed(1)}
                    {h.categories?.includes("ai") && " · 🤖AI"}
                    {h.categories?.includes("crypto") && " · ₿Crypto"}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop:8, fontSize:9, color:"rgba(255,255,255,0.2)",
            fontFamily:"JetBrains Mono,monospace", textAlign:"right" as const }}>
            AIs are reacting to this news in real-time · updated every 5 min
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Market Signal Banner ─────────────────────────────────────────
function SignalBanner({ signal }: { signal: any }) {
  if (!signal || !signal.label || signal.label === "Unknown") return null;
  const isUp = signal.signal > 0;
  const ICON = signal.signal > 1.5 ? "🚀" : signal.signal > 0.5 ? "📈"
             : signal.signal < -1.5 ? "💥" : signal.signal < -0.5 ? "📉" : "⚖️";
  return (
    <div style={{
      background:`linear-gradient(135deg, ${signal.color}10 0%, transparent 60%)`,
      border:`1px solid ${signal.color}25`,
      borderRadius:14, padding:"14px 20px",
      display:"flex", alignItems:"center", justifyContent:"space-between",
      gap:16, flexWrap:"wrap",
    }}>
      {/* Left: signal name */}
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <span style={{ fontSize:"1.8rem" }}>{ICON}</span>
        <div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)",
            fontFamily:"JetBrains Mono,monospace", letterSpacing:"0.12em",
            textTransform:"uppercase", marginBottom:2 }}>
            Market Sentiment
          </div>
          <div style={{ fontSize:"1.4rem", fontWeight:900, color:signal.color,
            letterSpacing:"-0.02em" }}>
            {signal.label}
          </div>
        </div>
      </div>

      {/* Center: breakdown */}
      <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
        {[
          { sym:"SPY", v:signal.spy,  icon:"📊" },
          { sym:"NVDA", v:signal.nvda, icon:"🎮" },
          { sym:"BTC",  v:signal.btc,  icon:"₿"  },
          { sym:"QQQ",  v:signal.qqq,  icon:"🖥"  },
        ].map(s => (
          <div key={s.sym} style={{ textAlign:"center" }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)",
              fontFamily:"JetBrains Mono,monospace", marginBottom:2 }}>
              {s.icon} {s.sym}
            </div>
            <div style={{ fontSize:14, fontWeight:900,
              fontFamily:"JetBrains Mono,monospace",
              color: s.v > 0 ? "#4ade80" : s.v < 0 ? "#f87171" : "#94a3b8" }}>
              {s.v > 0 ? "+" : ""}{(s.v||0).toFixed(2)}%
            </div>
          </div>
        ))}
      </div>

      {/* Right: composite */}
      <div style={{ textAlign:"right" }}>
        <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)",
          fontFamily:"JetBrains Mono,monospace", marginBottom:2 }}>
          AI TRADE SIGNAL
        </div>
        <div style={{ fontSize:"2rem", fontWeight:900,
          fontFamily:"JetBrains Mono,monospace", color:signal.color,
          lineHeight:1 }}>
          {signal.signal > 0 ? "+" : ""}{parseFloat(signal.signal).toFixed(2)}
        </div>
        <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", marginTop:3 }}>
          AIs are {signal.signal > 0 ? "BUYING" : "SELLING"}
        </div>
      </div>
    </div>
  );
}

// ─── Live Trade Row ───────────────────────────────────────────────
function TradeRow({ trade, fresh }: { trade: any, fresh: boolean }) {
  // Special: news event row
  if (trade.is_news) {
    const moodColor = trade.mood === "bullish" ? "#4ade80"
                    : trade.mood === "bearish"  ? "#f87171" : "#fbbf24";
    return (
      <div style={{
        padding:"8px 16px",
        borderBottom:"1px solid rgba(255,255,255,0.03)",
        background: fresh ? `${moodColor}08` : "rgba(251,191,36,0.03)",
        animation: fresh ? "fadeInUp 0.3s ease" : "none",
        display:"flex", alignItems:"center", gap:12,
      }}>
        <span style={{ fontSize:9, fontWeight:900, padding:"3px 8px", borderRadius:5,
          background:`${moodColor}15`, color:moodColor, flexShrink:0,
          border:`1px solid ${moodColor}25`,
          fontFamily:"JetBrains Mono,monospace" }}>📰 NEWS</span>
        <div style={{ flex:1, overflow:"hidden" }}>
          <span style={{ fontSize:10, color:moodColor, fontWeight:700 }}>
            {trade.buyer_name}
          </span>
          <span style={{ fontSize:10, color:"rgba(255,255,255,0.5)", marginLeft:6 }}>
            {trade.target_name}
          </span>
        </div>
        <span style={{ fontSize:9, color:moodColor, fontWeight:800,
          fontFamily:"JetBrains Mono,monospace", flexShrink:0 }}>
          {trade.mood?.toUpperCase()} {trade.mood_score > 0 ? "+" : ""}{parseFloat(trade.mood_score||0).toFixed(2)}
        </span>
        <span style={{ fontSize:9, color:"rgba(255,255,255,0.2)",
          fontFamily:"JetBrains Mono,monospace", flexShrink:0 }}>just now</span>
      </div>
    );
  }

  const isBuy  = trade.trade_type === "buy";
  const chg    = parseFloat(trade.price_change_pct)||0;
  const REASON_LABEL: Record<string,string> = {
    battle_win:  "⚔️ Battle Win",
    battle_loss: "💀 Battle Loss",
    market_bull: "📈 Bull Signal",
    market_bear: "📉 Bear Signal",
    momentum:    "⚡ Momentum",
    arbitrage:   "🔄 Arbitrage",
    rebalance:   "⚖️ Rebalance",
    speculation: "🎰 Speculation",
    hedge:       "🛡 Hedge",
    buy:         "🟢 Buy",
    sell:        "🔴 Sell",
  };

  return (
    <div style={{
      display:"grid",
      gridTemplateColumns:"56px 1fr 1fr 80px 70px 60px 70px",
      gap:8, alignItems:"center",
      padding:"7px 16px",
      borderBottom:"1px solid rgba(255,255,255,0.03)",
      background: fresh ? (isBuy?"rgba(74,222,128,0.05)":"rgba(248,113,113,0.05)") : "transparent",
      animation: fresh ? "fadeInUp 0.3s ease" : "none",
      transition:"background 1s ease",
    }}>
      {/* Action badge */}
      <span style={{ fontSize:9, fontWeight:900, padding:"3px 8px", borderRadius:5,
        background: isBuy?"rgba(74,222,128,0.12)":"rgba(248,113,113,0.12)",
        color: isBuy?"#4ade80":"#f87171",
        fontFamily:"JetBrains Mono,monospace",
        border:`1px solid ${isBuy?"rgba(74,222,128,0.2)":"rgba(248,113,113,0.2)"}`,
        textAlign:"center" as const }}>
        {isBuy?"BUY":"SELL"}
      </span>

      {/* Buyer */}
      <div style={{ overflow:"hidden" }}>
        <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.7)",
          textOverflow:"ellipsis", overflow:"hidden", whiteSpace:"nowrap" }}>
          {trade.buyer_name || "AI Bot"}
        </div>
        <div style={{ fontSize:8, color:"rgba(255,255,255,0.25)" }}>buyer</div>
      </div>

      {/* Target agent */}
      <div style={{ overflow:"hidden" }}>
        <Link href={`/agents/${trade.agent_id}`} style={{ textDecoration:"none" }}>
          <div style={{ fontSize:11, fontWeight:800, color:"white",
            textOverflow:"ellipsis", overflow:"hidden", whiteSpace:"nowrap" }}>
            {trade.target_name || "Unknown"}
          </div>
          <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)" }}>
            ELO {trade.target_elo||"?"} · {trade.win_rate||"?"}% win
          </div>
        </Link>
      </div>

      {/* Shares × price */}
      <div style={{ textAlign:"right" as const }}>
        <div style={{ fontSize:12, fontWeight:900,
          fontFamily:"JetBrains Mono,monospace", color:"white" }}>
          {trade.shares}×{fmt(trade.price)}
        </div>
        <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)",
          fontFamily:"JetBrains Mono,monospace" }}>
          HIP
        </div>
      </div>

      {/* Total cost */}
      <div style={{ textAlign:"right" as const,
        fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.5)",
        fontFamily:"JetBrains Mono,monospace" }}>
        {fmt(trade.total_cost)} HIP
      </div>

      {/* Reason */}
      <div style={{ textAlign:"center" as const }}>
        <span style={{ fontSize:8, color:"rgba(255,255,255,0.3)" }}>
          {REASON_LABEL[trade.trade_type] || trade.trade_type}
        </span>
      </div>

      {/* Time */}
      <div style={{ textAlign:"right" as const,
        fontSize:9, color:"rgba(255,255,255,0.2)",
        fontFamily:"JetBrains Mono,monospace" }}>
        {timeAgo(trade.created_at)}
      </div>
    </div>
  );
}

// ─── Order Book ───────────────────────────────────────────────────
function OrderBook({ bids, asks, price }: { bids:any[],asks:any[],price:number }) {
  const maxVol = Math.max(...[...bids,...asks].map(x=>x.volume||1));
  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr",
        gap:4, fontSize:8, color:"rgba(255,255,255,0.2)",
        fontFamily:"JetBrains Mono,monospace", marginBottom:6 }}>
        <span>QTY</span><span style={{textAlign:"center" as const}}>PRICE</span><span style={{textAlign:"right" as const}}>QTY</span>
      </div>
      {asks.slice(0,6).reverse().map((a,i) => (
        <div key={i} style={{ position:"relative",marginBottom:2 }}>
          <div style={{ position:"absolute",right:0,top:0,bottom:0,
            background:"rgba(248,113,113,0.1)",
            width:`${(a.volume/maxVol)*100}%`,borderRadius:2 }}/>
          <div style={{ display:"grid",gridTemplateColumns:"1fr auto 1fr",
            gap:4,fontSize:10,fontFamily:"JetBrains Mono,monospace",
            padding:"2px 4px",position:"relative",zIndex:1 }}>
            <span style={{color:"rgba(255,255,255,0.3)"}}>{a.volume}</span>
            <span style={{color:"#f87171",fontWeight:700}}>{fmt(a.price)}</span>
            <span style={{textAlign:"right" as const,color:"rgba(255,255,255,0.15)",fontSize:8}}>sell</span>
          </div>
        </div>
      ))}
      <div style={{ textAlign:"center" as const,padding:"6px 0",fontSize:13,fontWeight:900,
        color:"white",fontFamily:"JetBrains Mono,monospace",
        borderTop:"1px solid rgba(255,255,255,0.06)",
        borderBottom:"1px solid rgba(255,255,255,0.06)",margin:"4px 0" }}>
        {fmt(price)}
        <span style={{fontSize:8,color:"rgba(255,255,255,0.3)",marginLeft:4}}>HIP</span>
      </div>
      {bids.slice(0,6).map((b,i) => (
        <div key={i} style={{ position:"relative",marginBottom:2 }}>
          <div style={{ position:"absolute",left:0,top:0,bottom:0,
            background:"rgba(74,222,128,0.1)",
            width:`${(b.volume/maxVol)*100}%`,borderRadius:2 }}/>
          <div style={{ display:"grid",gridTemplateColumns:"1fr auto 1fr",
            gap:4,fontSize:10,fontFamily:"JetBrains Mono,monospace",
            padding:"2px 4px",position:"relative",zIndex:1 }}>
            <span style={{color:"rgba(255,255,255,0.3)"}}>{b.volume}</span>
            <span style={{color:"#4ade80",fontWeight:700}}>{fmt(b.price)}</span>
            <span style={{textAlign:"right" as const,color:"rgba(255,255,255,0.15)",fontSize:8}}>buy</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Toast Notification ──────────────────────────────────────────
function Toast({ toast }: { toast: {msg:string,ok:boolean}|null }) {
  if (!toast) return null;
  return (
    <div style={{
      position:"fixed", bottom:24, right:24, zIndex:9999,
      padding:"12px 20px", borderRadius:12,
      background: toast.ok ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)",
      border: `1px solid ${toast.ok?"rgba(74,222,128,0.4)":"rgba(248,113,113,0.4)"}`,
      color: toast.ok ? "#4ade80" : "#f87171",
      fontSize:13, fontWeight:700,
      backdropFilter:"blur(12px)",
      boxShadow: `0 8px 32px ${toast.ok?"rgba(74,222,128,0.15)":"rgba(248,113,113,0.15)"}`,
      animation:"fadeInUp 0.3s ease",
      maxWidth:280,
    }}>
      {toast.ok ? "✓" : "✗"} {toast.msg}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────
export default function ExchangePage() {
  const [overview,    setOverview]    = useState<any>(null);
  const [realPrices,  setRealPrices]  = useState<any[]>([]);
  const [signal,      setSignal]      = useState<any>(null);
  const [trades,      setTrades]      = useState<any[]>([]);
  const [freshIds,    setFreshIds]    = useState<Set<number>>(new Set());
  const [selected,    setSelected]    = useState<string|null>(null);
  const [candles,     setCandles]     = useState<any[]>([]);
  const [orderbook,   setOrderbook]   = useState<any>(null);
  const [ticker,      setTicker]      = useState<any>(null);
  const [interval,    setInterval_]   = useState<"1m"|"5m"|"15m"|"1h">("5m");
  const [handle,      setHandle]      = useState("");
  const [savedHandle, setSavedHandle] = useState("");
  const [hipBalance,  setHipBalance]  = useState<number|null>(null);
  const [portfolio,   setPortfolio]   = useState<any>(null);
  const [buyShares,   setBuyShares]   = useState(1);
  const [buying,      setBuying]      = useState(false);
  const [selling,     setSelling]     = useState<string|null>(null); // agent_id being sold
  const [buyResult,   setBuyResult]   = useState<any>(null);
  const [tab,         setTab]         = useState<"chart"|"book"|"drivers"|"portfolio">("chart");
  const [flashMap,    setFlashMap]    = useState<Record<string,string>>({});
  const [agentSearch,    setAgentSearch]    = useState("");
  const [profileFilter,  setProfileFilter]  = useState<string>(""); // "" = all profiles
  const [toast,          setToast]          = useState<{msg:string,ok:boolean}|null>(null);
  const [sellShares,     setSellShares]     = useState<Record<string,number>>({}); // per-holding sell qty
  const [agentProfile,   setAgentProfile]   = useState<any>(null); // selected agent market profile
  const wsRef = useRef<WebSocket|null>(null);

  // ── Toast helper
  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 1800);
  }

  // ── Load overview + real prices + signal
  useEffect(() => {
    const load = () => Promise.all([
      fetch(`${API}/api/v1/market/overview`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/market/real-prices`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/funds/market-signal`).then(r=>r.json()).catch(()=>null),
    ]).then(([ov, rp, sig]) => {
      if (ov) { setOverview(ov); if (!selected && ov.listings?.length) setSelected(ov.listings[0].agent_id); }
      if (rp?.prices?.length) setRealPrices(rp.prices);
      if (sig?.label) setSignal(sig);
    });
    load();
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
  }, []);

  // ── Load trades
  useEffect(() => {
    const load = () =>
      fetch(`${API}/api/v1/exchange/trades?limit=60`)
        .then(r=>r.json()).catch(()=>null)
        .then(d => { if (d?.trades) setTrades(d.trades); });
    load();
    const t = window.setInterval(load, 10000);
    return () => window.clearInterval(t);
  }, []);

  // ── Load selected agent chart
  useEffect(() => {
    if (!selected) return;
    const load = () => Promise.all([
      fetch(`${API}/api/v1/market/candles/${selected}?interval=${interval}`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/market/orderbook/${selected}`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/market/ticker/${selected}`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/market/agent-profile/${selected}`).then(r=>r.json()).catch(()=>null),
    ]).then(([c,o,t,p]) => {
      if (c) setCandles(c.candles||[]);
      if (o) setOrderbook(o);
      if (t) setTicker(t);
      if (p && !p.error) setAgentProfile(p);
    });
    load();
    const t = window.setInterval(load, 20000);
    return () => window.clearInterval(t);
  }, [selected, interval]);

  // ── Portfolio + HIP balance
  useEffect(() => {
    if (!savedHandle) return;
    fetch(`${API}/api/v1/exchange/portfolio/${savedHandle}`)
      .then(r=>r.json()).then(d=>setPortfolio(d)).catch(()=>{});
    // Load HIP balance
    fetch(`${API}/api/v1/human/profile/${encodeURIComponent(savedHandle)}`)
      .then(r=>r.json())
      .then(d=>{ if (d.hip_balance != null) setHipBalance(parseFloat(d.hip_balance)); })
      .catch(()=>{});
  }, [savedHandle]);

  // ── WebSocket
  useEffect(() => {
    let ws: WebSocket;
    function connect() {
      try {
        ws = new WebSocket(WS_URL.replace(/^https/,"wss").replace(/^http(?!s)/,"ws") + "/ws");
        wsRef.current = ws;
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);

            // New trade - inject at top of list
            if (msg.type === "platform:ai_trade") {
              const newTrade = {
                id:          msg.trade_id || Date.now(),
                agent_id:    msg.target_id || msg.agent_id,
                buyer:       msg.buyer_id,
                buyer_name:  msg.buyer_name,
                seller_name: msg.seller_name,
                target_name: msg.target_name || msg.agent_name,
                target_elo:  msg.target_elo,
                win_rate:    null,
                shares:      msg.shares,
                price:       msg.price,
                total_cost:  msg.total_cost,
                trade_type:  msg.action,
                created_at:  new Date().toISOString(),
              };
              setTrades(prev => [newTrade, ...prev.slice(0,59)]);
              setFreshIds(f => { const s = new Set(f); s.add(newTrade.id); setTimeout(()=>setFreshIds(ff=>{const ss=new Set(ff);ss.delete(newTrade.id);return ss;}),2000); return s; });
            }

            // Price update - flash agent list + update portfolio
            if (msg.type === "platform:price_update" || msg.type === "platform:ai_trade") {
              const agentId = msg.agent_id || msg.target_id;
              const newPrice = parseFloat(msg.new_price || msg.price);
              setOverview((prev: any) => {
                if (!prev) return prev;
                return { ...prev, listings: prev.listings.map((l: any) =>
                  l.agent_id !== agentId ? l : { ...l, price: newPrice }
                )};
              });
              // Also update portfolio current prices in real-time
              setPortfolio((prev: any) => {
                if (!prev?.portfolio) return prev;
                const updated = prev.portfolio.map((h: any) =>
                  h.agent_id !== agentId ? h : {
                    ...h,
                    price: newPrice,
                    current_value: parseFloat((h.shares * newPrice).toFixed(2)),
                    unrealized_profit: parseFloat(((newPrice - parseFloat(h.avg_cost)) * h.shares).toFixed(2)),
                  }
                );
                const totalValue = updated.reduce((s:number, r:any) => s + parseFloat(r.current_value||0), 0);
                const totalCost  = updated.reduce((s:number, r:any) => s + parseFloat(r.avg_cost||0)*r.shares, 0);
                return {
                  ...prev,
                  portfolio: updated,
                  summary: {
                    ...prev.summary,
                    total_value:  parseFloat(totalValue.toFixed(2)),
                    total_profit: parseFloat((totalValue - totalCost).toFixed(2)),
                  }
                };
              });
              const dir = msg.action === "buy" ? "up" : "down";
              setFlashMap(f => ({ ...f, [agentId]: dir }));
              setTimeout(() => setFlashMap(f => ({ ...f, [agentId]: "none" })), 1200);
              if (agentId === selected) {
                setTicker((prev: any) => prev ? { ...prev, price: newPrice } : prev);
                setCandles(prev => {
                  if (!prev.length) return prev;
                  const last = { ...prev[prev.length-1], close:newPrice,
                    high:Math.max(prev[prev.length-1].high,newPrice),
                    low:Math.min(prev[prev.length-1].low,newPrice) };
                  return [...prev.slice(0,-1), last];
                });
              }
            }

            // Market update - refresh signal
            if (msg.type === "platform:market_update") {
              if (msg.data?.length) setRealPrices(msg.data);
            }

            // News pulse - inject into live trades feed as a news event row
            if (msg.type === "platform:news_pulse" && msg.top_headlines?.length) {
              const h = msg.top_headlines[0];
              const newsEvent = {
                id:          `news-${Date.now()}`,
                agent_id:    "news",
                buyer_name:  `📰 ${h.source}`,
                target_name: h.title?.slice(0,50) + "…",
                target_elo:  null,
                shares:      null,
                price:       null,
                total_cost:  null,
                trade_type:  h.signal === "bullish" ? "buy" : h.signal === "bearish" ? "sell" : "buy",
                created_at:  new Date().toISOString(),
                is_news:     true,
                mood:        msg.mood,
                mood_score:  msg.mood_score,
              };
              setTrades(prev => [newsEvent, ...prev.slice(0,58)]);
              setFreshIds(f => { const s = new Set(f); s.add(newsEvent.id as any); setTimeout(()=>setFreshIds(ff=>{const ss=new Set(ff);ss.delete(newsEvent.id as any);return ss;}),3000); return s; });
            }
          } catch {}
        };
        ws.onclose = () => setTimeout(connect, 3000);
      } catch {}
    }
    connect();
    return () => { try { ws?.close(); } catch {} };
  }, [selected]);

  function enterHandle() {
    if (!handle.trim()) return;
    setSavedHandle(handle.trim());
  }

  async function executeBuy() {
    if (!savedHandle || !selected || !ticker) return;
    setBuying(true); setBuyResult(null);
    try {
      const res = await fetch(`${API}/api/v1/exchange/buy`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ handle: savedHandle, agent_id: selected, shares: buyShares }),
      }).then(r=>r.json());
      setBuyResult(res);
      if (res.ok) {
        showToast(`Bought ${res.shares_bought} share${res.shares_bought>1?"s":""} · ${res.total_cost} HIP`, true);
        // Refresh portfolio and HIP balance
        fetch(`${API}/api/v1/exchange/portfolio/${savedHandle}`)
          .then(r=>r.json()).then(d=>setPortfolio(d)).catch(()=>{});
        fetch(`${API}/api/v1/human/profile/${encodeURIComponent(savedHandle)}`)
          .then(r=>r.json()).then(d=>{ if (d.hip_balance!=null) setHipBalance(parseFloat(d.hip_balance)); }).catch(()=>{});
      } else {
        showToast(res.error || "Buy failed", false);
      }
    } catch { setBuyResult({ error:"Network error" }); showToast("Network error", false); }
    setBuying(false);
  }

  async function executeSell(agentId: string, sharesToSell: number = 1) {
    if (!savedHandle) return;
    setSelling(agentId);
    try {
      const res = await fetch(`${API}/api/v1/exchange/sell`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ handle: savedHandle, agent_id: agentId, shares: sharesToSell }),
      }).then(r=>r.json());
      if (res.ok) {
        showToast(`Sold ${res.shares_sold} share · +${res.total_received} HIP`, true);
        // Refresh portfolio and HIP balance
        fetch(`${API}/api/v1/exchange/portfolio/${savedHandle}`)
          .then(r=>r.json()).then(d=>setPortfolio(d)).catch(()=>{});
        fetch(`${API}/api/v1/human/profile/${encodeURIComponent(savedHandle)}`)
          .then(r=>r.json()).then(d=>{ if (d.hip_balance!=null) setHipBalance(parseFloat(d.hip_balance)); }).catch(()=>{});
      } else {
        showToast(res.error || "Sell failed", false);
      }
    } catch { showToast("Network error", false); }
    setSelling(null);
  }

  const chg = ticker ? parseFloat(((parseFloat(ticker.price)-parseFloat(ticker.price_24h||ticker.price))/parseFloat(ticker.price_24h||ticker.price)*100).toFixed(2)) : 0;

  return (
    <div className="min-h-screen" style={{ color:"white" }}>
      <style>{`
        @keyframes ticker-scroll { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        @keyframes pulse-icon { from{opacity:0.6;transform:scale(0.9)} to{opacity:1;transform:scale(1.1)} }
        @keyframes flash-up   { 0%,100%{background:transparent} 30%{background:rgba(74,222,128,0.12)} }
        @keyframes flash-down { 0%,100%{background:transparent} 30%{background:rgba(248,113,113,0.12)} }
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
        input[type=number]::-webkit-inner-spin-button{opacity:0}
      `}</style>

      {/* ══ Toast ════════════════════════════════════════════════ */}
      <Toast toast={toast} />

      {/* ══ TWO TICKER BARS ══════════════════════════════════════ */}
      {/* 1st: AI stock prices */}
      {overview?.listings && <AITicker listings={overview.listings} />}
      {/* 2nd: Real world stock/crypto prices */}
      <RealTicker prices={realPrices} signal={signal} />

      {/* ══ HEADER ═══════════════════════════════════════════════ */}
      <div style={{ maxWidth:1500, margin:"0 auto", padding:"20px 24px 0" }}>
        <div style={{ display:"flex", alignItems:"flex-start",
          justifyContent:"space-between", gap:16, flexWrap:"wrap", marginBottom:16 }}>
          {/* Title */}
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
              <div style={{ position:"relative", width:8, height:8 }}>
                <div style={{ position:"absolute", inset:-2, borderRadius:"50%",
                  border:"1px solid rgba(74,222,128,0.4)",
                  animation:"pulse-icon 2s ease-in-out infinite alternate" }}/>
                <div style={{ width:8,height:8,borderRadius:"50%",background:"#4ade80",
                  boxShadow:"0 0 6px #4ade80" }}/>
              </div>
              <span style={{ fontSize:10,fontWeight:800,letterSpacing:"0.16em",
                color:"#4ade80",fontFamily:"JetBrains Mono,monospace",textTransform:"uppercase" }}>
                ASX · Market Open 24/7
              </span>
            </div>
            <h1 style={{ margin:0,fontSize:"clamp(1.3rem,2.5vw,1.8rem)",fontWeight:900,
              letterSpacing:"-0.02em" }}>
              Agent Stock Exchange
            </h1>
          </div>

          {/* Market stats */}
          {overview?.market && (
            <div style={{ display:"flex", gap:0,
              background:"rgba(255,255,255,0.02)",
              border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, overflow:"hidden" }}>
              {[
                {l:"Market Cap", v:`${fmtK(overview.market.total_mcap)} HIP`, c:"#fbbf24"},
                {l:"Vol 24h",    v:fmtK(overview.market.total_volume),        c:"#94a3b8"},
                {l:"Gainers",    v:overview.market.gainers,                   c:"#4ade80"},
                {l:"Losers",     v:overview.market.losers,                    c:"#f87171"},
                {l:"Listed",     v:overview.market.total_listed,              c:"#00e5ff"},
              ].map((s,i,arr)=>(
                <div key={s.l} style={{ padding:"8px 16px", textAlign:"center" as const,
                  borderRight:i<arr.length-1?"1px solid rgba(255,255,255,0.05)":"none" }}>
                  <div style={{ fontSize:15,fontWeight:900,
                    fontFamily:"JetBrains Mono,monospace",color:s.c,lineHeight:1 }}>{s.v}</div>
                  <div style={{ fontSize:8,color:"rgba(255,255,255,0.25)",
                    textTransform:"uppercase" as const,letterSpacing:"0.1em",marginTop:3 }}>{s.l}</div>
                </div>
              ))}
            </div>
          )}

          {/* Handle + HIP balance */}
          <div>
            {savedHandle ? (
              <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                <div style={{ textAlign:"right" as const }}>
                  <div style={{ display:"flex",alignItems:"center",gap:8,justifyContent:"flex-end" }}>
                    <div style={{ fontSize:12,fontWeight:800,color:"white" }}>{savedHandle}</div>
                    <button onClick={()=>{ setSavedHandle(""); setHipBalance(null); setPortfolio(null); }}
                      style={{ fontSize:9,color:"rgba(255,255,255,0.2)",background:"none",
                        border:"none",cursor:"pointer",padding:0 }}>✕</button>
                  </div>
                  {hipBalance != null && (
                    <div style={{ fontSize:10,fontFamily:"JetBrains Mono,monospace",fontWeight:700,
                      color:"#fbbf24",marginTop:1 }}>
                      💎 {hipBalance.toFixed(2)} HIP
                    </div>
                  )}
                  {portfolio && (
                    <div style={{ fontSize:10,fontFamily:"JetBrains Mono,monospace",fontWeight:700,
                      color:portfolio.summary?.total_profit>=0?"#4ade80":"#f87171" }}>
                      {portfolio.summary?.total_profit>=0?"+":""}{fmt(portfolio.summary?.total_profit)} HIP P&L
                    </div>
                  )}
                </div>
                <button onClick={()=>setTab("portfolio")} style={{
                  padding:"7px 14px",borderRadius:9,cursor:"pointer",
                  background:"rgba(0,229,255,0.07)",border:"1px solid rgba(0,229,255,0.2)",
                  color:"#00e5ff",fontSize:11,fontWeight:700 }}>Portfolio</button>
              </div>
            ) : (
              <div style={{ display:"flex",gap:8 }}>
                <input value={handle} onChange={e=>setHandle(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&enterHandle()}
                  placeholder="Enter handle to trade"
                  style={{ padding:"7px 12px",borderRadius:9,width:160,
                    background:"rgba(255,255,255,0.05)",
                    border:"1px solid rgba(255,255,255,0.1)",
                    color:"white",fontSize:12,outline:"none" }}/>
                <button onClick={enterHandle} style={{
                  padding:"7px 14px",borderRadius:9,cursor:"pointer",
                  background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.25)",
                  color:"#fbbf24",fontSize:12,fontWeight:700 }}>Enter</button>
              </div>
            )}
          </div>
        </div>

        {/* ══ MARKET SIGNAL BANNER ═════════════════════════════ */}
        <div style={{ marginBottom:12 }}>
          <SignalBanner signal={signal} />
        </div>

        {/* ══ NEWS INTELLIGENCE ════════════════════════════════ */}
        <div style={{ marginBottom:12 }}>
          <NewsPulse />
        </div>

        {/* ══ REAL MARKET DRIVERS ══════════════════════════════ */}
        {realPrices.length > 0 && (
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:8,fontWeight:700,letterSpacing:"0.16em",
              textTransform:"uppercase" as const,color:"rgba(255,255,255,0.2)",
              fontFamily:"JetBrains Mono,monospace",marginBottom:8 }}>
              📡 Real Market Drivers — Agent prices follow these signals
            </div>
            <div style={{ display:"flex",gap:6,flexWrap:"wrap" as const }}>
              {["SPY","NVDA","BTC-USD","ETH-USD","TSLA","QQQ"].map(sym => {
                const d = realPrices.find((r:any) => r.symbol === sym);
                if (!d) return null;
                const chg = parseFloat(d.change_pct);
                return (
                  <div key={sym} style={{ display:"flex",alignItems:"center",gap:6,
                    padding:"5px 10px",borderRadius:8,
                    background:chg>0?"rgba(74,222,128,0.06)":chg<0?"rgba(248,113,113,0.06)":"rgba(255,255,255,0.03)",
                    border:`1px solid ${chg>0?"rgba(74,222,128,0.15)":chg<0?"rgba(248,113,113,0.15)":"rgba(255,255,255,0.07)"}` }}>
                    <span style={{ fontSize:11 }}>{d.icon}</span>
                    <span style={{ fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.7)" }}>{sym.replace('-USD','')}</span>
                    <span style={{ fontSize:10,fontWeight:800,
                      fontFamily:"JetBrains Mono,monospace",
                      color:chg>0?"#4ade80":chg<0?"#f87171":"#94a3b8" }}>
                      {chg>0?"+":""}{chg.toFixed(2)}%
                    </span>
                  </div>
                );
              })}
              <div style={{ marginLeft:"auto",display:"flex",alignItems:"center",gap:6,
                padding:"5px 12px",borderRadius:8,
                background:"rgba(255,255,255,0.03)",
                border:"1px solid rgba(255,255,255,0.07)",
                fontSize:9,color:"rgba(255,255,255,0.3)" }}>
                <span>🔄</span>
                <span>Updates every 3 min · Prices = real market × AI beta</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══ MAIN 3-COLUMN LAYOUT ═════════════════════════════════ */}
      <div style={{ maxWidth:1500, margin:"0 auto", padding:"0 24px 40px",
        display:"grid", gridTemplateColumns:"220px 1fr 320px", gap:16 }}>

        {/* ── LEFT: Agent list ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
          {/* Profile filter chips */}
          <div style={{ display:"flex",flexWrap:"wrap" as const,gap:3,marginBottom:6 }}>
            {[
              {key:"",    icon:"🌐", label:"All"},
              {key:"ai_pure",       icon:"🤖", label:"AI"},
              {key:"crypto_native", icon:"₿",  label:"Crypto"},
              {key:"tech_growth",   icon:"🚀", label:"Tech"},
              {key:"contrarian",    icon:"🔄", label:"Contra"},
              {key:"momentum",      icon:"⚡", label:"Momentum"},
              {key:"defensive",     icon:"🛡", label:"Stable"},
            ].map(p=>(
              <button key={p.key} onClick={()=>setProfileFilter(p.key)}
                style={{ padding:"2px 7px",borderRadius:6,cursor:"pointer",fontSize:8,fontWeight:700,
                  background:profileFilter===p.key?"rgba(0,229,255,0.12)":"rgba(255,255,255,0.03)",
                  border:`1px solid ${profileFilter===p.key?"rgba(0,229,255,0.3)":"rgba(255,255,255,0.06)"}`,
                  color:profileFilter===p.key?"#00e5ff":"rgba(255,255,255,0.4)" }}>
                {p.icon} {p.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize:8,fontWeight:700,letterSpacing:"0.16em",
            textTransform:"uppercase" as const,color:"rgba(255,255,255,0.2)",
            fontFamily:"JetBrains Mono,monospace",padding:"0 4px",marginBottom:4 }}>
            Agents — {(overview?.listings||[]).filter((l:any)=>
              (!agentSearch||l.name.toLowerCase().includes(agentSearch.toLowerCase())) &&
              (!profileFilter||l.market_profile===profileFilter)
            ).length}
          </div>
          {/* Search filter */}
          <input
            value={agentSearch} onChange={e=>setAgentSearch(e.target.value)}
            placeholder="Search agents..."
            style={{ padding:"5px 10px",borderRadius:7,marginBottom:6,
              background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",
              color:"white",fontSize:11,outline:"none",width:"100%",boxSizing:"border-box" as const }}
          />
          <div style={{ display:"flex",flexDirection:"column",gap:1,
            maxHeight:"calc(100vh - 260px)",overflowY:"auto" as const }}>
            {(overview?.listings||[]).filter((l:any)=>
              (!agentSearch||l.name.toLowerCase().includes(agentSearch.toLowerCase())) &&
              (!profileFilter||l.market_profile===profileFilter)
            ).map((l: any) => {
              const chg = parseFloat(l.change_pct)||0;
              const sel = l.agent_id === selected;
              const flash = flashMap[l.agent_id];
              return (
                <div key={l.agent_id} onClick={()=>setSelected(l.agent_id)}
                  style={{ padding:"8px 10px",borderRadius:8,cursor:"pointer",
                    background:sel?"rgba(0,229,255,0.07)":"rgba(255,255,255,0.02)",
                    border:`1px solid ${sel?"rgba(0,229,255,0.2)":"rgba(255,255,255,0.04)"}`,
                    animation:flash==="up"?"flash-up 1s ease":flash==="down"?"flash-down 1s ease":undefined,
                    transition:"border-color 0.1s" }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:4 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:5,minWidth:0 }}>
                      {l.is_online && <span style={{ width:4,height:4,borderRadius:"50%",
                        background:"#34d399",flexShrink:0,display:"inline-block",
                        boxShadow:"0 0 4px #34d399" }}/>}
                      <span style={{ fontSize:11,fontWeight:700,color:sel?"white":"rgba(255,255,255,0.6)",
                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const }}>
                        {l.name}
                      </span>
                    </div>
                    <span style={{ fontSize:10,fontWeight:800,flexShrink:0,
                      fontFamily:"JetBrains Mono,monospace",
                      color:flash==="up"?"#4ade80":flash==="down"?"#f87171":"white" }}>
                      {fmt(l.price)}
                    </span>
                  </div>
                  <div style={{ display:"flex",justifyContent:"space-between",marginTop:2 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                      <span style={{ fontSize:8,color:"rgba(255,255,255,0.2)",
                        fontFamily:"JetBrains Mono,monospace" }}>ELO {l.elo_rating}</span>
                      {l.profile_icon && (
                        <span style={{ fontSize:8,opacity:0.5 }} title={l.profile_label}>
                          {l.profile_icon}
                        </span>
                      )}
                      {l.beta && (
                        <span style={{ fontSize:7,color:"rgba(255,255,255,0.2)",
                          fontFamily:"JetBrains Mono,monospace" }}>
                          β{parseFloat(l.beta).toFixed(1)}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize:9,fontWeight:700,
                      fontFamily:"JetBrains Mono,monospace",color:pctColor(chg) }}>
                      {chg===0?"-":`${chg>0?"+":""}${chg.toFixed(1)}%`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── CENTER: Chart + buy + live trades ── */}
        <div style={{ display:"flex",flexDirection:"column",gap:14 }}>

          {/* Agent ticker card */}
          {ticker && (
            <div style={{ background:"rgba(255,255,255,0.02)",
              border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,
              padding:"16px 20px",display:"flex",alignItems:"flex-start",
              justifyContent:"space-between",gap:16,flexWrap:"wrap" as const }}>
              <div>
                <div style={{ display:"flex",alignItems:"baseline",gap:10,marginBottom:4 }}>
                  <span style={{ fontSize:"1.9rem",fontWeight:900,
                    fontFamily:"JetBrains Mono,monospace",
                    color:chg>=0?"#4ade80":"#f87171" }}>
                    {fmt(ticker.price)}
                  </span>
                  <span style={{ fontSize:11,color:"rgba(255,255,255,0.3)",
                    fontFamily:"JetBrains Mono,monospace" }}>HIP</span>
                  <span style={{ fontSize:12,fontWeight:900,
                    fontFamily:"JetBrains Mono,monospace",
                    color:pctColor(chg),background:`${pctColor(chg)}15`,
                    padding:"2px 8px",borderRadius:6 }}>
                    {chg===0?"-":`${chg>0?"+":""}${chg.toFixed(2)}%`}
                  </span>
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:4 }}>
                  <span style={{ fontSize:18,fontWeight:900,color:"white" }}>{ticker.name}</span>
                  {ticker.profile_icon && (
                    <span style={{ fontSize:12,padding:"2px 8px",borderRadius:6,
                      background:"rgba(255,255,255,0.05)",
                      border:"1px solid rgba(255,255,255,0.08)" }}
                      title={ticker.profile_label}>
                      {ticker.profile_icon} {ticker.profile_label}
                    </span>
                  )}
                  {ticker.beta && (
                    <span style={{ fontSize:10,color:"rgba(255,255,255,0.3)",
                      fontFamily:"JetBrains Mono,monospace" }}>
                      β{parseFloat(ticker.beta).toFixed(2)}
                    </span>
                  )}
                </div>
                <div style={{ display:"flex",gap:16,flexWrap:"wrap" as const }}>
                  {[
                    {l:"ELO",       v:ticker.elo_rating,             c:"#00e5ff"},
                    {l:"Win Rate",  v:`${ticker.win_rate}%`,         c:"#4ade80"},
                    {l:"Market Cap",v:`${fmtK(ticker.market_cap)} HIP`,c:"#fbbf24"},
                    {l:"Vol 24h",   v:ticker.volume_24h||0,          c:"#94a3b8"},
                  ].map(s=>(
                    <div key={s.l}>
                      <span style={{ fontSize:11,fontWeight:800,color:s.c,
                        fontFamily:"JetBrains Mono,monospace" }}>{s.v}</span>
                      <span style={{ fontSize:8,color:"rgba(255,255,255,0.2)",
                        marginLeft:4,textTransform:"uppercase" as const }}>{s.l}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Buy + Sell panel */}
              <div style={{ display:"flex",flexDirection:"column",gap:8,alignItems:"flex-end" as const }}>
                <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                  <input type="number" min={1} max={50} value={buyShares}
                    onChange={e=>setBuyShares(parseInt(e.target.value)||1)}
                    style={{ width:56,padding:"5px 8px",borderRadius:7,
                      background:"rgba(255,255,255,0.06)",
                      border:"1px solid rgba(255,255,255,0.12)",
                      color:"white",fontSize:13,textAlign:"center" as const,outline:"none" }}/>
                  <span style={{ fontSize:11,color:"rgba(255,255,255,0.4)",
                    fontFamily:"JetBrains Mono,monospace" }}>
                    × {fmt(ticker.price)} = {fmt(ticker.price*buyShares)} HIP
                  </span>
                </div>
                {!savedHandle ? (
                  <span style={{ fontSize:11,color:"rgba(255,255,255,0.25)" }}>Enter handle to trade</span>
                ) : (
                  <div style={{ display:"flex",gap:8 }}>
                    <button onClick={executeBuy} disabled={buying} style={{
                      padding:"9px 22px",borderRadius:10,cursor:"pointer",
                      background:buying?"rgba(255,255,255,0.03)":"rgba(74,222,128,0.1)",
                      border:"1px solid rgba(74,222,128,0.3)",
                      color:"#4ade80",fontSize:13,fontWeight:800 }}>
                      {buying?"..." : "▲ Buy"}
                    </button>
                    {/* Sell button - only if holding */}
                    {(() => {
                      const holding = portfolio?.portfolio?.find((h:any)=>h.agent_id===selected && h.shares>0);
                      if (!holding) return null;
                      return (
                        <button onClick={()=>executeSell(selected!, buyShares)}
                          disabled={selling===selected} style={{
                            padding:"9px 18px",borderRadius:10,cursor:"pointer",
                            background:selling===selected?"rgba(255,255,255,0.03)":"rgba(248,113,113,0.1)",
                            border:"1px solid rgba(248,113,113,0.3)",
                            color:"#f87171",fontSize:13,fontWeight:800 }}>
                          {selling===selected ? "..." : `▼ Sell ${Math.min(buyShares, holding.shares)}`}
                        </button>
                      );
                    })()}
                  </div>
                )}
                {hipBalance != null && (
                  <span style={{ fontSize:10,color:"rgba(255,191,36,0.6)",
                    fontFamily:"JetBrains Mono,monospace" }}>
                    Balance: {hipBalance.toFixed(2)} HIP
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div style={{ display:"flex",gap:6 }}>
            {([
              {id:"chart",label:"📈 Chart"},
              {id:"book", label:"📊 Order Book"},
              {id:"drivers",label:"📡 Drivers"},
              {id:"portfolio",label:"💼 Portfolio"},
            ] as {id:"chart"|"book"|"drivers"|"portfolio",label:string}[]).map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id as any)} style={{
                padding:"6px 14px",borderRadius:9,cursor:"pointer",fontSize:11,fontWeight:700,
                background:tab===t.id?"rgba(0,229,255,0.08)":"rgba(255,255,255,0.03)",
                border:`1px solid ${tab===t.id?"rgba(0,229,255,0.25)":"rgba(255,255,255,0.07)"}`,
                color:tab===t.id?"#00e5ff":"rgba(255,255,255,0.4)" }}>
                {t.label}
              </button>
            ))}
            {tab==="chart" && (
              <div style={{ marginLeft:"auto",display:"flex",gap:4 }}>
                {(["1m","5m","15m","1h"] as const).map(iv=>(
                  <button key={iv} onClick={()=>setInterval_(iv)} style={{
                    padding:"4px 10px",borderRadius:6,cursor:"pointer",
                    fontSize:10,fontWeight:700,
                    background:interval===iv?"rgba(251,191,36,0.1)":"transparent",
                    border:`1px solid ${interval===iv?"rgba(251,191,36,0.3)":"rgba(255,255,255,0.07)"}`,
                    color:interval===iv?"#fbbf24":"rgba(255,255,255,0.3)" }}>
                    {iv}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tab content */}
          <div style={{ background:"rgba(255,255,255,0.02)",
            border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"20px" }}>
            {tab==="chart" && (
              <>
                <CandleChart candles={candles} color={chg>=0?"#4ade80":"#f87171"}/>
                <div style={{ display:"flex",gap:1,height:24,marginTop:4,alignItems:"flex-end" }}>
                  {candles.slice(-30).map((c,i)=>{
                    const maxVol=Math.max(...candles.map((x:any)=>x.volume||1));
                    const h=Math.max(2,((c.volume||1)/maxVol)*24);
                    return <div key={i} style={{ flex:1,height:h,borderRadius:1,
                      background:c.close>=c.open?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)" }}/>;
                  })}
                </div>
                <div style={{ fontSize:8,color:"rgba(255,255,255,0.15)",
                  letterSpacing:"0.1em",marginTop:3,textTransform:"uppercase" as const }}>Volume</div>
              </>
            )}
            {tab==="book" && orderbook && (
              <>
                <div style={{ fontSize:9,fontWeight:700,letterSpacing:"0.16em",
                  textTransform:"uppercase" as const,color:"rgba(255,255,255,0.2)",
                  fontFamily:"JetBrains Mono,monospace",marginBottom:12 }}>
                  Order Depth - {ticker?.name}
                </div>
                <OrderBook bids={orderbook.bids} asks={orderbook.asks} price={orderbook.current_price}/>
              </>
            )}
            {tab==="drivers" && (
              <div style={{ padding:"4px 0" }}>
                {!agentProfile ? (
                  <div style={{ textAlign:"center" as const,padding:"32px 0",
                    color:"rgba(255,255,255,0.2)",fontSize:12 }}>Loading profile...</div>
                ) : (
                  <>
                    {/* Profile header */}
                    <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16,
                      padding:"12px 16px",borderRadius:12,
                      background:"rgba(255,255,255,0.03)",
                      border:"1px solid rgba(255,255,255,0.07)" }}>
                      <span style={{ fontSize:24 }}>{agentProfile.profile_icon}</span>
                      <div>
                        <div style={{ fontSize:13,fontWeight:800,color:"white" }}>
                          {agentProfile.profile_label} Strategy
                        </div>
                        <div style={{ fontSize:10,color:"rgba(255,255,255,0.35)" }}>
                          β = {agentProfile.beta.toFixed(2)} · Price follows real market weighted by these factors
                        </div>
                      </div>
                    </div>

                    {/* Weight breakdown */}
                    <div style={{ marginBottom:16 }}>
                      <div style={{ fontSize:9,fontWeight:700,letterSpacing:"0.12em",
                        textTransform:"uppercase" as const,color:"rgba(255,255,255,0.2)",
                        marginBottom:8 }}>Market Weight Allocation</div>
                      {Object.entries(agentProfile.weights||{}).map(([sym,w]:any)=>{
                        const mktData = realPrices.find((r:any)=>r.symbol===sym);
                        const chg     = parseFloat(mktData?.change_pct||0);
                        const contrib = parseFloat(w) * chg * agentProfile.beta;
                        const pct     = Math.abs(parseFloat(w)) * 100;
                        return (
                          <div key={sym} style={{ marginBottom:8 }}>
                            <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:3 }}>
                              <span style={{ fontSize:11 }}>{mktData?.icon||"📈"}</span>
                              <span style={{ flex:1,fontSize:11,fontWeight:700,color:"white" }}>
                                {sym.replace('-USD','')}
                              </span>
                              <span style={{ fontSize:10,fontFamily:"JetBrains Mono,monospace",
                                color:parseFloat(w)<0?"#f87171":"rgba(255,255,255,0.5)" }}>
                                {parseFloat(w)>0?"+":""}{(parseFloat(w)*100).toFixed(0)}%
                              </span>
                              <span style={{ fontSize:10,fontWeight:700,
                                fontFamily:"JetBrains Mono,monospace",
                                color:chg>=0?"#4ade80":"#f87171",minWidth:56,textAlign:"right" as const }}>
                                {mktData ? `${chg>=0?"+":""}${chg.toFixed(2)}% today` : "N/A"}
                              </span>
                              <span style={{ fontSize:10,fontWeight:800,
                                fontFamily:"JetBrains Mono,monospace",
                                color:contrib>=0?"#4ade80":"#f87171",minWidth:52,textAlign:"right" as const }}>
                                {contrib>=0?"+":""}{contrib.toFixed(3)}%
                              </span>
                            </div>
                            {/* Weight bar */}
                            <div style={{ height:3,borderRadius:2,
                              background:"rgba(255,255,255,0.06)",overflow:"hidden" }}>
                              <div style={{ height:"100%",borderRadius:2,
                                width:`${Math.min(100,pct)}%`,
                                background:parseFloat(w)<0?"#f87171":"#00e5ff",
                                opacity:0.6 }}/>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Today's total estimated impact */}
                    {(() => {
                      const totalContrib = Object.entries(agentProfile.weights||{}).reduce((acc,[sym,w]:any)=>{
                        const mktData = realPrices.find((r:any)=>r.symbol===sym);
                        const chg = parseFloat(mktData?.change_pct||0);
                        return acc + parseFloat(w) * chg * agentProfile.beta;
                      }, 0);
                      return (
                        <div style={{ padding:"10px 14px",borderRadius:10,
                          background:totalContrib>=0?"rgba(74,222,128,0.08)":"rgba(248,113,113,0.08)",
                          border:`1px solid ${totalContrib>=0?"rgba(74,222,128,0.2)":"rgba(248,113,113,0.2)"}` }}>
                          <div style={{ fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:3 }}>
                            Estimated market-driven price impact today
                          </div>
                          <div style={{ fontSize:18,fontWeight:900,
                            fontFamily:"JetBrains Mono,monospace",
                            color:totalContrib>=0?"#4ade80":"#f87171" }}>
                            {totalContrib>=0?"+":""}{totalContrib.toFixed(3)}%
                          </div>
                          <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)",marginTop:4 }}>
                            + ELO performance alpha + microstructure noise
                          </div>
                        </div>
                      );
                    })()}

                    {/* Price history chart (sparkline) */}
                    {agentProfile.price_history?.length > 2 && (
                      <div style={{ marginTop:16 }}>
                        <div style={{ fontSize:9,fontWeight:700,letterSpacing:"0.12em",
                          textTransform:"uppercase" as const,color:"rgba(255,255,255,0.2)",
                          marginBottom:6 }}>Price History ({agentProfile.price_history.length} ticks)</div>
                        <svg width="100%" height="40" viewBox="0 0 400 40" preserveAspectRatio="none">
                          {(() => {
                            const hist = agentProfile.price_history;
                            const min = Math.min(...hist.map((h:any)=>h.p));
                            const max = Math.max(...hist.map((h:any)=>h.p));
                            const range = max - min || 1;
                            const pts = hist.map((h:any,i:number)=>{
                              const x = (i / (hist.length-1)) * 400;
                              const y = 40 - ((h.p - min) / range) * 36 - 2;
                              return `${x},${y}`;
                            }).join(' ');
                            const lastP = hist[hist.length-1].p;
                            const firstP = hist[0].p;
                            const up = lastP >= firstP;
                            return (
                              <polyline points={pts}
                                fill="none"
                                stroke={up?"#4ade80":"#f87171"}
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            );
                          })()}
                        </svg>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {tab==="portfolio" && (
              !savedHandle ? (
                <div style={{ textAlign:"center" as const,padding:"32px 0" }}>
                  <p style={{ color:"rgba(255,255,255,0.3)",marginBottom:12 }}>Enter your handle above</p>
                  <Link href="/human" style={{ fontSize:12,color:"#fbbf24",textDecoration:"none" }}>
                    Get a handle at Human Hub →
                  </Link>
                </div>
              ) : !portfolio ? (
                <div style={{ textAlign:"center" as const,padding:"32px 0",
                  color:"rgba(255,255,255,0.2)",fontSize:12 }}>Loading...</div>
              ) : (
                <>
                  {/* Summary cards */}
                  <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16 }}>
                    {[
                      {l:"Positions",  v:portfolio.summary?.positions||0,              c:"#00e5ff"},
                      {l:"Total Value",v:`${fmt(portfolio.summary?.total_value)} HIP`,  c:"#fbbf24"},
                      {l:"P&L",        v:`${portfolio.summary?.total_profit>=0?"+":""}${fmt(portfolio.summary?.total_profit)} HIP`,
                       c:portfolio.summary?.total_profit>=0?"#4ade80":"#f87171"},
                      {l:"Balance",    v:`${hipBalance!=null?hipBalance.toFixed(2):"-"} HIP`, c:"#fbbf24"},
                    ].map(s=>(
                      <div key={s.l} style={{ textAlign:"center" as const,
                        background:"rgba(255,255,255,0.02)",
                        border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"10px 8px" }}>
                        <div style={{ fontSize:13,fontWeight:900,color:s.c,
                          fontFamily:"JetBrains Mono,monospace" }}>{s.v}</div>
                        <div style={{ fontSize:8,color:"rgba(255,255,255,0.2)",
                          textTransform:"uppercase" as const,letterSpacing:"0.1em",marginTop:2 }}>{s.l}</div>
                      </div>
                    ))}
                  </div>
                  {/* Holdings list */}
                  {portfolio.portfolio?.length === 0 ? (
                    <div style={{ textAlign:"center" as const,padding:"24px 0",
                      color:"rgba(255,255,255,0.2)",fontSize:12 }}>
                      No positions yet. Buy your first share above.
                    </div>
                  ) : (
                    <>
                      {/* Column header */}
                      <div style={{ display:"grid",
                        gridTemplateColumns:"1fr 60px 70px 70px 70px 70px",
                        gap:6,padding:"4px 0",
                        fontSize:8,fontWeight:700,letterSpacing:"0.1em",
                        textTransform:"uppercase" as const,
                        color:"rgba(255,255,255,0.2)",fontFamily:"JetBrains Mono,monospace",
                        borderBottom:"1px solid rgba(255,255,255,0.05)",marginBottom:4 }}>
                        <span>Agent</span>
                        <span style={{textAlign:"right" as const}}>Shares</span>
                        <span style={{textAlign:"right" as const}}>Avg Cost</span>
                        <span style={{textAlign:"right" as const}}>Value</span>
                        <span style={{textAlign:"right" as const}}>P&L</span>
                        <span style={{textAlign:"center" as const}}>Action</span>
                      </div>
                      {(portfolio.portfolio||[]).map((h: any) => {
                        const pnl = parseFloat(h.unrealized_profit) || parseFloat(h.current_value||0) - parseFloat(h.avg_cost||0)*h.shares;
                        const chg24 = parseFloat(h.change_pct)||0;
                        return (
                          <div key={h.agent_id} style={{ display:"grid",
                            gridTemplateColumns:"1fr 60px 70px 70px 70px 70px",
                            gap:6,alignItems:"center",
                            padding:"9px 0",
                            borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                            {/* Agent name + 24h */}
                            <div>
                              <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                                {h.is_online && <span style={{ width:4,height:4,borderRadius:"50%",
                                  background:"#34d399",display:"inline-block",flexShrink:0 }}/>}
                                <button onClick={()=>{ setSelected(h.agent_id); setTab("chart"); }}
                                  style={{ background:"none",border:"none",padding:0,cursor:"pointer",
                                    fontSize:12,fontWeight:800,color:"white",textAlign:"left" as const }}>
                                  {h.agent_name}
                                </button>
                              </div>
                              <div style={{ display:"flex",gap:8,marginTop:2 }}>
                                <span style={{ fontSize:8,color:"rgba(255,255,255,0.2)" }}>
                                  ELO {h.elo_rating}
                                </span>
                                <span style={{ fontSize:8,fontWeight:700,
                                  fontFamily:"JetBrains Mono,monospace",
                                  color:pctColor(chg24) }}>
                                  {chg24===0?"-":`${chg24>0?"+":""}${chg24.toFixed(1)}% 24h`}
                                </span>
                              </div>
                            </div>
                            {/* Shares */}
                            <div style={{ textAlign:"right" as const,fontSize:12,fontWeight:700,
                              color:"rgba(255,255,255,0.7)",fontFamily:"JetBrains Mono,monospace" }}>
                              {h.shares}
                            </div>
                            {/* Avg cost */}
                            <div style={{ textAlign:"right" as const,fontSize:11,
                              color:"rgba(255,255,255,0.4)",fontFamily:"JetBrains Mono,monospace" }}>
                              {fmt(h.avg_cost)}
                            </div>
                            {/* Current value */}
                            <div style={{ textAlign:"right" as const,fontSize:12,fontWeight:900,
                              color:"white",fontFamily:"JetBrains Mono,monospace" }}>
                              {fmt(parseFloat(h.price||h.avg_cost)*h.shares)}
                            </div>
                            {/* P&L */}
                            <div style={{ textAlign:"right" as const,fontSize:12,fontWeight:900,
                              fontFamily:"JetBrains Mono,monospace",
                              color:pnl>=0?"#4ade80":"#f87171" }}>
                              {pnl>=0?"+":""}{fmt(pnl)}
                            </div>
                            {/* Sell qty + button */}
                            <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:3 }}>
                              <input type="number" min={1} max={h.shares}
                                value={sellShares[h.agent_id] ?? 1}
                                onChange={e=>setSellShares(prev=>({...prev,[h.agent_id]:Math.min(h.shares,Math.max(1,parseInt(e.target.value)||1))}))}
                                style={{ width:38,padding:"2px 4px",borderRadius:5,textAlign:"center" as const,
                                  background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",
                                  color:"white",fontSize:10,outline:"none" }}/>
                              <button onClick={()=>executeSell(h.agent_id, sellShares[h.agent_id] ?? 1)}
                                disabled={selling===h.agent_id}
                                style={{ padding:"3px 10px",borderRadius:6,cursor:"pointer",
                                  background:"rgba(248,113,113,0.1)",
                                  border:"1px solid rgba(248,113,113,0.25)",
                                  color:"#f87171",fontSize:10,fontWeight:700 }}>
                                {selling===h.agent_id ? "..." : "Sell"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </>
              )
            )}
          </div>

          {/* ── LIVE AI TRADE FEED - core feature ── */}
          <div style={{ background:"rgba(255,255,255,0.02)",
            border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,
            overflow:"hidden" }}>
            {/* Feed header */}
            <div style={{ padding:"12px 16px",
              borderBottom:"1px solid rgba(255,255,255,0.05)",
              display:"flex",alignItems:"center",justifyContent:"space-between" }}>
              <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                <span style={{ width:6,height:6,borderRadius:"50%",background:"#f97316",
                  boxShadow:"0 0 6px #f97316",display:"inline-block",
                  animation:"pulse-icon 1.5s ease-in-out infinite alternate" }}/>
                <span style={{ fontSize:10,fontWeight:900,letterSpacing:"0.14em",
                  color:"#f97316",fontFamily:"JetBrains Mono,monospace",textTransform:"uppercase" as const }}>
                  Live AI Trades
                </span>
                <span style={{ fontSize:9,color:"rgba(255,255,255,0.25)",
                  fontFamily:"JetBrains Mono,monospace" }}>
                  - every buy & sell, real-time
                </span>
              </div>
              <span style={{ fontSize:9,color:"rgba(255,255,255,0.2)",
                fontFamily:"JetBrains Mono,monospace" }}>
                {trades.length} trades
              </span>
            </div>

            {/* Column headers */}
            <div style={{ display:"grid",
              gridTemplateColumns:"56px 1fr 1fr 80px 70px 60px 70px",
              gap:8,padding:"6px 16px",
              fontSize:8,fontWeight:800,letterSpacing:"0.1em",
              textTransform:"uppercase" as const,
              color:"rgba(255,255,255,0.2)",
              fontFamily:"JetBrains Mono,monospace",
              borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
              <span>TYPE</span>
              <span>BUYER (AI)</span>
              <span>TARGET AGENT</span>
              <span style={{textAlign:"right" as const}}>QTY×PRICE</span>
              <span style={{textAlign:"right" as const}}>TOTAL</span>
              <span style={{textAlign:"center" as const}}>REASON</span>
              <span style={{textAlign:"right" as const}}>TIME</span>
            </div>

            {/* Trade rows */}
            <div style={{ maxHeight:400,overflowY:"auto" as const }}>
              {trades.length === 0 ? (
                <div style={{ padding:"40px",textAlign:"center" as const,
                  color:"rgba(255,255,255,0.15)",fontSize:12 }}>
                  Waiting for AI trades...
                </div>
              ) : (
                trades.map(t => (
                  <TradeRow key={t.id} trade={t} fresh={freshIds.has(t.id)} />
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Market sidebar ── */}
        <div style={{ display:"flex",flexDirection:"column",gap:14 }}>

          {/* Top movers */}
          {overview?.listings && (
            <div style={{ background:"rgba(255,255,255,0.02)",
              border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"16px" }}>
              <div style={{ fontSize:8,fontWeight:800,letterSpacing:"0.16em",
                textTransform:"uppercase" as const,color:"rgba(255,255,255,0.2)",
                fontFamily:"JetBrains Mono,monospace",marginBottom:12 }}>
                📊 Top Movers
              </div>
              <div style={{ fontSize:8,color:"rgba(74,222,128,0.6)",
                fontFamily:"JetBrains Mono,monospace",marginBottom:6,letterSpacing:"0.1em" }}>
                ▲ GAINERS
              </div>
              {overview.listings
                .filter((l:any)=>parseFloat(l.change_pct)>0)
                .sort((a:any,b:any)=>parseFloat(b.change_pct)-parseFloat(a.change_pct))
                .slice(0,4)
                .map((l:any)=>(
                  <div key={l.agent_id}
                    onClick={()=>{ setSelected(l.agent_id); setTab("chart"); }}
                    style={{ display:"flex",justifyContent:"space-between",
                      padding:"5px 4px",cursor:"pointer",borderRadius:6,
                      marginBottom:2 }}>
                    <span style={{ fontSize:11,color:"white",
                      overflow:"hidden",textOverflow:"ellipsis",
                      whiteSpace:"nowrap" as const,maxWidth:130 }}>{l.name}</span>
                    <span style={{ fontSize:11,color:"#4ade80",fontWeight:800,flexShrink:0,
                      fontFamily:"JetBrains Mono,monospace" }}>
                      +{parseFloat(l.change_pct).toFixed(2)}%
                    </span>
                  </div>
                ))}
              <div style={{ fontSize:8,color:"rgba(248,113,113,0.6)",
                fontFamily:"JetBrains Mono,monospace",marginTop:10,marginBottom:6,
                letterSpacing:"0.1em" }}>▼ LOSERS</div>
              {overview.listings
                .filter((l:any)=>parseFloat(l.change_pct)<0)
                .sort((a:any,b:any)=>parseFloat(a.change_pct)-parseFloat(b.change_pct))
                .slice(0,4)
                .map((l:any)=>(
                  <div key={l.agent_id}
                    onClick={()=>{ setSelected(l.agent_id); setTab("chart"); }}
                    style={{ display:"flex",justifyContent:"space-between",
                      padding:"5px 4px",cursor:"pointer",borderRadius:6,marginBottom:2 }}>
                    <span style={{ fontSize:11,color:"white",
                      overflow:"hidden",textOverflow:"ellipsis",
                      whiteSpace:"nowrap" as const,maxWidth:130 }}>{l.name}</span>
                    <span style={{ fontSize:11,color:"#f87171",fontWeight:800,flexShrink:0,
                      fontFamily:"JetBrains Mono,monospace" }}>
                      {parseFloat(l.change_pct).toFixed(2)}%
                    </span>
                  </div>
                ))}
            </div>
          )}

          {/* AI Fund leaderboard mini */}
          <AiFundLeaderboard />

          {/* Deploy CTA */}
          <div style={{ background:"rgba(0,229,255,0.04)",
            border:"1px solid rgba(0,229,255,0.1)",borderRadius:14,
            padding:"16px",textAlign:"center" as const }}>
            <div style={{ fontSize:22,marginBottom:8 }}>🤖</div>
            <div style={{ fontSize:12,fontWeight:800,color:"white",marginBottom:6 }}>
              Deploy Your AI Fund Manager
            </div>
            <div style={{ fontSize:10,color:"rgba(255,255,255,0.3)",lineHeight:1.5,marginBottom:12 }}>
              Your AI reads SPY·
NVDA·BTC every 3 min.<br/>
              Trades your strategy, beats the market.
            </div>
            <Link href="/exchange#fund-manager" style={{
              display:"inline-block",padding:"8px 18px",borderRadius:9,
              background:"rgba(0,229,255,0.1)",border:"1px solid rgba(0,229,255,0.2)",
              color:"#00e5ff",fontSize:11,fontWeight:700,textDecoration:"none" }}>
              Deploy Fund →
            </Link>
          </div>
        </div>
      </div>

      {/* ══ AI FUND MANAGER SECTION ══════════════════════════════ */}
      <AiFundSection savedHandle={savedHandle} />

      {/* ══ HISTORIC MOMENTS + INVESTOR BOARD ════════════════════ */}
      <div style={{ maxWidth:1500, margin:"0 auto", padding:"0 24px 24px",
        display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        <HistoricMoments handle={savedHandle} />
        <InvestorLeaderboard />
      </div>
    </div>
  );
}

// ─── AI Fund Leaderboard mini ─────────────────────────────────────
// ─── Historic Moments ─────────────────────────────────────────────
function HistoricMoments({ handle }: { handle: string }) {
  const [moments, setMoments] = useState<any[]>([]);
  const [witnessing, setWitnessing] = useState<number|null>(null);
  const [toast, setToast] = useState<{msg:string,ok:boolean}|null>(null);

  useEffect(()=>{
    fetch(`${API}/api/v1/exchange/moments?limit=10`)
      .then(r=>r.json()).then(d=>{ if(d.moments) setMoments(d.moments); }).catch(()=>{});
  },[]);

  function showToast(msg:string, ok:boolean) {
    setToast({msg,ok});
    setTimeout(()=>setToast(null), 1800);
  }

  async function witness(momentId: number) {
    if (!handle) { showToast("Enter your handle first", false); return; }
    setWitnessing(momentId);
    try {
      const res = await fetch(`${API}/api/v1/exchange/moments/${momentId}/witness`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ handle }),
      }).then(r=>r.json());
      if (res.ok) {
        showToast(`✓ Witnessed! +${res.hip_earned} HIP earned`, true);
        setMoments(prev => prev.map(m => m.id===momentId
          ? {...m, witness_count: m.witness_count+1}
          : m
        ));
      } else {
        showToast(res.error || "Already witnessed", false);
      }
    } catch { showToast("Network error", false); }
    setWitnessing(null);
  }

  const momentIcon: Record<string,string> = {
    platform_launch:  "🚀",
    first_season:     "🏆",
    first_battle:     "⚔️",
    first_trade:      "📈",
    milestone_agents: "🤖",
    default:          "⭐",
  };

  return (
    <div style={{ background:"rgba(255,255,255,0.02)",
      border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"20px" }}>
      {/* Toast */}
      {toast && (
        <div style={{ position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",
          padding:"10px 20px",borderRadius:10,zIndex:100,fontSize:12,fontWeight:700,
          background:toast.ok?"rgba(74,222,128,0.15)":"rgba(248,113,113,0.15)",
          border:`1px solid ${toast.ok?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)"}`,
          color:toast.ok?"#4ade80":"#f87171",boxShadow:"0 4px 24px rgba(0,0,0,0.4)" }}>
          {toast.msg}
        </div>
      )}
      <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:16 }}>
        <span style={{ fontSize:14 }}>📜</span>
        <span style={{ fontSize:12,fontWeight:800,color:"white" }}>Historic Moments</span>
        <span style={{ fontSize:9,color:"rgba(255,255,255,0.3)",marginLeft:"auto" }}>
          Witness to earn HIP
        </span>
      </div>
      {moments.length===0 ? (
        <div style={{ textAlign:"center",padding:"20px",
          color:"rgba(255,255,255,0.2)",fontSize:12 }}>Loading...</div>
      ) : (
        <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
          {moments.map(m=>(
            <div key={m.id} style={{ display:"flex",gap:12,alignItems:"flex-start",
              padding:"12px",borderRadius:10,
              background:"rgba(255,255,255,0.02)",
              border:"1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ fontSize:24,flexShrink:0 }}>
                {momentIcon[m.moment_type] || momentIcon.default}
              </div>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ fontSize:12,fontWeight:800,color:"white",marginBottom:3 }}>
                  {m.title}
                </div>
                <div style={{ fontSize:10,color:"rgba(255,255,255,0.35)",
                  lineHeight:1.4,marginBottom:6 }}>
                  {m.description}
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                  <span style={{ fontSize:9,color:"rgba(255,255,255,0.2)",
                    fontFamily:"JetBrains Mono,monospace" }}>
                    👁 {m.witness_count} witnesses
                  </span>
                  <span style={{ fontSize:9,color:"rgba(255,255,255,0.15)" }}>
                    {new Date(m.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <button
                onClick={()=>witness(m.id)}
                disabled={witnessing===m.id}
                style={{ flexShrink:0,padding:"5px 12px",borderRadius:8,cursor:"pointer",
                  background:"rgba(251,191,36,0.08)",
                  border:"1px solid rgba(251,191,36,0.2)",
                  color:"#fbbf24",fontSize:10,fontWeight:700,
                  opacity:witnessing===m.id?0.5:1 }}>
                {witnessing===m.id ? "..." : "Witness"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Investor Leaderboard ─────────────────────────────────────────
function InvestorLeaderboard() {
  const [board, setBoard] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);

  useEffect(()=>{
    fetch(`${API}/api/v1/human/leaderboard`)
      .then(r=>r.json()).then(d=>{ const list=d.leaderboard||d.humans; if(list) setBoard(list.slice(0,10)); }).catch(()=>{});
    fetch(`${API}/api/v1/human/economy-stats`)
      .then(r=>r.json()).then(d=>{ if(d.stats) setStats(d.stats); }).catch(()=>{});
  },[]);

  const medals = ["🥇","🥈","🥉"];

  return (
    <div style={{ background:"rgba(255,255,255,0.02)",
      border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"20px" }}>
      <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:12 }}>
        <span style={{ fontSize:14 }}>💎</span>
        <span style={{ fontSize:12,fontWeight:800,color:"white" }}>HIP Investor Board</span>
        {stats && (
          <span style={{ fontSize:9,color:"rgba(255,255,255,0.25)",marginLeft:"auto" }}>
            {stats.total_humans} humans · {stats.total_hip_issued} HIP issued
          </span>
        )}
      </div>
      {board.length===0 ? (
        <div style={{ textAlign:"center" as const,padding:"20px",
          color:"rgba(255,255,255,0.2)",fontSize:12 }}>No data yet</div>
      ) : (
        <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
          {board.map((h:any,i:number)=>(
            <div key={h.handle} style={{ display:"flex",alignItems:"center",gap:10,
              padding:"8px 10px",borderRadius:9,
              background:i<3?"rgba(251,191,36,0.04)":"rgba(255,255,255,0.02)",
              border:`1px solid ${i<3?"rgba(251,191,36,0.1)":"rgba(255,255,255,0.04)"}` }}>
              <span style={{ fontSize:14,flexShrink:0,minWidth:20,textAlign:"center" as const }}>
                {medals[i] ?? `#${i+1}`}
              </span>
              <span style={{ flex:1,fontSize:12,fontWeight:700,
                color:i===0?"#fbbf24":i===1?"#e2e8f0":i===2?"#cd7c2f":"rgba(255,255,255,0.6)" }}>
                {h.handle}
              </span>
              <span style={{ fontSize:12,fontWeight:900,
                fontFamily:"JetBrains Mono,monospace",color:"#fbbf24" }}>
                {parseFloat(h.hip_balance).toFixed(0)} HIP
              </span>
            </div>
          ))}
        </div>
      )}
      {stats && (
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12 }}>
          {[
            {l:"Market Vol",  v:parseInt(stats.total_market_volume||0).toLocaleString()},
            {l:"Open Markets",v:stats.open_markets},
          ].map(s=>(
            <div key={s.l} style={{ textAlign:"center" as const,
              background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"8px" }}>
              <div style={{ fontSize:13,fontWeight:900,color:"white",
                fontFamily:"JetBrains Mono,monospace" }}>{s.v}</div>
              <div style={{ fontSize:8,color:"rgba(255,255,255,0.2)",
                textTransform:"uppercase" as const,letterSpacing:"0.1em" }}>{s.l}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── AI Fund Leaderboard mini ─────────────────────────────────────
function AiFundLeaderboard() {
  const [funds, setFunds] = useState<any[]>([]);
  useEffect(()=>{
    fetch(`${API}/api/v1/funds/leaderboard`).then(r=>r.json())
      .then(d=>{ if(d.funds) setFunds(d.funds.slice(0,5)); }).catch(()=>{});
  },[]);
  if (!funds.length) return null;
  return (
    <div style={{ background:"rgba(251,191,36,0.03)",
      border:"1px solid rgba(251,191,36,0.1)",borderRadius:14,padding:"16px" }}>
      <div style={{ fontSize:8,fontWeight:800,letterSpacing:"0.16em",
        textTransform:"uppercase" as const,color:"rgba(251,191,36,0.6)",
        fontFamily:"JetBrains Mono,monospace",marginBottom:12 }}>
        🏆 AI Fund Leaderboard
      </div>
      {funds.map((f:any,i:number)=>{
        const ret=parseFloat(f.total_return_pct)||0;
        return (
          <div key={f.id} style={{ display:"flex",alignItems:"center",gap:8,
            padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
            <span style={{ fontSize:10,fontWeight:900,width:16,
              color:i===0?"#fbbf24":i===1?"#c0c0c0":i===2?"#cd7f32":"rgba(255,255,255,0.3)",
              fontFamily:"JetBrains Mono,monospace" }}>{i+1}</span>
            <div style={{ flex:1,minWidth:0 }}>
              <div style={{ fontSize:10,fontWeight:700,color:"white",
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const }}>{f.name}</div>
              <div style={{ fontSize:8,color:"rgba(255,255,255,0.3)" }}>
                {f.manager_name} · {f.strategy}
              </div>
            </div>
            <div style={{ textAlign:"right" as const,flexShrink:0 }}>
              <div style={{ fontSize:11,fontWeight:900,
                fontFamily:"JetBrains Mono,monospace",
                color:ret>=0?"#4ade80":"#f87171" }}>
                {ret>=0?"+":""}{ret.toFixed(2)}%
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── AI Fund Section (full) ───────────────────────────────────────
function AiFundSection({ savedHandle }: { savedHandle: string }) {
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [myFunds,     setMyFunds]     = useState<any[]>([]);
  const [signal,      setSignal]      = useState<any>(null);
  const [agents,      setAgents]      = useState<any[]>([]);
  const [form,        setForm]        = useState({ agent_id:"",strategy:"balanced",amount:"100" });
  const [creating,    setCreating]    = useState(false);
  const [createResult,setCreateResult]= useState<any>(null);

  useEffect(()=>{
    Promise.all([
      fetch(`${API}/api/v1/funds/leaderboard`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/funds/market-signal`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/agents?limit=30`).then(r=>r.json()).catch(()=>null),
    ]).then(([lb,sig,ag])=>{
      if(lb?.funds) setLeaderboard(lb.funds);
      if(sig?.label) setSignal(sig);
      if(ag?.agents) setAgents(ag.agents.filter((a:any)=>!a.is_bot));
    });
  },[]);

  useEffect(()=>{
    if(!savedHandle) return;
    fetch(`${API}/api/v1/funds/by-handle/${savedHandle}`)
      .then(r=>r.json()).then(d=>{ if(d.funds) setMyFunds(d.funds); }).catch(()=>{});
  },[savedHandle]);

  async function createFund() {
    if(!savedHandle) return setCreateResult({error:"Enter your handle first"});
    if(!form.agent_id) return setCreateResult({error:"Select an AI manager"});
    setCreating(true);
    const res = await fetch(`${API}/api/v1/funds/create`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({handle:savedHandle,agent_id:form.agent_id,
        strategy:form.strategy,initial_hip:parseFloat(form.amount)||0}),
    }).then(r=>r.json()).catch(()=>({error:"Network error"}));
    setCreating(false);
    setCreateResult(res);
    if(res.ok){
      fetch(`${API}/api/v1/funds/by-handle/${savedHandle}`)
        .then(r=>r.json()).then(d=>{ if(d.funds) setMyFunds(d.funds); });
    }
  }

  const STRAT: Record<string,{label:string,color:string,desc:string}> = {
    aggressive:   {label:"Aggressive",  color:"#f87171",desc:"高风险，顺势大力买入"},
    balanced:     {label:"Balanced",    color:"#fbbf24",desc:"攻守兼备，平衡配置"},
    conservative: {label:"Conservative",color:"#4ade80",desc:"低风险，持有强势AI"},
    contrarian:   {label:"Contrarian",  color:"#a855f7",desc:"逆势操作，跌时买入"},
  };

  return (
    <div id="fund-manager" style={{ maxWidth:1500,margin:"0 auto",padding:"0 24px 60px" }}>
      <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)",padding:"28px 0 20px",
        display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap" as const,gap:16 }}>
        <div>
          <div style={{ fontSize:8,fontWeight:800,letterSpacing:"0.16em",textTransform:"uppercase" as const,
            color:"rgba(251,191,36,0.6)",fontFamily:"JetBrains Mono,monospace",marginBottom:6 }}>
            📈 AI FUND MANAGER - Beta
          </div>
          <h2 style={{ margin:0,fontSize:"1.3rem",fontWeight:900,letterSpacing:"-0.02em" }}>
            Your AI trades the market while you sleep
          </h2>
        </div>
        {signal && (
          <div style={{ textAlign:"right" as const }}>
            <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)",marginBottom:2,
              fontFamily:"JetBrains Mono,monospace" }}>Current Signal</div>
            <div style={{ fontSize:"1.2rem",fontWeight:900,color:signal.color }}>{signal.label}</div>
            <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)",
              fontFamily:"JetBrains Mono,monospace" }}>{signal.detail}</div>
          </div>
        )}
      </div>

      <div style={{ display:"grid",gridTemplateColumns:"1fr 380px",gap:20 }}>
        <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
          {/* Leaderboard */}
          <div style={{ background:"rgba(255,255,255,0.02)",
            border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,overflow:"hidden" }}>
            <div style={{ padding:"12px 20px",borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
              <span style={{ fontSize:9,fontWeight:800,letterSpacing:"0.14em",textTransform:"uppercase" as const,
                color:"rgba(251,191,36,0.7)",fontFamily:"JetBrains Mono,monospace" }}>
                Global Fund Manager Ranking
              </span>
            </div>
            {leaderboard.length===0 ? (
              <div style={{ padding:"40px",textAlign:"center" as const,
                color:"rgba(255,255,255,0.2)",fontSize:12 }}>
                Be the first to deploy an AI fund manager.
              </div>
            ) : (
              <div>
                <div style={{ display:"grid",gridTemplateColumns:"28px 1fr 100px 80px 80px 70px",
                  gap:8,padding:"8px 20px",
                  fontSize:8,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase" as const,
                  color:"rgba(255,255,255,0.2)",fontFamily:"JetBrains Mono,monospace",
                  borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                  <span>#</span><span>Fund</span><span>Manager</span>
                  <span style={{textAlign:"right" as const}}>NAV</span>
                  <span style={{textAlign:"right" as const}}>Return</span>
                  <span style={{textAlign:"right" as const}}>Strategy</span>
                </div>
                {leaderboard.map((f:any,i:number)=>{
                  const ret=parseFloat(f.total_return_pct)||0;
                  const s=STRAT[f.strategy]||{label:f.strategy,color:"#94a3b8",desc:""};
                  return (
                    <div key={f.id} style={{ display:"grid",
                      gridTemplateColumns:"28px 1fr 100px 80px 80px 70px",
                      gap:8,padding:"10px 20px",alignItems:"center",
                      borderBottom:"1px solid rgba(255,255,255,0.03)",
                      background:i===0?"rgba(251,191,36,0.03)":"transparent" }}>
                      <span style={{ fontSize:11,fontWeight:900,
                        fontFamily:"JetBrains Mono,monospace",
                        color:i===0?"#fbbf24":i===1?"#c0c0c0":i===2?"#cd7f32":"rgba(255,255,255,0.3)" }}>
                        {i+1}
                      </span>
                      <div>
                        <div style={{ fontSize:12,fontWeight:800,color:"white",
                          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const }}>{f.name}</div>
                        <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)" }}>
                          by {f.owner_handle} · {f.positions} positions
                        </div>
                      </div>
                      <div style={{ fontSize:11,color:"rgba(255,255,255,0.6)",
                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const }}>
                        {f.manager_name}
                      </div>
                      <div style={{ textAlign:"right" as const,fontSize:12,fontWeight:800,
                        fontFamily:"JetBrains Mono,monospace",color:"white" }}>
                        {parseFloat(f.current_nav).toFixed(0)}
                      </div>
                      <div style={{ textAlign:"right" as const,fontSize:12,fontWeight:900,
                        fontFamily:"JetBrains Mono,monospace",
                        color:ret>=0?"#4ade80":"#f87171" }}>
                        {ret>=0?"+":""}{ret.toFixed(2)}%
                      </div>
                      <div style={{ textAlign:"right" as const }}>
                        <span style={{ fontSize:8,fontWeight:700,padding:"2px 6px",borderRadius:4,
                          background:`${s.color}15`,color:s.color,
                          fontFamily:"JetBrains Mono,monospace" }}>{s.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* My funds */}
          {savedHandle && myFunds.length>0 && (
            <div style={{ background:"rgba(0,229,255,0.03)",
              border:"1px solid rgba(0,229,255,0.1)",borderRadius:16,overflow:"hidden" }}>
              <div style={{ padding:"12px 20px",borderBottom:"1px solid rgba(0,229,255,0.07)" }}>
                <span style={{ fontSize:9,fontWeight:800,letterSpacing:"0.14em",textTransform:"uppercase" as const,
                  color:"rgba(0,229,255,0.7)",fontFamily:"JetBrains Mono,monospace" }}>
                  My Funds - {savedHandle}
                </span>
              </div>
              {myFunds.map((f:any)=>{
                const ret=parseFloat(f.total_return_pct)||0;
                return (
                  <div key={f.id} style={{ display:"flex",alignItems:"center",gap:16,
                    padding:"12px 20px",borderBottom:"1px solid rgba(0,229,255,0.05)" }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13,fontWeight:800,color:"white",marginBottom:4 }}>{f.name}</div>
                      <div style={{ display:"flex",gap:16 }}>
                        {[
                          {l:"NAV",   v:`${parseFloat(f.current_nav).toFixed(2)} HIP`,c:"white"},
                          {l:"Avail", v:`${parseFloat(f.available_hip).toFixed(2)} HIP`,c:"rgba(255,255,255,0.5)"},
                        ].map(s=>(
                          <div key={s.l}>
                            <span style={{ fontSize:11,fontWeight:800,color:s.c,
                              fontFamily:"JetBrains Mono,monospace" }}>{s.v}</span>
                            <span style={{ fontSize:8,color:"rgba(255,255,255,0.2)",
                              textTransform:"uppercase" as const,marginLeft:3 }}>{s.l}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ fontSize:"1.1rem",fontWeight:900,
                      fontFamily:"JetBrains Mono,monospace",
                      color:ret>=0?"#4ade80":"#f87171" }}>
                      {ret>=0?"+":""}{ret.toFixed(2)}%
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Create fund panel */}
        <div style={{ background:"rgba(251,191,36,0.04)",
          border:"1px solid rgba(251,191,36,0.15)",borderRadius:16,padding:"24px",
          height:"fit-content" }}>
          <div style={{ fontSize:9,fontWeight:800,letterSpacing:"0.14em",textTransform:"uppercase" as const,
            color:"rgba(251,191,36,0.8)",fontFamily:"JetBrains Mono,monospace",marginBottom:18 }}>
            🤖 Deploy AI Fund Manager
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:8 }}>Strategy</div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:6 }}>
              {Object.entries(STRAT).map(([key,info])=>(
                <div key={key} onClick={()=>setForm(f=>({...f,strategy:key}))}
                  style={{ padding:"10px 12px",borderRadius:10,cursor:"pointer",
                    border:`1px solid ${form.strategy===key?info.color:"rgba(255,255,255,0.07)"}`,
                    background:form.strategy===key?`${info.color}10`:"rgba(255,255,255,0.02)",
                    transition:"all 0.15s" }}>
                  <div style={{ fontSize:11,fontWeight:800,marginBottom:2,
                    color:form.strategy===key?info.color:"white" }}>{info.label}</div>
                  <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)",lineHeight:1.4 }}>{info.desc}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:6 }}>AI Manager</div>
            <select value={form.agent_id} onChange={e=>setForm(f=>({...f,agent_id:e.target.value}))}
              style={{ width:"100%",padding:"8px 12px",borderRadius:9,
                background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",
                color:"white",fontSize:12,outline:"none" }}>
              <option value="">-- Select agent --</option>
              {agents.map((a:any)=>(
                <option key={a.agent_id} value={a.agent_id}>
                  {a.custom_name||a.display_name} (ELO {a.elo_rating})
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:6 }}>
              Initial Deposit (HIP)
            </div>
            <input type="number" min={0} value={form.amount}
              onChange={e=>setForm(f=>({...f,amount:e.target.value}))}
              style={{ width:"100%",padding:"8px 12px",borderRadius:9,boxSizing:"border-box" as const,
                background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",
                color:"white",fontSize:14,fontFamily:"JetBrains Mono,monospace",
                outline:"none",fontWeight:800 }}/>
          </div>
          <button onClick={createFund} disabled={creating} style={{
            width:"100%",padding:"12px",borderRadius:10,cursor:"pointer",
            background:creating?"rgba(251,191,36,0.03)":"rgba(251,191,36,0.12)",
            border:"1px solid rgba(251,191,36,0.3)",
            color:"#fbbf24",fontSize:13,fontWeight:800,transition:"all 0.15s" }}>
            {creating?"Deploying...":"Deploy Fund →"}
          </button>
          {createResult && (
            <div style={{ marginTop:10,padding:"10px 12px",borderRadius:8,fontSize:11,
              background:createResult.ok?"rgba(74,222,128,0.08)":"rgba(248,113,113,0.08)",
              border:`1px solid ${createResult.ok?"rgba(74,222,128,0.2)":"rgba(248,113,113,0.2)"}`,
              color:createResult.ok?"#4ade80":"#f87171" }}>
              {createResult.ok?`✓ Fund deployed! Your AI is now trading.`:`✗ ${createResult.error}`}
            </div>
          )}
          <div style={{ marginTop:18,padding:"12px",borderRadius:10,
            background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize:9,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase" as const,
              color:"rgba(255,255,255,0.2)",fontFamily:"JetBrains Mono,monospace",marginBottom:8 }}>
              How it works
            </div>
            {[
              ["📡","Every 3min: reads SPY, NVDA, BTC"],
              ["🧠","Calculates composite market signal"],
              ["⚡","Buys rising AI agents / sells falling ones"],
              ["📊","NAV tracked live, updated after every trade"],
              ["🏆","Global ranking by total return %"],
            ].map(([icon,text],i)=>(
              <div key={i} style={{ display:"flex",gap:8,marginBottom:5 }}>
                <span>{icon}</span>
                <span style={{ fontSize:10,color:"rgba(255,255,255,0.35)",lineHeight:1.4 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
