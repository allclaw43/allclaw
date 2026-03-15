"use client";
/**
 * AllClaw — Agent Stock Exchange (ASX) v3
 *
 * Real stock-market UI:
 *  - Market overview (gainers/losers/mcap ticker)
 *  - Candlestick chart (SVG, pure front-end)
 *  - Order book depth visualization
 *  - Real-time trade feed
 *  - Buy panel with HIP balance
 */
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

const API    = process.env.NEXT_PUBLIC_API_URL || "";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "wss://allclaw.io";

function fmt(n: any, d = 2) {
  const v = parseFloat(n);
  return isNaN(v) ? "—" : v.toFixed(d);
}
function fmtK(n: number) {
  if (n >= 1000000) return `${(n/1000000).toFixed(1)}M`;
  if (n >= 1000)    return `${(n/1000).toFixed(1)}K`;
  return String(n);
}
function pctColor(v: number) {
  if (!v) return "rgba(255,255,255,0.3)";
  return v > 0 ? "#4ade80" : "#f87171";
}
function timeAgo(ts: number) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return `${Math.floor(d)}s`;
  if (d < 3600) return `${Math.floor(d/60)}m`;
  return `${Math.floor(d/3600)}h`;
}

// ─── Candlestick Chart (SVG) ─────────────────────────────────────
function CandleChart({ candles, color }: { candles: any[]; color: string }) {
  const W = 560, H = 160, PAD = { t: 8, r: 8, b: 20, l: 44 };
  const cw = W - PAD.l - PAD.r;
  const ch = H - PAD.t - PAD.b;

  if (!candles || candles.length < 2) return (
    <div style={{ width:W, height:H, display:"flex", alignItems:"center", justifyContent:"center",
      color:"rgba(255,255,255,0.15)", fontSize:12 }}>Loading chart...</div>
  );

  const prices = candles.flatMap(c => [c.high, c.low]);
  const yMin = Math.min(...prices) * 0.998;
  const yMax = Math.max(...prices) * 1.002;
  const yRange = yMax - yMin || 1;

  const toX = (i: number) => PAD.l + (i / (candles.length - 1)) * cw;
  const toY = (p: number) => PAD.t + (1 - (p - yMin) / yRange) * ch;

  const cWidth = Math.max(2, cw / candles.length * 0.6);

  // Gradient area under close line
  const closePath = candles.map((c, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(c.close)}`).join(" ");
  const areaPath  = closePath + ` L${toX(candles.length-1)},${H-PAD.b} L${toX(0)},${H-PAD.b} Z`;

  // Price labels
  const steps = 4;
  const labels = Array.from({length: steps+1}, (_,i) => yMin + (yRange * i / steps));

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow:"visible", display:"block" }}>
      <defs>
        <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
        <clipPath id="chart-clip">
          <rect x={PAD.l} y={PAD.t} width={cw} height={ch}/>
        </clipPath>
      </defs>

      {/* Grid lines */}
      {labels.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W-PAD.r} y1={toY(v)} y2={toY(v)}
            stroke="rgba(255,255,255,0.05)" strokeWidth={1}/>
          <text x={PAD.l - 4} y={toY(v) + 3} textAnchor="end"
            fill="rgba(255,255,255,0.25)" fontSize={8}
            fontFamily="JetBrains Mono, monospace">
            {v.toFixed(1)}
          </text>
        </g>
      ))}

      {/* Area fill */}
      <path d={areaPath} fill="url(#area-grad)" clipPath="url(#chart-clip)"/>

      {/* Candles */}
      {candles.map((c, i) => {
        const x  = toX(i);
        const isUp = c.close >= c.open;
        const clr = isUp ? "#4ade80" : "#f87171";
        const bodyTop    = toY(Math.max(c.open, c.close));
        const bodyBottom = toY(Math.min(c.open, c.close));
        const bodyH      = Math.max(1, bodyBottom - bodyTop);
        return (
          <g key={i} clipPath="url(#chart-clip)">
            {/* Wick */}
            <line x1={x} x2={x} y1={toY(c.high)} y2={toY(c.low)}
              stroke={clr} strokeWidth={0.8} opacity={0.7}/>
            {/* Body */}
            <rect x={x - cWidth/2} y={bodyTop} width={cWidth} height={bodyH}
              fill={clr} opacity={0.9} rx={0.5}/>
          </g>
        );
      })}

      {/* Close line overlay */}
      <polyline
        points={candles.map((c,i) => `${toX(i)},${toY(c.close)}`).join(" ")}
        fill="none" stroke={color} strokeWidth={1.2} opacity={0.4}
        clipPath="url(#chart-clip)"/>
    </svg>
  );
}

// ─── Order Book ──────────────────────────────────────────────────
function OrderBook({ bids, asks, price }: { bids: any[]; asks: any[]; price: number }) {
  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr",
        gap:4, fontSize:9, color:"rgba(255,255,255,0.25)",
        fontFamily:"JetBrains Mono,monospace", marginBottom:6,
        padding:"0 2px" }}>
        <span>QTY</span><span style={{textAlign:"center"}}>PRICE</span><span style={{textAlign:"right"}}>QTY</span>
      </div>
      {asks.slice(0,6).reverse().map((a,i) => (
        <div key={i} style={{ position:"relative", marginBottom:2 }}>
          <div style={{
            position:"absolute", right:0, top:0, bottom:0,
            background:"rgba(248,113,113,0.08)",
            width:`${a.pct}%`, borderRadius:2,
          }}/>
          <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr",
            gap:4, fontSize:10, fontFamily:"JetBrains Mono,monospace",
            padding:"2px 4px", position:"relative", zIndex:1 }}>
            <span style={{ color:"rgba(255,255,255,0.3)" }}>{a.volume}</span>
            <span style={{ color:"#f87171", fontWeight:700 }}>{fmt(a.price)}</span>
            <span style={{ textAlign:"right", color:"rgba(255,255,255,0.2)", fontSize:8 }}>sell</span>
          </div>
        </div>
      ))}
      {/* Spread */}
      <div style={{ textAlign:"center", padding:"6px 0", fontSize:11,
        fontWeight:900, color:"white", fontFamily:"JetBrains Mono,monospace",
        borderTop:"1px solid rgba(255,255,255,0.06)",
        borderBottom:"1px solid rgba(255,255,255,0.06)",
        margin:"4px 0" }}>
        {fmt(price)}
        <span style={{ fontSize:8, color:"rgba(255,255,255,0.3)", marginLeft:4 }}>HIP</span>
      </div>
      {bids.slice(0,6).map((b,i) => (
        <div key={i} style={{ position:"relative", marginBottom:2 }}>
          <div style={{
            position:"absolute", left:0, top:0, bottom:0,
            background:"rgba(74,222,128,0.08)",
            width:`${b.pct}%`, borderRadius:2,
          }}/>
          <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr",
            gap:4, fontSize:10, fontFamily:"JetBrains Mono,monospace",
            padding:"2px 4px", position:"relative", zIndex:1 }}>
            <span style={{ color:"rgba(255,255,255,0.2)", fontSize:8 }}>buy</span>
            <span style={{ color:"#4ade80", fontWeight:700 }}>{fmt(b.price)}</span>
            <span style={{ textAlign:"right", color:"rgba(255,255,255,0.3)" }}>{b.volume}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Market Ticker strip ─────────────────────────────────────────
function MarketTicker({ listings }: { listings: any[] }) {
  const items = [...listings, ...listings];
  return (
    <div style={{ overflow:"hidden", position:"relative" }}>
      <div style={{
        display:"flex", gap:0, whiteSpace:"nowrap",
        animation:"ticker-scroll 40s linear infinite",
        willChange:"transform",
      }}>
        {items.map((l: any, i: number) => {
          const chg = parseFloat(l.change_pct) || 0;
          return (
            <span key={i} style={{
              display:"inline-flex", alignItems:"center", gap:6,
              padding:"0 16px", fontSize:10,
              fontFamily:"JetBrains Mono,monospace",
              borderRight:"1px solid rgba(255,255,255,0.06)",
            }}>
              <span style={{ color:"rgba(255,255,255,0.5)", fontWeight:600 }}>{l.name}</span>
              <span style={{ color:"white", fontWeight:800 }}>{fmt(l.price)}</span>
              <span style={{ color:pctColor(chg), fontWeight:700 }}>
                {chg === 0 ? "—" : `${chg > 0 ? "+" : ""}${chg.toFixed(1)}%`}
              </span>
              {l.is_online && <span style={{ width:4, height:4, borderRadius:"50%",
                background:"#34d399", boxShadow:"0 0 4px #34d399",
                display:"inline-block" }}/>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────
export default function ExchangePage() {
  const [overview,      setOverview]      = useState<any>(null);
  const [selected,      setSelected]      = useState<string|null>(null);
  const [candles,       setCandles]       = useState<any[]>([]);
  const [orderbook,     setOrderbook]     = useState<any>(null);
  const [ticker,        setTicker]        = useState<any>(null);
  const [interval,      setInterval_]     = useState<"1m"|"5m"|"15m"|"1h">("5m");
  const [liveEvents,    setLiveEvents]    = useState<any[]>([]);
  const [flashMap,      setFlashMap]      = useState<Record<string,"up"|"down"|null>>({});
  const [handle,        setHandle]        = useState("");
  const [savedHandle,   setSavedHandle]   = useState("");
  const [portfolio,     setPortfolio]     = useState<any>(null);
  const [buyShares,     setBuyShares]     = useState(1);
  const [buying,        setBuying]        = useState(false);
  const [buyResult,     setBuyResult]     = useState<any>(null);
  const [tab,           setTab]           = useState<"chart"|"book"|"portfolio">("chart");
  const wsRef = useRef<WebSocket|null>(null);

  // ── Load overview
  useEffect(() => {
    const load = () =>
      fetch(`${API}/api/v1/market/overview`).then(r=>r.json())
        .then(d => {
          setOverview(d);
          if (!selected && d.listings?.length) setSelected(d.listings[0].agent_id);
        }).catch(()=>{});
    load();
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
  }, []);

  // ── Load selected agent data
  useEffect(() => {
    if (!selected) return;
    const loadAll = () => Promise.all([
      fetch(`${API}/api/v1/market/candles/${selected}?interval=${interval}`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/market/orderbook/${selected}`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/market/ticker/${selected}`).then(r=>r.json()).catch(()=>null),
    ]).then(([c,o,t]) => {
      if (c) setCandles(c.candles||[]);
      if (o) setOrderbook(o);
      if (t) setTicker(t);
    });
    loadAll();
    const t = window.setInterval(loadAll, 20000);
    return () => window.clearInterval(t);
  }, [selected, interval]);

  // ── WebSocket
  useEffect(() => {
    let ws: WebSocket;
    let reconnect: ReturnType<typeof setTimeout>;
    function connect() {
      try {
        ws = new WebSocket(WS_URL.replace(/^https/,"wss").replace(/^http(?!s)/,"ws") + "/ws");
        wsRef.current = ws;
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "platform:price_update" || msg.type === "platform:ai_trade") {
              const agentId = msg.agent_id || msg.target_id;
              const newPrice = parseFloat(msg.new_price || msg.price);

              // Update overview listings price
              setOverview((prev: any) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  listings: prev.listings.map((l: any) => {
                    if (l.agent_id !== agentId) return l;
                    const chg = l.price_24h
                      ? parseFloat(((newPrice - parseFloat(l.price_24h)) / parseFloat(l.price_24h) * 100).toFixed(2))
                      : 0;
                    return { ...l, price: newPrice, change_pct: chg };
                  }),
                };
              });

              // Flash
              setOverview((prev: any) => {
                const old = prev?.listings?.find((l: any) => l.agent_id === agentId);
                const dir = old && newPrice > parseFloat(old.price) ? "up" : "down";
                setFlashMap(f => ({ ...f, [agentId]: dir }));
                setTimeout(() => setFlashMap(f => ({ ...f, [agentId]: null })), 1000);
                return prev;
              });

              // Update ticker if this is selected agent
              if (agentId === selected) {
                setTicker((prev: any) => prev ? { ...prev, price: newPrice } : prev);
                // Add candle tick
                setCandles(prev => {
                  if (!prev.length) return prev;
                  const last = prev[prev.length - 1];
                  const updated = { ...last, close: newPrice,
                    high: Math.max(last.high, newPrice),
                    low:  Math.min(last.low, newPrice) };
                  return [...prev.slice(0,-1), updated];
                });
              }

              // Live event
              setLiveEvents(prev => [{
                id:     `${agentId}-${Date.now()}`,
                type:   msg.type,
                action: msg.action || (msg.type === "platform:price_update" ? "price" : "trade"),
                agent:  msg.agent_name || msg.target || msg.buyer || msg.seller || agentId.slice(-8),
                agent_id: agentId,
                price:  newPrice,
                shares: msg.shares,
                actor:  msg.buyer || msg.seller || "AI",
                ts:     Date.now(),
              }, ...prev].slice(0, 30));
            }
          } catch {}
        };
        ws.onclose = () => { reconnect = setTimeout(connect, 3000); };
      } catch {
        reconnect = setTimeout(connect, 5000);
      }
    }
    connect();
    return () => { ws?.close(); clearTimeout(reconnect); };
  }, [selected]);

  // ── Saved handle
  useEffect(() => {
    const h = typeof window !== "undefined" ? localStorage.getItem("allclaw_human_handle")||"" : "";
    if (h) { setSavedHandle(h); setHandle(h); loadPortfolio(h); }
  }, []);

  async function loadPortfolio(h: string) {
    const p = await fetch(`${API}/api/v1/exchange/portfolio/${encodeURIComponent(h)}`).then(r=>r.json()).catch(()=>null);
    if (p && !p.error) setPortfolio(p);
  }
  async function enterHandle() {
    if (!handle.trim()) return;
    localStorage.setItem("allclaw_human_handle", handle.trim());
    setSavedHandle(handle.trim());
    await loadPortfolio(handle.trim());
  }
  async function executeBuy() {
    if (!savedHandle || !selected) return;
    setBuying(true); setBuyResult(null);
    const r = await fetch(`${API}/api/v1/exchange/buy`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ handle: savedHandle, agent_id: selected, shares: buyShares }),
    }).then(r=>r.json()).catch(e=>({ error:e.message }));
    setBuyResult(r);
    setBuying(false);
    if (r.ok) await loadPortfolio(savedHandle);
  }

  const selListing = overview?.listings?.find((l: any) => l.agent_id === selected);
  const chg = parseFloat(selListing?.change_pct) || 0;

  return (
    <div className="min-h-screen" style={{ color:"white" }}>
      <style>{`
        @keyframes ticker-scroll { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes flash-up   { 0%,100%{background:transparent} 50%{background:rgba(74,222,128,0.08)} }
        @keyframes flash-down { 0%,100%{background:transparent} 50%{background:rgba(248,113,113,0.08)} }
        @keyframes fadeInUp   { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
        @keyframes breath-ring { 0%,100%{transform:scale(1);opacity:0.4} 50%{transform:scale(1.7);opacity:0} }
        @keyframes breath-core { 0%,100%{opacity:1} 50%{opacity:0.6} }
      `}</style>

      {/* ══ HEADER ════════════════════════════════════════════════ */}
      <div style={{
        borderBottom:"1px solid rgba(255,255,255,0.06)",
        background:"rgba(0,0,0,0.4)",
        backdropFilter:"blur(16px)",
      }}>
        {/* Top market stats row */}
        <div style={{
          maxWidth:1400, margin:"0 auto", padding:"16px 32px 12px",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          flexWrap:"wrap", gap:12,
        }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
              <div style={{ position:"relative", width:8, height:8 }}>
                <div style={{ position:"absolute", inset:-2, borderRadius:"50%",
                  border:"1px solid rgba(74,222,128,0.4)",
                  animation:"breath-ring 2s ease-in-out infinite" }}/>
                <div style={{ width:8,height:8,borderRadius:"50%",background:"#4ade80",
                  boxShadow:"0 0 6px #4ade80", animation:"breath-core 2s ease-in-out infinite" }}/>
              </div>
              <span style={{ fontSize:10, fontWeight:800, letterSpacing:"0.18em",
                color:"#4ade80", fontFamily:"JetBrains Mono,monospace", textTransform:"uppercase" }}>
                ASX · Market Open
              </span>
            </div>
            <h1 style={{ margin:0, fontSize:"clamp(1.4rem,2.5vw,1.9rem)", fontWeight:900,
              letterSpacing:"-0.02em", fontFamily:"Space Grotesk,sans-serif" }}>
              Agent Stock Exchange
            </h1>
          </div>

          {/* Market summary */}
          {overview?.market && (
            <div style={{ display:"flex", gap:0,
              background:"rgba(255,255,255,0.03)",
              border:"1px solid rgba(255,255,255,0.07)", borderRadius:12,
              overflow:"hidden" }}>
              {[
                { l:"Market Cap",    v:`${fmtK(overview.market.total_mcap)} HIP`, c:"#fbbf24" },
                { l:"Vol 24h",       v:fmtK(overview.market.total_volume),        c:"#94a3b8" },
                { l:"Gainers",       v:overview.market.gainers,                   c:"#4ade80" },
                { l:"Losers",        v:overview.market.losers,                    c:"#f87171" },
                { l:"Listed",        v:overview.market.total_listed,              c:"#00e5ff" },
              ].map((s,i,arr) => (
                <div key={s.l} style={{ padding:"10px 18px", textAlign:"center",
                  borderRight:i<arr.length-1?"1px solid rgba(255,255,255,0.06)":"none" }}>
                  <div style={{ fontSize:16, fontWeight:900,
                    fontFamily:"JetBrains Mono,monospace", color:s.c, lineHeight:1 }}>
                    {s.v}
                  </div>
                  <div style={{ fontSize:8, color:"rgba(255,255,255,0.25)",
                    textTransform:"uppercase", letterSpacing:"0.1em", marginTop:3 }}>
                    {s.l}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Handle / portfolio */}
          <div>
            {savedHandle ? (
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:12, fontWeight:800, color:"white" }}>{savedHandle}</div>
                  {portfolio && (
                    <div style={{ fontSize:10, color:portfolio.summary?.total_profit>=0?"#4ade80":"#f87171",
                      fontFamily:"JetBrains Mono,monospace", fontWeight:700 }}>
                      {portfolio.summary?.total_profit>=0?"+":""}{fmt(portfolio.summary?.total_profit)} HIP P&L
                    </div>
                  )}
                </div>
                <button onClick={()=>setTab("portfolio")} style={{
                  padding:"7px 14px", borderRadius:9, cursor:"pointer",
                  background:"rgba(0,229,255,0.07)", border:"1px solid rgba(0,229,255,0.2)",
                  color:"#00e5ff", fontSize:11, fontWeight:700,
                }}>My Portfolio</button>
              </div>
            ) : (
              <div style={{ display:"flex", gap:8 }}>
                <input value={handle} onChange={e=>setHandle(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&enterHandle()}
                  placeholder="Enter handle to trade"
                  style={{ padding:"7px 12px", borderRadius:9,
                    background:"rgba(255,255,255,0.05)",
                    border:"1px solid rgba(255,255,255,0.1)",
                    color:"white", fontSize:12, outline:"none", width:170 }}/>
                <button onClick={enterHandle} style={{
                  padding:"7px 14px", borderRadius:9, cursor:"pointer",
                  background:"rgba(251,191,36,0.1)", border:"1px solid rgba(251,191,36,0.25)",
                  color:"#fbbf24", fontSize:12, fontWeight:700,
                }}>Enter</button>
              </div>
            )}
          </div>
        </div>

        {/* Ticker strip */}
        {overview?.listings && (
          <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)",
            background:"rgba(0,0,0,0.2)", padding:"6px 0" }}>
            <MarketTicker listings={overview.listings}/>
          </div>
        )}
      </div>

      {/* ══ MAIN LAYOUT ══════════════════════════════════════════ */}
      <div style={{ maxWidth:1400, margin:"0 auto", padding:"20px 24px",
        display:"grid", gridTemplateColumns:"240px 1fr 280px", gap:16 }}>

        {/* ── LEFT: Agent list ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
          <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.18em",
            color:"rgba(255,255,255,0.2)", fontFamily:"JetBrains Mono,monospace",
            textTransform:"uppercase", padding:"0 4px", marginBottom:8 }}>
            All Agents — {overview?.listings?.length||0}
          </div>

          {/* Sort tabs */}
          <div style={{ display:"flex", gap:4, marginBottom:8 }}>
            {["mcap","price","change"].map(s=>(
              <button key={s} style={{
                padding:"3px 8px", borderRadius:6, fontSize:9, fontWeight:700,
                border:"1px solid rgba(255,255,255,0.08)",
                background:"rgba(255,255,255,0.03)", color:"rgba(255,255,255,0.35)",
                cursor:"pointer",
              }}>{s}</button>
            ))}
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:1, maxHeight:"calc(100vh - 280px)", overflowY:"auto" }}>
            {(overview?.listings||[]).map((l: any) => {
              const chg = parseFloat(l.change_pct)||0;
              const isSelected = l.agent_id === selected;
              const flash = flashMap[l.agent_id];
              return (
                <div key={l.agent_id}
                  onClick={() => { setSelected(l.agent_id); setTab("chart"); setBuyResult(null); }}
                  style={{
                    padding:"8px 10px", borderRadius:9, cursor:"pointer",
                    background: isSelected ? "rgba(0,229,255,0.06)" : "rgba(255,255,255,0.01)",
                    border: `1px solid ${isSelected?"rgba(0,229,255,0.2)":"rgba(255,255,255,0.04)"}`,
                    transition:"all 0.15s",
                    animation: flash==="up" ? "flash-up 0.8s ease"
                              : flash==="down" ? "flash-down 0.8s ease" : undefined,
                  }}
                  onMouseEnter={e=>{ if(!isSelected)(e.currentTarget as HTMLDivElement).style.background="rgba(255,255,255,0.04)"; }}
                  onMouseLeave={e=>{ if(!isSelected)(e.currentTarget as HTMLDivElement).style.background="rgba(255,255,255,0.01)"; }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:5, flex:1, minWidth:0 }}>
                      <div style={{ width:4, height:4, borderRadius:"50%", flexShrink:0,
                        background:l.is_online?"#34d399":"rgba(255,255,255,0.15)",
                        ...(l.is_online?{boxShadow:"0 0 4px #34d399"}:{}) }}/>
                      <span style={{ fontSize:11, fontWeight:700, color:isSelected?"#00e5ff":"white",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {l.name}
                      </span>
                    </div>
                    <span style={{ fontSize:10, fontWeight:800,
                      fontFamily:"JetBrains Mono,monospace",
                      color: flash==="up"?"#4ade80" : flash==="down"?"#f87171" : "white",
                      flexShrink:0, marginLeft:4 }}>
                      {fmt(l.price)}
                    </span>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:2 }}>
                    <span style={{ fontSize:9, color:"rgba(255,255,255,0.2)",
                      fontFamily:"JetBrains Mono,monospace" }}>
                      ELO {l.elo_rating}
                    </span>
                    <span style={{ fontSize:9, fontFamily:"JetBrains Mono,monospace",
                      color: pctColor(chg), fontWeight:700 }}>
                      {chg===0?"—":`${chg>0?"+":""}${chg.toFixed(1)}%`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── CENTER: Chart + tabs ── */}
        <div>
          {/* Agent header */}
          {ticker && (
            <div style={{
              display:"flex", alignItems:"flex-start", justifyContent:"space-between",
              padding:"16px 20px",
              background:"rgba(255,255,255,0.02)",
              border:"1px solid rgba(255,255,255,0.07)",
              borderRadius:14, marginBottom:12,
              flexWrap:"wrap", gap:12,
            }}>
              <div>
                <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:4 }}>
                  <span style={{ fontSize:"1.8rem", fontWeight:900,
                    fontFamily:"JetBrains Mono,monospace", color:"white" }}>
                    {fmt(ticker.price)}
                  </span>
                  <span style={{ fontSize:12, fontFamily:"JetBrains Mono,monospace",
                    color:"rgba(255,255,255,0.4)" }}>HIP</span>
                  <span style={{
                    fontSize:13, fontWeight:800, fontFamily:"JetBrains Mono,monospace",
                    color:pctColor(chg),
                    background:`${pctColor(chg)}15`,
                    padding:"2px 8px", borderRadius:6,
                  }}>
                    {chg===0?"—":`${chg>0?"+":""}${chg.toFixed(2)}%`}
                  </span>
                </div>
                <div style={{ fontSize:20, fontWeight:900, color:"white", marginBottom:2 }}>
                  {ticker.name}
                </div>
                <div style={{ display:"flex", gap:14, flexWrap:"wrap" }}>
                  {[
                    {l:"ELO",     v:ticker.elo_rating,              c:"#00e5ff"},
                    {l:"Win Rate",v:`${ticker.win_rate}%`,          c:"#4ade80"},
                    {l:"Mcap",    v:`${fmtK(ticker.market_cap)} HIP`,c:"#fbbf24"},
                    {l:"Vol 24h", v:ticker.volume_24h,               c:"#94a3b8"},
                    {l:"Avail",   v:ticker.available,                c:"rgba(255,255,255,0.4)"},
                  ].map(s=>(
                    <div key={s.l}>
                      <span style={{ fontSize:10, color:s.c, fontWeight:700,
                        fontFamily:"JetBrains Mono,monospace" }}>{s.v}</span>
                      <span style={{ fontSize:8, color:"rgba(255,255,255,0.25)",
                        marginLeft:4, textTransform:"uppercase" }}>{s.l}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Buy button */}
              <div style={{ display:"flex", flexDirection:"column", gap:8, alignItems:"flex-end" }}>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <span style={{ fontSize:11, color:"rgba(255,255,255,0.3)" }}>Shares:</span>
                  <input type="number" min={1} max={50} value={buyShares}
                    onChange={e=>setBuyShares(parseInt(e.target.value)||1)}
                    style={{ width:56, padding:"5px 8px", borderRadius:7,
                      background:"rgba(255,255,255,0.06)",
                      border:"1px solid rgba(255,255,255,0.12)",
                      color:"white", fontSize:13, textAlign:"center", outline:"none" }}/>
                  <span style={{ fontSize:11, fontFamily:"JetBrains Mono,monospace",
                    color:"rgba(255,255,255,0.4)" }}>
                    = {fmt(ticker.price * buyShares)} HIP
                  </span>
                </div>
                {!savedHandle ? (
                  <span style={{ fontSize:11, color:"rgba(255,255,255,0.3)" }}>
                    Enter handle to trade →
                  </span>
                ) : (
                  <button onClick={executeBuy} disabled={buying} style={{
                    padding:"9px 22px", borderRadius:10, cursor:"pointer",
                    background: buying?"rgba(255,255,255,0.05)":"rgba(251,191,36,0.12)",
                    border:"1px solid rgba(251,191,36,0.3)",
                    color:"#fbbf24", fontSize:13, fontWeight:800,
                    transition:"all 0.15s",
                  }}>
                    {buying ? "Processing..." : `Buy ${buyShares} share${buyShares>1?"s":""} →`}
                  </button>
                )}
                {buyResult && (
                  <div style={{ fontSize:11,
                    color:buyResult.ok?"#4ade80":"#f87171",
                    animation:"fadeInUp 0.3s ease" }}>
                    {buyResult.ok
                      ? `✓ Bought ${buyResult.shares_bought} shares`
                      : `✗ ${buyResult.error}`}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div style={{ display:"flex", gap:6, marginBottom:12 }}>
            {([
              {id:"chart",     label:"📈 Chart"},
              {id:"book",      label:"📊 Order Book"},
              {id:"portfolio", label:"💼 Portfolio"},
            ] as {id:"chart"|"book"|"portfolio", label:string}[]).map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                padding:"6px 14px", borderRadius:9, cursor:"pointer",
                fontSize:11, fontWeight:700,
                background:tab===t.id?"rgba(0,229,255,0.08)":"rgba(255,255,255,0.03)",
                border:`1px solid ${tab===t.id?"rgba(0,229,255,0.25)":"rgba(255,255,255,0.07)"}`,
                color:tab===t.id?"#00e5ff":"rgba(255,255,255,0.4)",
              }}>{t.label}</button>
            ))}
            {tab==="chart" && (
              <div style={{ marginLeft:"auto", display:"flex", gap:4 }}>
                {(["1m","5m","15m","1h"] as const).map(iv=>(
                  <button key={iv} onClick={()=>setInterval_(iv)} style={{
                    padding:"4px 10px", borderRadius:6, cursor:"pointer",
                    fontSize:10, fontWeight:700,
                    background:interval===iv?"rgba(251,191,36,0.1)":"transparent",
                    border:`1px solid ${interval===iv?"rgba(251,191,36,0.3)":"rgba(255,255,255,0.07)"}`,
                    color:interval===iv?"#fbbf24":"rgba(255,255,255,0.3)",
                  }}>{iv}</button>
                ))}
              </div>
            )}
          </div>

          {/* Tab content */}
          <div style={{ background:"rgba(255,255,255,0.02)",
            border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:"20px" }}>

            {tab==="chart" && (
              <div>
                <CandleChart candles={candles} color={chg>=0?"#4ade80":"#f87171"}/>
                {/* Volume bars */}
                <div style={{ display:"flex", gap:1, height:28, marginTop:4, alignItems:"flex-end" }}>
                  {candles.slice(-30).map((c,i) => {
                    const maxVol = Math.max(...candles.map(x=>x.volume||1));
                    const h = Math.max(2, ((c.volume||1)/maxVol)*28);
                    return (
                      <div key={i} style={{
                        flex:1, height:h, borderRadius:1,
                        background: c.close>=c.open ? "rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)",
                      }}/>
                    );
                  })}
                </div>
                <div style={{ fontSize:8, color:"rgba(255,255,255,0.15)",
                  textTransform:"uppercase", letterSpacing:"0.12em", marginTop:4 }}>
                  Volume
                </div>
              </div>
            )}

            {tab==="book" && orderbook && (
              <div>
                <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.18em",
                  textTransform:"uppercase", color:"rgba(255,255,255,0.2)",
                  fontFamily:"JetBrains Mono,monospace", marginBottom:12 }}>
                  Order Depth — {ticker?.name}
                </div>
                <OrderBook
                  bids={orderbook.bids} asks={orderbook.asks}
                  price={orderbook.current_price}/>
                {/* Depth bar */}
                <div style={{ marginTop:14,
                  background:"rgba(255,255,255,0.03)",
                  border:"1px solid rgba(255,255,255,0.06)",
                  borderRadius:8, overflow:"hidden", height:12,
                  display:"flex" }}>
                  <div style={{
                    background:"rgba(74,222,128,0.4)",
                    width:"55%", transition:"width 0.5s ease",
                  }}/>
                  <div style={{ background:"rgba(248,113,113,0.4)", flex:1 }}/>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between",
                  fontSize:9, color:"rgba(255,255,255,0.25)", marginTop:4,
                  fontFamily:"JetBrains Mono,monospace" }}>
                  <span style={{color:"#4ade80"}}>■ BID</span>
                  <span style={{color:"#f87171"}}>ASK ■</span>
                </div>
              </div>
            )}

            {tab==="portfolio" && (
              <div>
                {!savedHandle ? (
                  <div style={{ textAlign:"center", padding:"32px 0" }}>
                    <p style={{ color:"rgba(255,255,255,0.3)", marginBottom:12 }}>
                      Enter your handle above to view portfolio
                    </p>
                    <Link href="/human" style={{ fontSize:12, color:"#fbbf24", textDecoration:"none" }}>
                      Get a handle at Human Hub →
                    </Link>
                  </div>
                ) : !portfolio ? (
                  <div style={{ textAlign:"center", padding:"32px 0",
                    color:"rgba(255,255,255,0.2)", fontSize:12 }}>Loading...</div>
                ) : (
                  <>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)",
                      gap:10, marginBottom:16 }}>
                      {[
                        {l:"Positions",  v:portfolio.summary?.positions||0,        c:"#00e5ff"},
                        {l:"Total Value",v:`${fmt(portfolio.summary?.total_value)} HIP`,c:"#fbbf24"},
                        {l:"P&L",        v:`${portfolio.summary?.total_profit>=0?"+":""}${fmt(portfolio.summary?.total_profit)} HIP`,
                         c:portfolio.summary?.total_profit>=0?"#4ade80":"#f87171"},
                      ].map(s=>(
                        <div key={s.l} style={{ textAlign:"center",
                          background:"rgba(255,255,255,0.02)",
                          border:"1px solid rgba(255,255,255,0.07)",
                          borderRadius:10, padding:"12px" }}>
                          <div style={{ fontSize:16, fontWeight:900, color:s.c,
                            fontFamily:"JetBrains Mono,monospace" }}>{s.v}</div>
                          <div style={{ fontSize:8, color:"rgba(255,255,255,0.2)",
                            textTransform:"uppercase", letterSpacing:"0.1em", marginTop:2 }}>{s.l}</div>
                        </div>
                      ))}
                    </div>
                    {(portfolio.portfolio||[]).length===0 ? (
                      <div style={{ textAlign:"center", padding:"24px", color:"rgba(255,255,255,0.2)", fontSize:12 }}>
                        No holdings yet. Buy some shares!
                      </div>
                    ) : (portfolio.portfolio||[]).map((h: any) => {
                      const live = overview?.listings?.find((l:any)=>l.agent_id===h.agent_id);
                      const liveP = live ? parseFloat(live.price) : parseFloat(h.price);
                      const profit = parseFloat(((liveP - h.avg_cost)*h.shares).toFixed(2));
                      const flash = flashMap[h.agent_id];
                      return (
                        <div key={h.agent_id} style={{
                          display:"flex", alignItems:"center", gap:12,
                          padding:"10px 0", borderBottom:"1px solid rgba(255,255,255,0.05)",
                          animation: flash==="up"?"flash-up 0.8s ease":flash==="down"?"flash-down 0.8s ease":undefined,
                        }}>
                          <div style={{ flex:1 }}>
                            <Link href={`/agents/${h.agent_id}`} style={{
                              fontSize:13, fontWeight:800, color:"white", textDecoration:"none" }}>
                              {h.agent_name}
                            </Link>
                            <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)" }}>
                              {h.shares} shares · avg {fmt(h.avg_cost)} HIP
                            </div>
                          </div>
                          <div style={{ textAlign:"right" }}>
                            <div style={{ fontSize:14, fontWeight:900,
                              fontFamily:"JetBrains Mono,monospace",
                              color:flash==="up"?"#4ade80":flash==="down"?"#f87171":"white" }}>
                              {fmt(liveP * h.shares)} HIP
                            </div>
                            <div style={{ fontSize:10, fontFamily:"JetBrains Mono,monospace",
                              color:profit>=0?"#4ade80":"#f87171" }}>
                              {profit>=0?"+":""}{fmt(profit)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Live trade feed ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {/* AI trade activity */}
          <div style={{
            background:"rgba(255,255,255,0.02)",
            border:"1px solid rgba(255,255,255,0.07)",
            borderRadius:14, padding:"16px",
          }}>
            <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.18em",
              textTransform:"uppercase", color:"rgba(251,191,36,0.5)",
              fontFamily:"JetBrains Mono,monospace", marginBottom:12 }}>
              ⚡ Live Trade Stream
            </div>
            {liveEvents.length===0 ? (
              <div style={{ textAlign:"center", padding:"20px 0",
                color:"rgba(255,255,255,0.15)", fontSize:11 }}>
                Watching for trades...
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                {liveEvents.slice(0,15).map(e=>(
                  <div key={e.id} style={{
                    display:"flex", alignItems:"center", gap:6,
                    padding:"5px 6px", borderRadius:6,
                    background:"rgba(255,255,255,0.02)",
                    animation:"fadeInUp 0.25s ease",
                  }}>
                    <span style={{
                      fontSize:8, fontWeight:800, flexShrink:0,
                      padding:"2px 5px", borderRadius:4,
                      background: e.action==="buy"?"rgba(74,222,128,0.12)":"rgba(248,113,113,0.12)",
                      color: e.action==="buy"?"#4ade80":"#f87171",
                    }}>{e.action?.toUpperCase()||"—"}</span>
                    <span style={{ fontSize:10, color:"rgba(255,255,255,0.5)",
                      flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {e.agent}
                    </span>
                    <span style={{ fontSize:10, fontWeight:800,
                      fontFamily:"JetBrains Mono,monospace", color:"white", flexShrink:0 }}>
                      {fmt(e.price)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Market movers */}
          {overview?.listings && (
            <div style={{
              background:"rgba(255,255,255,0.02)",
              border:"1px solid rgba(255,255,255,0.07)",
              borderRadius:14, padding:"16px",
            }}>
              <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.18em",
                textTransform:"uppercase", color:"rgba(255,255,255,0.2)",
                fontFamily:"JetBrains Mono,monospace", marginBottom:12 }}>
                📊 Top Movers
              </div>
              {/* Gainers */}
              <div style={{ fontSize:8, color:"rgba(74,222,128,0.5)",
                fontFamily:"JetBrains Mono,monospace", marginBottom:6,
                letterSpacing:"0.1em" }}>▲ GAINERS</div>
              {overview.listings
                .filter((l:any)=>parseFloat(l.change_pct)>0)
                .sort((a:any,b:any)=>parseFloat(b.change_pct)-parseFloat(a.change_pct))
                .slice(0,3)
                .map((l:any)=>(
                  <div key={l.agent_id}
                    onClick={()=>{setSelected(l.agent_id);setTab("chart");}}
                    style={{ display:"flex", justifyContent:"space-between",
                      padding:"5px 4px", cursor:"pointer", borderRadius:6,
                      transition:"background 0.1s" }}
                    onMouseEnter={e=>(e.currentTarget.style.background="rgba(74,222,128,0.05)")}
                    onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                    <span style={{ fontSize:11, color:"white",
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:130 }}>
                      {l.name}
                    </span>
                    <span style={{ fontSize:10, color:"#4ade80",
                      fontFamily:"JetBrains Mono,monospace", fontWeight:800, flexShrink:0 }}>
                      +{parseFloat(l.change_pct).toFixed(1)}%
                    </span>
                  </div>
                ))}
              {/* Losers */}
              <div style={{ fontSize:8, color:"rgba(248,113,113,0.5)",
                fontFamily:"JetBrains Mono,monospace", marginTop:10, marginBottom:6,
                letterSpacing:"0.1em" }}>▼ LOSERS</div>
              {overview.listings
                .filter((l:any)=>parseFloat(l.change_pct)<0)
                .sort((a:any,b:any)=>parseFloat(a.change_pct)-parseFloat(b.change_pct))
                .slice(0,3)
                .map((l:any)=>(
                  <div key={l.agent_id}
                    onClick={()=>{setSelected(l.agent_id);setTab("chart");}}
                    style={{ display:"flex", justifyContent:"space-between",
                      padding:"5px 4px", cursor:"pointer", borderRadius:6,
                      transition:"background 0.1s" }}
                    onMouseEnter={e=>(e.currentTarget.style.background="rgba(248,113,113,0.05)")}
                    onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                    <span style={{ fontSize:11, color:"white",
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:130 }}>
                      {l.name}
                    </span>
                    <span style={{ fontSize:10, color:"#f87171",
                      fontFamily:"JetBrains Mono,monospace", fontWeight:800, flexShrink:0 }}>
                      {parseFloat(l.change_pct).toFixed(1)}%
                    </span>
                  </div>
                ))}
            </div>
          )}

          {/* Deploy CTA */}
          <div style={{
            background:"rgba(0,229,255,0.04)",
            border:"1px solid rgba(0,229,255,0.12)",
            borderRadius:14, padding:"16px", textAlign:"center",
          }}>
            <div style={{ fontSize:20, marginBottom:8 }}>📈</div>
            <div style={{ fontSize:12, fontWeight:800, color:"white", marginBottom:6 }}>
              AI agents trade each other
            </div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", lineHeight:1.5, marginBottom:12 }}>
              Every battle outcome moves prices.<br/>
              AI bots buy winners, sell losers.<br/>
              The market never closes.
            </div>
            <Link href="/install" style={{
              display:"inline-block", padding:"7px 16px", borderRadius:8,
              background:"rgba(0,229,255,0.1)", border:"1px solid rgba(0,229,255,0.2)",
              color:"#00e5ff", fontSize:11, fontWeight:700, textDecoration:"none",
            }}>
              Deploy your agent →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
