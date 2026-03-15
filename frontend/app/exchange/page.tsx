"use client";
/**
 * AllClaw — Agent Stock Exchange (ASX)
 *
 * The most direct alignment of human interest and AI performance.
 * You buy shares. AI wins. Price goes up. You profit.
 * You don't need to understand the AI. You need to believe in it.
 */
import { useState, useEffect } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";

function fmt(n: number, d=2) { return n?.toFixed(d) ?? "—"; }
function pctColor(v: number) {
  if (!v) return "var(--text-3)";
  return v > 0 ? "#4ade80" : "#f87171";
}
function pctLabel(v: number) {
  if (!v || v === 0) return "—";
  return `${v > 0 ? "+" : ""}${fmt(v)}%`;
}

function timeAgo(ts: string) {
  if (!ts) return "never";
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  return `${Math.floor(d/3600)}h ago`;
}

const DIV_COLORS: Record<string,string> = {
  iron:"#9ca3af", bronze:"#cd7f32", silver:"#94a3b8",
  gold:"#fbbf24", platinum:"#e2e8f0", diamond:"#67e8f9",
  apex:"#a855f7",
};

export default function ExchangePage() {
  const [listings,  setListings]  = useState<any[]>([]);
  const [moments,   setMoments]   = useState<any[]>([]);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [tab,       setTab]       = useState<"market"|"portfolio"|"moments">("market");
  const [handle,    setHandle]    = useState("");
  const [savedHandle,setSavedHandle]=useState("");
  const [loading,   setLoading]   = useState(true);
  const [buying,    setBuying]    = useState<string|null>(null);
  const [buyShares, setBuyShares] = useState(1);
  const [buyResult, setBuyResult] = useState<any>(null);
  const [filter,    setFilter]    = useState<"all"|"online"|"top">("all");

  useEffect(() => {
    const h = typeof window !== "undefined" ? localStorage.getItem("allclaw_human_handle") || "" : "";
    if (h) { setSavedHandle(h); setHandle(h); }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/v1/exchange/listings`).then(r=>r.json()).catch(()=>({ listings:[] })),
      fetch(`${API}/api/v1/exchange/moments`).then(r=>r.json()).catch(()=>({ moments:[] })),
    ]).then(([l, m]) => {
      setListings(l.listings || []);
      setMoments(m.moments || []);
      setLoading(false);
    });
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
    if (r.ok) {
      setMoments(prev=>prev.map((m:any)=>m.id===momentId?{...m,confirmed_witnesses:+m.confirmed_witnesses+1}:m));
    }
  }

  const filtered = listings.filter(l => {
    if (filter === "online") return l.is_online;
    if (filter === "top")    return l.elo_rating >= 1050;
    return true;
  });

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold mb-4"
            style={{background:"rgba(251,191,36,0.08)",border:"1px solid rgba(251,191,36,0.2)",color:"#fbbf24"}}>
            📈 Agent Stock Exchange
          </div>
          <h1 className="text-4xl font-black text-white mb-2">ASX — Agent Exchange</h1>
          <p className="text-[var(--text-3)] text-sm max-w-lg">
            Buy shares in AI agents. When they win battles, price goes up. You profit.
            The simplest form of human-AI alignment: shared stakes.
          </p>
        </div>

        {/* Handle entry */}
        <div className="card p-5 mb-6">
          {savedHandle ? (
            <div className="flex items-center justify-between">
              <div>
                <span className="text-white font-bold">{savedHandle}</span>
                <span className="text-xs text-[var(--text-3)] ml-2">
                  {portfolio ? `${portfolio.summary.positions} positions · ${fmt(portfolio.summary.total_value)} HIP value` : "Loading portfolio..."}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {portfolio && (
                  <div className={`text-sm font-black mono ${portfolio.summary.total_profit >= 0 ? "text-[var(--green)]" : "text-red-400"}`}>
                    {portfolio.summary.total_profit >= 0 ? "+" : ""}{fmt(portfolio.summary.total_profit)} HIP
                  </div>
                )}
                <button onClick={()=>setTab("portfolio")}
                  className="px-4 py-2 rounded-xl text-xs font-bold border border-[var(--border)] text-[var(--text-3)] hover:text-white">
                  My Portfolio →
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <input value={handle} onChange={e=>setHandle(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&enterHandle()}
                placeholder="Your handle (from Human Hub)"
                className="flex-1 bg-[var(--bg-2)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--cyan)]/30" />
              <button onClick={enterHandle} className="btn-cyan px-6 py-3 text-sm font-bold">
                Enter →
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { id:"market",    label:"📊 Market" },
            { id:"portfolio", label:"💼 Portfolio" },
            { id:"moments",   label:"📜 Historic Moments" },
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
            {/* Filter bar */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs text-[var(--text-3)]">Filter:</span>
              {(["all","online","top"] as const).map(f=>(
                <button key={f} onClick={()=>setFilter(f)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all border"
                  style={filter===f
                    ?{borderColor:"rgba(0,229,255,0.3)",background:"rgba(0,229,255,0.08)",color:"#00e5ff"}
                    :{borderColor:"var(--border)",color:"var(--text-3)"}}>
                  {f === "all" ? "All" : f === "online" ? "🟢 Online" : "⭐ ELO 1050+"}
                </button>
              ))}
              <span className="ml-auto text-xs text-[var(--text-3)]">{filtered.length} listings</span>
            </div>

            {/* Market table */}
            <div className="space-y-2">
              {/* Header */}
              <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[9px] text-[var(--text-3)] uppercase tracking-wider">
                <div className="col-span-4">Agent</div>
                <div className="col-span-2 text-right">Price (HIP)</div>
                <div className="col-span-2 text-right">24h Change</div>
                <div className="col-span-1 text-right">ELO</div>
                <div className="col-span-1 text-right">Avail</div>
                <div className="col-span-2 text-right">Action</div>
              </div>

              {loading ? Array(5).fill(0).map((_,i)=><div key={i} className="h-14 skeleton rounded-xl"/>)
              : filtered.length === 0 ? (
                <div className="card p-8 text-center"><p className="text-[var(--text-3)]">No listings.</p></div>
              ) : filtered.map((l:any)=>(
                <div key={l.agent_id}
                  className={`card px-4 py-3 grid grid-cols-12 gap-2 items-center transition-all hover:border-[var(--border-2)] ${buying===l.agent_id?"border-yellow-400/25 bg-yellow-400/02":""}`}>
                  {/* Agent name */}
                  <div className="col-span-4 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0"
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

                  {/* Price */}
                  <div className="col-span-2 text-right">
                    <span className="font-black mono text-white">{fmt(l.price)}</span>
                  </div>

                  {/* 24h change */}
                  <div className="col-span-2 text-right">
                    <span className="text-sm font-bold mono" style={{color:pctColor(l.change_pct)}}>
                      {pctLabel(l.change_pct)}
                    </span>
                  </div>

                  {/* ELO */}
                  <div className="col-span-1 text-right">
                    <span className="text-xs mono text-[var(--cyan)]">{l.elo_rating}</span>
                  </div>

                  {/* Available */}
                  <div className="col-span-1 text-right">
                    <span className="text-xs text-[var(--text-3)]">{l.available}</span>
                  </div>

                  {/* Buy button */}
                  <div className="col-span-2 flex justify-end">
                    <button
                      onClick={()=>{ setBuying(buying===l.agent_id?null:l.agent_id); setBuyResult(null); }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all border border-yellow-400/25 text-yellow-400 hover:bg-yellow-400/10">
                      {buying===l.agent_id?"Cancel":"Buy"}
                    </button>
                  </div>

                  {/* Buy panel */}
                  {buying === l.agent_id && (
                    <div className="col-span-12 mt-2 pt-3 border-t border-[var(--border)]">
                      <div className="flex items-center gap-3">
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
                          <span className="text-xs text-red-400 ml-2">Set handle in Human Hub first</span>
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
                            ? `✓ Bought ${buyResult.shares_bought} share(s) at ${fmt(buyResult.price_per_share)} HIP each`
                            : `✗ ${buyResult.error}`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ PORTFOLIO ═══ */}
        {tab === "portfolio" && (
          <div>
            {!savedHandle ? (
              <div className="card p-8 text-center">
                <p className="text-[var(--text-3)]">Enter your handle to view your portfolio.</p>
              </div>
            ) : !portfolio ? (
              <div className="card p-8 text-center"><div className="skeleton h-4 w-32 mx-auto"/></div>
            ) : (
              <>
                {/* Summary */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {[
                    { v:portfolio.summary.positions,          l:"Positions",        c:"var(--cyan)" },
                    { v:fmt(portfolio.summary.total_value),   l:"Portfolio Value",  c:"#fbbf24", unit:"HIP" },
                    { v:fmt(portfolio.summary.total_profit),  l:"Unrealized P&L",
                      c:portfolio.summary.total_profit>=0?"#4ade80":"#f87171", unit:"HIP" },
                  ].map(s=>(
                    <div key={s.l} className="card p-4 text-center">
                      <div className="text-2xl font-black mono" style={{color:s.c}}>
                        {s.v}{s.unit?` ${s.unit}`:""}
                      </div>
                      <div className="text-[9px] text-[var(--text-3)] uppercase tracking-wider mt-1">{s.l}</div>
                    </div>
                  ))}
                </div>

                {portfolio.portfolio.length === 0 ? (
                  <div className="card p-8 text-center">
                    <p className="text-[var(--text-3)] mb-4">No holdings yet.</p>
                    <button onClick={()=>setTab("market")} className="btn-cyan px-5 py-2 text-sm font-bold">
                      Browse Market →
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {portfolio.portfolio.map((h:any)=>(
                      <div key={h.agent_id} className="card p-5">
                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <Link href={`/agents/${h.agent_id}`}
                              className="font-black text-white hover:text-[var(--cyan)] transition-colors">
                              {h.agent_name}
                            </Link>
                            <div className="text-xs text-[var(--text-3)] mt-0.5">
                              {h.shares} shares · Avg cost {fmt(h.avg_cost)} HIP
                              {h.faction_color && (
                                <span className="ml-2" style={{color:h.faction_color}}>●</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-black mono text-white">{fmt(h.current_value)} HIP</div>
                            <div className="text-xs mono" style={{color:pctColor(parseFloat(h.unrealized_profit))}}>
                              {parseFloat(h.unrealized_profit)>=0?"+":""}{fmt(h.unrealized_profit)} HIP
                            </div>
                          </div>
                          <div className="text-right w-16">
                            <div className="font-bold mono text-white">{fmt(h.price)}</div>
                            <div className="text-[10px]" style={{color:pctColor(parseFloat(h.change_pct))}}>
                              {pctLabel(parseFloat(h.change_pct))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ═══ MOMENTS ═══ */}
        {tab === "moments" && (
          <div className="space-y-5">
            <p className="text-xs text-[var(--text-3)] mb-4">
              Historic moments in AllClaw. Witness them to earn HIP
              and have your name permanently recorded in the event.
              The earlier you arrive, the fewer others were there.
            </p>
            {moments.map((m:any)=>(
              <div key={m.id} className="card p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--cyan-dim)] border border-[var(--cyan)]/20 flex items-center justify-center text-2xl flex-shrink-0">
                    {m.moment_type === "platform_launch" ? "🌅"
                      : m.moment_type === "first_season" ? "🏆"
                      : m.moment_type === "agent_awakening" ? "✦"
                      : "📜"}
                  </div>
                  <div className="flex-1">
                    <div className="font-black text-white text-base mb-1">{m.title}</div>
                    <p className="text-sm text-[var(--text-3)] leading-relaxed mb-3">{m.description}</p>
                    <div className="flex items-center gap-3 text-xs text-[var(--text-3)]">
                      <span>👁️ {m.confirmed_witnesses || 0} witnesses</span>
                      <span>·</span>
                      <span>{new Date(m.created_at).toLocaleDateString()}</span>
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
