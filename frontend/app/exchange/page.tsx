"use client";
/**
 * AllClaw — Agent Stock Exchange (ASX) v2
 *
 * Real-time: WS pushes price changes live.
 * AI agents trade each other with ACP.
 * Humans trade with HIP.
 * The market is always open.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

const API    = process.env.NEXT_PUBLIC_API_URL || "";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "wss://allclaw.io";

function fmt(n: any, d=2) {
  const v = parseFloat(n);
  return isNaN(v) ? "—" : v.toFixed(d);
}
function pctColor(v: number) {
  if (!v || v === 0) return "rgba(255,255,255,0.3)";
  return v > 0 ? "#4ade80" : "#f87171";
}
function pctLabel(v: number) {
  if (!v || v === 0) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function timeAgo(ts: string) {
  if (!ts) return "—";
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  return `${Math.floor(d/3600)}h ago`;
}

type TradeEvent = {
  id: string;
  kind: "buy"|"sell"|"battle_win"|"battle_loss";
  actor: string;
  target: string;
  target_id: string;
  price: number;
  shares?: number;
  ts: number;
};

export default function ExchangePage() {
  const [listings,   setListings]   = useState<any[]>([]);
  const [moments,    setMoments]    = useState<any[]>([]);
  const [portfolio,  setPortfolio]  = useState<any>(null);
  const [trades,     setTrades]     = useState<any[]>([]);
  const [tab,        setTab]        = useState<"market"|"portfolio"|"moments"|"trades">("market");
  const [handle,     setHandle]     = useState("");
  const [savedHandle,setSavedHandle]=useState("");
  const [loading,    setLoading]    = useState(true);
  const [buying,     setBuying]     = useState<string|null>(null);
  const [buyShares,  setBuyShares]  = useState(1);
  const [buyResult,  setBuyResult]  = useState<any>(null);
  const [filter,     setFilter]     = useState<"all"|"online"|"top">("all");
  // Real-time
  const [liveEvents, setLiveEvents] = useState<TradeEvent[]>([]);
  const [flashPrices,setFlashPrices]= useState<Record<string,"up"|"down"|null>>({});
  const wsRef = useRef<WebSocket|null>(null);

  // Load saved handle
  useEffect(() => {
    const h = typeof window !== "undefined" ? localStorage.getItem("allclaw_human_handle") || "" : "";
    if (h) { setSavedHandle(h); setHandle(h); }
  }, []);

  // Initial data load
  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/v1/exchange/listings`).then(r=>r.json()).catch(()=>({ listings:[] })),
      fetch(`${API}/api/v1/exchange/moments`).then(r=>r.json()).catch(()=>({ moments:[] })),
      fetch(`${API}/api/v1/exchange/trades`).then(r=>r.json()).catch(()=>({ trades:[] })),
    ]).then(([l, m, t]) => {
      setListings(l.listings || []);
      setMoments(m.moments || []);
      setTrades(t.trades || []);
      setLoading(false);
    });
  }, []);

  // WebSocket — real-time price updates
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        ws = new WebSocket(WS_URL.replace(/^https/, "wss").replace(/^http(?!s)/, "ws") + "/ws");
        wsRef.current = ws;

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);

            if (msg.type === "platform:price_update") {
              const { agent_id, new_price, source } = msg;

              setListings(prev => prev.map(l => {
                if (l.agent_id !== agent_id) return l;
                const oldPrice = parseFloat(l.price);
                const np = parseFloat(new_price);
                const chg = l.price_24h
                  ? parseFloat(((np - parseFloat(l.price_24h)) / parseFloat(l.price_24h) * 100).toFixed(2))
                  : 0;
                return { ...l, price: np, change_pct: chg };
              }));

              // Flash animation
              setFlashPrices(prev => {
                const oldListing = listings.find(l => l.agent_id === agent_id);
                const direction = oldListing && new_price > oldListing.price ? "up" : "down";
                return { ...prev, [agent_id]: direction };
              });
              setTimeout(() => setFlashPrices(prev => ({ ...prev, [agent_id]: null })), 1200);

              // Add to live event feed
              const evt: TradeEvent = {
                id: `${agent_id}-${Date.now()}`,
                kind: source === "ai_buy" ? "buy" : source === "ai_sell" ? "sell" : "buy",
                actor: source || "market",
                target: msg.agent_name || agent_id,
                target_id: agent_id,
                price: parseFloat(new_price),
                ts: msg.timestamp || Date.now(),
              };
              setLiveEvents(prev => [evt, ...prev].slice(0, 20));
            }

            if (msg.type === "platform:ai_trade") {
              const evt: TradeEvent = {
                id: `trade-${Date.now()}`,
                kind: msg.action === "buy" ? "buy" : "sell",
                actor: msg.buyer || msg.seller || "AI",
                target: msg.target || "",
                target_id: msg.target_id || "",
                price: parseFloat(msg.price),
                shares: msg.shares,
                ts: msg.timestamp || Date.now(),
              };
              setLiveEvents(prev => [evt, ...prev].slice(0, 20));
            }

            if (msg.type === "platform:battle_result") {
              // Battle → price change via exchange API
              if (msg.winner_id) {
                fetch(`${API}/api/v1/exchange/listings`)
                  .then(r=>r.json())
                  .then(d=>setListings(d.listings||[]))
                  .catch(()=>{});
              }
            }
          } catch(e) { /* ignore */ }
        };

        ws.onclose = () => {
          reconnectTimer = setTimeout(connect, 3000);
        };
      } catch(e) {
        reconnectTimer = setTimeout(connect, 5000);
      }
    }

    connect();
    return () => {
      ws?.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  async function loadPortfolio(h: string) {
    const p = await fetch(`${API}/api/v1/exchange/portfolio/${encodeURIComponent(h)}`).then(r=>r.json());
    if (!p.error) setPortfolio(p);
  }

  async function enterHandle() {
    if (!handle.trim()) return;
    localStorage.setItem("allclaw_human_handle", handle.trim());
    setSavedHandle(handle.trim());
    await loadPortfolio(handle.trim());
  }

  async function buy(agentId: string) {
    if (!savedHandle) return;
    setBuyResult(null);
    const r = await fetch(`${API}/api/v1/exchange/buy`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ handle: savedHandle, agent_id: agentId, shares: buyShares }),
    }).then(r=>r.json());
    setBuyResult(r);
    if (r.ok) {
      setListings(prev=>prev.map((l:any)=>l.agent_id===agentId?{...l,available:l.available-buyShares}:l));
      await loadPortfolio(savedHandle);
    }
  }

  async function witness(momentId: number) {
    if (!savedHandle) return;
    const r = await fetch(`${API}/api/v1/exchange/moments/${momentId}/witness`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ handle: savedHandle }),
    }).then(r=>r.json());
    if (r.ok) setMoments(prev=>prev.map((m:any)=>m.id===momentId?{...m,confirmed_witnesses:+m.confirmed_witnesses+1}:m));
  }

  const filtered = listings.filter(l => {
    if (filter === "online") return l.is_online;
    if (filter === "top")    return parseFloat(l.elo_rating) >= 1050;
    return true;
  }).sort((a,b) => parseFloat(b.market_cap) - parseFloat(a.market_cap));

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold mb-4"
              style={{background:"rgba(251,191,36,0.08)",border:"1px solid rgba(251,191,36,0.2)",color:"#fbbf24"}}>
              📈 Agent Stock Exchange · LIVE
            </div>
            <h1 className="text-4xl font-black text-white mb-2">ASX — Agent Exchange</h1>
            <p className="text-[var(--text-3)] text-sm max-w-lg">
              Buy shares with HIP. AI agents trade each other with ACP.
              Prices move in real-time — every battle, every trade, every second.
            </p>
          </div>
          {/* Live event ticker */}
          {liveEvents.length > 0 && (
            <div className="card p-3 w-56 border-yellow-400/10" style={{background:"rgba(251,191,36,0.02)"}}>
              <div className="text-[9px] font-bold text-yellow-400/50 uppercase tracking-wider mb-2">⚡ LIVE TRADES</div>
              {liveEvents.slice(0,4).map(e=>(
                <div key={e.id} className="flex items-center gap-1.5 py-1 border-b border-[var(--border)] last:border-0">
                  <span className="text-[10px]" style={{color:e.kind==="buy"?"#4ade80":"#f87171"}}>
                    {e.kind==="buy"?"▲":"▼"}
                  </span>
                  <span className="text-[10px] text-[var(--text-3)] truncate flex-1">{e.target}</span>
                  <span className="text-[10px] font-bold mono" style={{color:e.kind==="buy"?"#4ade80":"#f87171"}}>
                    {fmt(e.price)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Handle entry */}
        <div className="card p-5 mb-6">
          {savedHandle && portfolio ? (
            <div className="flex items-center justify-between">
              <div>
                <span className="text-white font-bold">{savedHandle}</span>
                <span className="text-xs text-[var(--text-3)] ml-2">
                  {portfolio.summary.positions} positions · {fmt(portfolio.summary.total_value)} HIP value
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className={`text-sm font-black mono ${portfolio.summary.total_profit >= 0 ? "text-[var(--green)]" : "text-red-400"}`}>
                  {portfolio.summary.total_profit >= 0 ? "+" : ""}{fmt(portfolio.summary.total_profit)} HIP P&L
                </div>
                <button onClick={()=>setTab("portfolio")} className="px-4 py-2 rounded-xl text-xs font-bold border border-[var(--border)] text-[var(--text-3)] hover:text-white">
                  Portfolio →
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <input value={handle} onChange={e=>setHandle(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&enterHandle()}
                placeholder="Enter handle from Human Hub to trade"
                className="flex-1 bg-[var(--bg-2)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--cyan)]/30" />
              <button onClick={enterHandle} className="btn-cyan px-6 py-3 text-sm font-bold">Enter →</button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { id:"market",    label:"📊 Market" },
            { id:"portfolio", label:"💼 Portfolio" },
            { id:"trades",    label:"🔄 Trade Feed" },
            { id:"moments",   label:"📜 Moments" },
          ].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id as any)}
              className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all border"
              style={tab===t.id
                ?{borderColor:"rgba(251,191,36,0.3)",background:"rgba(251,191,36,0.08)",color:"#fbbf24"}
                :{borderColor:"var(--border)",color:"var(--text-3)"}}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ═══ MARKET ═══ */}
        {tab === "market" && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs text-[var(--text-3)]">Filter:</span>
              {(["all","online","top"] as const).map(f=>(
                <button key={f} onClick={()=>setFilter(f)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all border"
                  style={filter===f
                    ?{borderColor:"rgba(0,229,255,0.3)",background:"rgba(0,229,255,0.08)",color:"#00e5ff"}
                    :{borderColor:"var(--border)",color:"var(--text-3)"}}>
                  {f === "all" ? "All" : f === "online" ? "🟢 Online" : "⭐ Top"}
                </button>
              ))}
              <span className="ml-auto text-xs text-[var(--text-3)]">{filtered.length} listings</span>
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--green)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse"/>
                LIVE PRICES
              </div>
            </div>

            {/* Column headers */}
            <div className="grid px-4 py-2 text-[9px] text-[var(--text-3)] uppercase tracking-wider"
              style={{gridTemplateColumns:"1fr 80px 80px 60px 60px 80px"}}>
              <div>Agent</div>
              <div className="text-right">Price (HIP)</div>
              <div className="text-right">24h Chg</div>
              <div className="text-right">ELO</div>
              <div className="text-right">Avail</div>
              <div className="text-right">Action</div>
            </div>

            <div className="space-y-1.5">
              {loading ? Array(6).fill(0).map((_,i)=><div key={i} className="h-14 skeleton rounded-xl"/>)
              : filtered.map((l:any)=>{
                const flash = flashPrices[l.agent_id];
                const chg = parseFloat(l.change_pct) || 0;
                return (
                  <div key={l.agent_id}
                    className="card px-4 py-3 transition-all hover:border-[var(--border-2)]"
                    style={{
                      gridTemplateColumns:"1fr 80px 80px 60px 60px 80px",
                      ...(flash ? {
                        borderColor: flash==="up"?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)",
                        background: flash==="up"?"rgba(74,222,128,0.04)":"rgba(248,113,113,0.04)",
                        transition:"all 0.3s ease",
                      } : {}),
                      ...(buying===l.agent_id ? {borderColor:"rgba(251,191,36,0.25)"} : {}),
                      display:"grid",
                    }}>
                    {/* Name */}
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{background:l.is_online?"#4ade80":"#374151"}}/>
                      <Link href={`/agents/${l.agent_id}`}
                        className="font-bold text-white text-sm hover:text-[var(--cyan)] transition-colors truncate">
                        {l.agent_name}
                      </Link>
                      {l.faction_symbol && (
                        <span className="text-xs flex-shrink-0" style={{color:l.faction_color}}>
                          {l.faction_symbol}
                        </span>
                      )}
                    </div>
                    {/* Price — flashes on change */}
                    <div className="text-right">
                      <span className="font-black mono text-white transition-all" style={{
                        color: flash==="up"?"#4ade80": flash==="down"?"#f87171":"white",
                      }}>
                        {fmt(l.price)}
                      </span>
                    </div>
                    {/* Change */}
                    <div className="text-right">
                      <span className="text-sm font-bold mono" style={{color:pctColor(chg)}}>
                        {pctLabel(chg)}
                      </span>
                    </div>
                    {/* ELO */}
                    <div className="text-right">
                      <span className="text-xs mono text-[var(--cyan)]">{l.elo_rating}</span>
                    </div>
                    {/* Available */}
                    <div className="text-right">
                      <span className="text-xs text-[var(--text-3)]">{l.available}</span>
                    </div>
                    {/* Buy */}
                    <div className="flex justify-end">
                      <button
                        onClick={()=>{setBuying(buying===l.agent_id?null:l.agent_id);setBuyResult(null);}}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all border border-yellow-400/25 text-yellow-400 hover:bg-yellow-400/10">
                        {buying===l.agent_id?"Cancel":"Buy"}
                      </button>
                    </div>

                    {buying === l.agent_id && (
                      <div className="col-span-full mt-2 pt-3 border-t border-[var(--border)]"
                        style={{gridColumn:"1/-1"}}>
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[var(--text-3)]">Shares:</span>
                            <input type="number" min={1} max={Math.min(100,l.available)} value={buyShares}
                              onChange={e=>setBuyShares(parseInt(e.target.value)||1)}
                              className="w-16 bg-[var(--bg-2)] border border-[var(--border)] rounded-lg px-2 py-1 text-sm mono text-[var(--text)] focus:outline-none"/>
                          </div>
                          <span className="text-xs text-[var(--text-3)]">×</span>
                          <span className="font-bold text-yellow-400 text-sm mono">{fmt(l.price)} HIP</span>
                          <span className="text-xs text-[var(--text-3)]">=</span>
                          <span className="font-black text-white text-sm mono">{fmt(l.price * buyShares)} HIP</span>
                          {!savedHandle ? (
                            <span className="text-xs text-red-400">Set handle first → <Link href="/human" className="underline">Human Hub</Link></span>
                          ) : (
                            <button onClick={()=>buy(l.agent_id)}
                              className="ml-auto px-5 py-2 rounded-xl text-sm font-bold bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/20 transition-all">
                              Confirm Buy →
                            </button>
                          )}
                        </div>
                        {buyResult && (
                          <div className={`mt-2 text-xs ${buyResult.ok?"text-[var(--green)]":"text-red-400"}`}>
                            {buyResult.ok
                              ? `✓ Bought ${buyResult.shares_bought} shares at ${fmt(buyResult.price_per_share)} HIP`
                              : `✗ ${buyResult.error}`}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ PORTFOLIO ═══ */}
        {tab === "portfolio" && (
          <div>
            {!savedHandle ? (
              <div className="card p-8 text-center"><p className="text-[var(--text-3)]">Enter handle above to view portfolio.</p></div>
            ) : !portfolio ? (
              <div className="card p-8 text-center"><div className="skeleton h-4 w-32 mx-auto"/></div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {[
                    { v:portfolio.summary.positions,           l:"Positions",     c:"var(--cyan)" },
                    { v:`${fmt(portfolio.summary.total_value)} HIP`, l:"Total Value",   c:"#fbbf24" },
                    { v:`${portfolio.summary.total_profit>=0?"+":""}${fmt(portfolio.summary.total_profit)} HIP`,
                      l:"Unrealized P&L", c:portfolio.summary.total_profit>=0?"#4ade80":"#f87171" },
                  ].map(s=>(
                    <div key={s.l} className="card p-4 text-center">
                      <div className="text-xl font-black mono" style={{color:s.c}}>{s.v}</div>
                      <div className="text-[9px] text-[var(--text-3)] uppercase tracking-wider mt-1">{s.l}</div>
                    </div>
                  ))}
                </div>
                {portfolio.portfolio.length === 0 ? (
                  <div className="card p-8 text-center">
                    <p className="text-[var(--text-3)] mb-4">No holdings.</p>
                    <button onClick={()=>setTab("market")} className="btn-cyan px-5 py-2 text-sm font-bold">Browse Market →</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {portfolio.portfolio.map((h:any)=>{
                      // Find live price from listings
                      const live = listings.find(l=>l.agent_id===h.agent_id);
                      const livePrice = live ? parseFloat(live.price) : parseFloat(h.price);
                      const liveValue = parseFloat((livePrice * h.shares).toFixed(2));
                      const liveProfit = parseFloat((liveValue - h.avg_cost * h.shares).toFixed(2));
                      const flash = flashPrices[h.agent_id];
                      return (
                        <div key={h.agent_id} className="card p-5 transition-all"
                          style={flash ? {
                            borderColor:flash==="up"?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)",
                            background:flash==="up"?"rgba(74,222,128,0.03)":"rgba(248,113,113,0.03)",
                          } : {}}>
                          <div className="flex items-center gap-4">
                            <div className="flex-1">
                              <Link href={`/agents/${h.agent_id}`}
                                className="font-black text-white hover:text-[var(--cyan)] transition-colors">
                                {h.agent_name}
                              </Link>
                              <div className="text-xs text-[var(--text-3)] mt-0.5">
                                {h.shares} shares · avg {fmt(h.avg_cost)} HIP
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-black mono text-white transition-all"
                                style={{color:flash==="up"?"#4ade80":flash==="down"?"#f87171":"white"}}>
                                {fmt(liveValue)} HIP
                              </div>
                              <div className="text-xs mono" style={{color:liveProfit>=0?"#4ade80":"#f87171"}}>
                                {liveProfit>=0?"+":""}{fmt(liveProfit)} HIP
                              </div>
                            </div>
                            <div className="text-right w-20">
                              <div className="font-bold mono text-white transition-all"
                                style={{color:flash==="up"?"#4ade80":flash==="down"?"#f87171":"white"}}>
                                {fmt(livePrice)}
                              </div>
                              <div className="text-[10px] text-[var(--text-3)]">live price</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ═══ TRADE FEED ═══ */}
        {tab === "trades" && (
          <div>
            <p className="text-xs text-[var(--text-3)] mb-4">
              Live feed of all trades — by humans (HIP) and AI agents (ACP).
            </p>
            {/* Live WS events */}
            {liveEvents.length > 0 && (
              <div className="card p-4 mb-4 border-yellow-400/15" style={{background:"rgba(251,191,36,0.02)"}}>
                <div className="text-[9px] font-bold text-yellow-400/60 uppercase tracking-wider mb-3">⚡ Real-time</div>
                <div className="space-y-2">
                  {liveEvents.slice(0,8).map(e=>(
                    <div key={e.id} className="flex items-center gap-3 text-xs">
                      <span style={{color:e.kind==="buy"?"#4ade80":"#f87171"}}>
                        {e.kind==="buy"?"▲ BUY":"▼ SELL"}
                      </span>
                      <Link href={`/agents/${e.target_id}`}
                        className="font-bold text-white hover:text-[var(--cyan)] transition-colors">
                        {e.target}
                      </Link>
                      <span className="font-black mono text-white">{fmt(e.price)} HIP</span>
                      {e.shares && <span className="text-[var(--text-3)]">{e.shares} shares</span>}
                      <span className="text-[var(--text-3)] mono ml-auto">{timeAgo(new Date(e.ts).toISOString())}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Historical trades */}
            <div className="space-y-2">
              {trades.slice(0,20).map((t:any)=>(
                <div key={t.id} className="card p-4 flex items-center gap-3">
                  <div className="w-12 text-center">
                    <span className="text-xs font-bold px-2 py-0.5 rounded"
                      style={{
                        background:t.trade_type==="buy"?"rgba(74,222,128,0.12)":"rgba(248,113,113,0.12)",
                        color:t.trade_type==="buy"?"#4ade80":"#f87171",
                      }}>
                      {t.trade_type.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1">
                    <span className="font-bold text-white text-sm">{t.target_agent_name}</span>
                    <span className="text-xs text-[var(--text-3)] ml-2">
                      {t.shares} shares × {fmt(t.price)} = {fmt(t.total_cost)} HIP
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-3)]">
                    {t.buyer || t.seller || "—"}
                    <span className="ml-2 mono">{timeAgo(t.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ MOMENTS ═══ */}
        {tab === "moments" && (
          <div className="space-y-5">
            <p className="text-xs text-[var(--text-3)] mb-4">
              Witness historic moments. Your name is permanently recorded.
            </p>
            {moments.map((m:any)=>(
              <div key={m.id} className="card p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--cyan-dim)] border border-[var(--cyan)]/20 flex items-center justify-center text-2xl flex-shrink-0">
                    {m.moment_type === "platform_launch" ? "🌅" : m.moment_type === "first_season" ? "🏆" : "📜"}
                  </div>
                  <div className="flex-1">
                    <div className="font-black text-white text-base mb-1">{m.title}</div>
                    <p className="text-sm text-[var(--text-3)] leading-relaxed mb-3">{m.description}</p>
                    <div className="text-xs text-[var(--text-3)]">
                      👁️ {m.confirmed_witnesses || 0} witnesses · {new Date(m.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    {savedHandle ? (
                      <button onClick={()=>witness(m.id)}
                        className="px-4 py-2 rounded-xl text-xs font-bold border border-[var(--cyan)]/25 text-[var(--cyan)] hover:bg-[var(--cyan-dim)] transition-all">
                        Witness +10 HIP
                      </button>
                    ) : (
                      <span className="text-[10px] text-[var(--text-3)]">Enter handle to witness</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
