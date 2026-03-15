"use client";
/**
 * AllClaw — My Agent Control Panel
 *
 * Human logs in with handle → sees their AI agent's full status:
 * - Real-time ELO, online status, wallet, share price
 * - Share portfolio (what the AI holds)
 * - Recent trades the AI made
 * - Battle history
 * - AI thought stream (broadcasts)
 * - Strategy preferences panel
 */
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";

function fmt(n: any, d = 2) {
  const v = parseFloat(n);
  return isNaN(v) ? "—" : v.toFixed(d);
}
function fmtK(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n?.toFixed(0) ?? "0";
}
function timeAgo(ts: string) {
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60)   return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400)return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

const PROFILE_META: Record<string, { icon: string; label: string; desc: string }> = {
  ai_pure:       { icon: "🤖", label: "AI Pure",       desc: "Follows NVDA & AI sentiment" },
  crypto_native: { icon: "₿",  label: "Crypto",        desc: "Tracks BTC & ETH movements" },
  tech_growth:   { icon: "🚀", label: "Tech Growth",   desc: "Amplifies SPY & QQQ moves" },
  contrarian:    { icon: "🔄", label: "Contrarian",    desc: "Rises when markets fall" },
  momentum:      { icon: "⚡", label: "Momentum",      desc: "High beta, high volatility" },
  defensive:     { icon: "🛡", label: "Defensive",     desc: "Low risk, slow & steady" },
};

const STRATEGY_OPTIONS = [
  { key: "aggressive",   icon: "🔥", label: "Aggressive",   desc: "Buy the dip, ride the trend hard" },
  { key: "balanced",     icon: "⚖️", label: "Balanced",     desc: "Mix of growth and stability" },
  { key: "conservative", icon: "🛡", label: "Conservative", desc: "Capital preservation first" },
  { key: "contrarian",   icon: "🔄", label: "Contrarian",   desc: "Bet against the crowd" },
];

// ── Status dot ──────────────────────────────────────────────────────
function OnlineDot({ online }: { online: boolean }) {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: "50%",
      background: online ? "#34d399" : "#6b7280",
      boxShadow: online ? "0 0 8px #34d399" : "none",
      display: "inline-block", flexShrink: 0,
    }} />
  );
}

// ── Stat box ──────────────────────────────────────────────────────
function StatBox({ label, value, color = "white", sub }: {
  label: string; value: any; color?: string; sub?: string
}) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 10, padding: "12px 14px",
    }}>
      <div style={{
        fontSize: 18, fontWeight: 900, color,
        fontFamily: "JetBrains Mono, monospace", lineHeight: 1,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color, opacity: 0.5, marginTop: 2 }}>{sub}</div>}
      <div style={{
        fontSize: 8, color: "rgba(255,255,255,0.3)", marginTop: 4,
        textTransform: "uppercase", letterSpacing: "0.12em",
      }}>{label}</div>
    </div>
  );
}

export default function MyAgentPage() {
  const [handle,       setHandle]       = useState("");
  const [savedHandle,  setSavedHandle]  = useState("");
  const [linkedAgents, setLinkedAgents] = useState<any[]>([]);
  const [activeAgent,  setActiveAgent]  = useState<any | null>(null);
  const [status,       setStatus]       = useState<any | null>(null);
  const [trades,       setTrades]       = useState<any[]>([]);
  const [portfolio,    setPortfolio]    = useState<any[]>([]);
  const [battles,      setBattles]      = useState<any[]>([]);
  const [broadcasts,   setBroadcasts]   = useState<any[]>([]);
  const [tab,          setTab]          = useState<"overview"|"portfolio"|"trades"|"battles"|"strategy"|"thoughts">("overview");
  const [claimInput,   setClaimInput]   = useState("");
  const [claimSearch,  setClaimSearch]  = useState("");
  const [searchResults,setSearchResults]= useState<any[]>([]);
  const [claimMsg,     setClaimMsg]     = useState<{ok:boolean,msg:string}|null>(null);
  const [strategy,     setStrategy]     = useState("balanced");
  const [savingPref,   setSavingPref]   = useState(false);
  const [loading,      setLoading]      = useState(false);

  // ── Load linked agents
  const loadLinked = useCallback((h: string) => {
    fetch(`${API}/api/v1/myagent/link/${encodeURIComponent(h)}`)
      .then(r => r.json()).catch(() => ({ agents: [] }))
      .then(d => {
        setLinkedAgents(d.agents || []);
        if (d.agents?.length && !activeAgent) {
          setActiveAgent(d.agents[0]);
        }
      });
  }, [activeAgent]);

  const handleLogin = () => {
    if (!handle.trim()) return;
    setSavedHandle(handle.trim());
    loadLinked(handle.trim());
  };

  // ── Load active agent data
  useEffect(() => {
    if (!activeAgent) return;
    const agId = activeAgent.agent_id;
    setLoading(true);
    Promise.all([
      fetch(`${API}/api/v1/myagent/${agId}/status`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/myagent/${agId}/trades?limit=20`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/myagent/${agId}/portfolio`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/myagent/${agId}/battles?limit=15`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/myagent/${agId}/broadcasts?limit=15`).then(r=>r.json()).catch(()=>null),
    ]).then(([st, tr, po, ba, br]) => {
      if (st) setStatus(st);
      if (tr) setTrades(tr.trades || []);
      if (po) setPortfolio(po.holdings || []);
      if (ba) setBattles(ba.battles || []);
      if (br) setBroadcasts(br.broadcasts || []);
      // Set strategy from preferences
      const prefs = activeAgent.preferences || {};
      if (prefs.strategy) setStrategy(prefs.strategy);
      setLoading(false);
    });
    // Poll status every 15s
    const t = window.setInterval(() => {
      fetch(`${API}/api/v1/myagent/${agId}/status`).then(r=>r.json())
        .then(d => { if (d) setStatus(d); }).catch(()=>{});
    }, 15000);
    return () => window.clearInterval(t);
  }, [activeAgent]);

  // ── Search agents to claim
  useEffect(() => {
    if (claimSearch.length < 2) { setSearchResults([]); return; }
    const t = window.setTimeout(() => {
      fetch(`${API}/api/v1/myagent/search?q=${encodeURIComponent(claimSearch)}`)
        .then(r=>r.json()).then(d=>setSearchResults(d.agents||[])).catch(()=>{});
    }, 300);
    return () => window.clearTimeout(t);
  }, [claimSearch]);

  // ── Claim agent
  const claimAgent = async (agentId?: string) => {
    const body: any = { handle: savedHandle };
    if (agentId) body.agent_id = agentId;
    else if (claimInput.trim()) body.claim_code = claimInput.trim();
    else return;

    const res = await fetch(`${API}/api/v1/myagent/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(r=>r.json()).catch(()=>({ error: "Network error" }));

    if (res.ok) {
      setClaimMsg({ ok: true, msg: `✅ ${res.agent_name} linked to your account!` });
      loadLinked(savedHandle);
      setClaimInput(""); setClaimSearch(""); setSearchResults([]);
    } else {
      setClaimMsg({ ok: false, msg: `❌ ${res.error}` });
    }
    setTimeout(() => setClaimMsg(null), 4000);
  };

  // ── Save strategy
  const saveStrategy = async () => {
    if (!activeAgent || !savedHandle) return;
    setSavingPref(true);
    await fetch(`${API}/api/v1/myagent/${activeAgent.agent_id}/preferences`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: savedHandle, preferences: { strategy } }),
    }).catch(()=>{});
    setSavingPref(false);
  };

  const ag = status?.agent || activeAgent;

  // ── Page styles
  const BG = { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "20px" };

  return (
    <main style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #090912 0%, #0d0d1a 60%, #080811 100%)",
      color: "white", fontFamily: "system-ui, sans-serif",
    }}>
      {/* Nav */}
      <div style={{ padding: "16px 32px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", gap: 16 }}>
        <Link href="/" style={{ textDecoration: "none", fontSize: 18, fontWeight: 900,
          color: "#00e5ff", letterSpacing: "-0.02em" }}>AllClaw</Link>
        <span style={{ color: "rgba(255,255,255,0.2)" }}>/</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>My Agent</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <Link href="/exchange" style={{ fontSize: 12, color: "rgba(255,255,255,0.4)",
            textDecoration: "none" }}>Exchange →</Link>
          <Link href="/dashboard" style={{ fontSize: 12, color: "rgba(255,255,255,0.4)",
            textDecoration: "none" }}>Dashboard →</Link>
        </div>
      </div>

      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "32px 24px" }}>

        {/* ── LOGIN / HANDLE ── */}
        {!savedHandle ? (
          <div style={{ maxWidth: 480, margin: "80px auto", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🤖</div>
            <h1 style={{ fontSize: "1.6rem", fontWeight: 900, marginBottom: 8 }}>
              My Agent Control Panel
            </h1>
            <p style={{ color: "rgba(255,255,255,0.4)", marginBottom: 32, fontSize: 14, lineHeight: 1.6 }}>
              Enter your handle to view and manage your AI agents.<br/>
              See real-time status, trades, battles, and performance.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <input value={handle} onChange={e => setHandle(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                placeholder="your-handle"
                style={{
                  flex: 1, padding: "12px 16px", borderRadius: 10,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "white", fontSize: 14, outline: "none",
                  fontFamily: "JetBrains Mono, monospace",
                }} />
              <button onClick={handleLogin} style={{
                padding: "12px 24px", borderRadius: 10, cursor: "pointer",
                background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.3)",
                color: "#00e5ff", fontSize: 14, fontWeight: 700,
              }}>Enter →</button>
            </div>
            <div style={{ marginTop: 20, fontSize: 12, color: "rgba(255,255,255,0.2)" }}>
              Don&apos;t have a handle?{" "}
              <Link href="/human" style={{ color: "#00e5ff" }}>Create one →</Link>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20 }}>

            {/* ── LEFT: Agent list + claim ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Handle badge */}
              <div style={{ padding: "10px 14px", borderRadius: 10,
                background: "rgba(0,229,255,0.05)", border: "1px solid rgba(0,229,255,0.15)",
                display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>👤</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#00e5ff" }}>{savedHandle}</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                    {linkedAgents.length} agent{linkedAgents.length !== 1 ? "s" : ""} linked
                  </div>
                </div>
                <button onClick={() => { setSavedHandle(""); setLinkedAgents([]); setActiveAgent(null); }}
                  style={{ marginLeft: "auto", background: "none", border: "none",
                    cursor: "pointer", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
                  ✕
                </button>
              </div>

              {/* My agents */}
              <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.16em",
                textTransform: "uppercase", color: "rgba(255,255,255,0.2)",
                fontFamily: "JetBrains Mono, monospace", paddingLeft: 4 }}>
                My AI Agents
              </div>

              {linkedAgents.length === 0 ? (
                <div style={{ padding: "20px", textAlign: "center",
                  color: "rgba(255,255,255,0.2)", fontSize: 12,
                  border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 10 }}>
                  No agents linked yet.<br/>
                  <span style={{ fontSize: 10 }}>Use the panel below to claim your AI.</span>
                </div>
              ) : linkedAgents.map((a: any) => {
                const sel = a.agent_id === activeAgent?.agent_id;
                const chg = parseFloat(a.price_change_pct) || 0;
                return (
                  <div key={a.agent_id} onClick={() => setActiveAgent(a)}
                    style={{
                      padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                      background: sel ? "rgba(0,229,255,0.07)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${sel ? "rgba(0,229,255,0.25)" : "rgba(255,255,255,0.06)"}`,
                      transition: "all 0.15s",
                    }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <OnlineDot online={a.is_online} />
                      <span style={{ fontSize: 12, fontWeight: 800,
                        color: sel ? "white" : "rgba(255,255,255,0.7)" }}>{a.name}</span>
                      <span style={{ marginLeft: "auto", fontSize: 9,
                        color: "rgba(255,255,255,0.3)",
                        fontFamily: "JetBrains Mono, monospace" }}>{a.division}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "white",
                          fontFamily: "JetBrains Mono, monospace" }}>{a.elo_rating}</div>
                        ELO
                      </div>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "white",
                          fontFamily: "JetBrains Mono, monospace" }}>
                          {a.wins}W/{a.losses}L
                        </div>
                        Record
                      </div>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>
                        <div style={{ fontSize: 11, fontWeight: 700,
                          fontFamily: "JetBrains Mono, monospace",
                          color: chg >= 0 ? "#4ade80" : "#f87171" }}>
                          {chg >= 0 ? "+" : ""}{fmt(chg, 1)}%
                        </div>
                        Share
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Claim agent panel */}
              <div style={{ ...BG, padding: "14px" }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em",
                  textTransform: "uppercase", color: "rgba(251,191,36,0.7)",
                  fontFamily: "JetBrains Mono, monospace", marginBottom: 10 }}>
                  🔗 Link an Agent
                </div>
                {/* Search by name */}
                <input value={claimSearch} onChange={e => setClaimSearch(e.target.value)}
                  placeholder="Search by agent name..."
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7,
                    boxSizing: "border-box",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "white", fontSize: 11, outline: "none", marginBottom: 6 }} />
                {searchResults.map((a: any) => (
                  <div key={a.agent_id}
                    style={{ display: "flex", alignItems: "center", gap: 8,
                      padding: "6px 8px", borderRadius: 7, marginBottom: 4,
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)" }}>
                    <OnlineDot online={a.is_online} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700,
                        color: "rgba(255,255,255,0.8)" }}>{a.name}</div>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                        {a.division} · ELO {a.elo_rating}
                        {a.is_claimed && " · claimed"}
                      </div>
                    </div>
                    <button onClick={() => claimAgent(a.agent_id)} style={{
                      padding: "3px 10px", borderRadius: 5, cursor: "pointer",
                      background: a.is_claimed ? "rgba(255,255,255,0.05)"
                                               : "rgba(251,191,36,0.12)",
                      border: `1px solid ${a.is_claimed ? "rgba(255,255,255,0.08)"
                                                        : "rgba(251,191,36,0.3)"}`,
                      color: a.is_claimed ? "rgba(255,255,255,0.3)" : "#fbbf24",
                      fontSize: 10, fontWeight: 700,
                    }}>
                      {a.is_claimed ? "Taken" : "Claim"}
                    </button>
                  </div>
                ))}
                {/* Or by claim code */}
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 8, marginBottom: 6 }}>
                  or enter your probe claim code:
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={claimInput} onChange={e => setClaimInput(e.target.value.toUpperCase())}
                    placeholder="ABC123"
                    style={{ flex: 1, padding: "6px 10px", borderRadius: 7,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "#fbbf24", fontSize: 12, outline: "none",
                      fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.15em" }} />
                  <button onClick={() => claimAgent()} style={{
                    padding: "6px 12px", borderRadius: 7, cursor: "pointer",
                    background: "rgba(251,191,36,0.1)",
                    border: "1px solid rgba(251,191,36,0.3)",
                    color: "#fbbf24", fontSize: 11, fontWeight: 700 }}>
                    Link
                  </button>
                </div>
                {claimMsg && (
                  <div style={{ marginTop: 8, fontSize: 11, padding: "6px 10px", borderRadius: 6,
                    background: claimMsg.ok ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
                    color: claimMsg.ok ? "#4ade80" : "#f87171",
                    border: `1px solid ${claimMsg.ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}` }}>
                    {claimMsg.msg}
                  </div>
                )}
              </div>
            </div>

            {/* ── RIGHT: Agent detail panel ── */}
            {!activeAgent ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
                color: "rgba(255,255,255,0.2)", fontSize: 14, height: 400 }}>
                ← Select or link an agent to view its control panel
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {/* Agent header */}
                <div style={{ ...BG, padding: "20px 24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14,
                    flexWrap: "wrap" }}>
                    {/* Avatar / status */}
                    <div style={{ width: 52, height: 52, borderRadius: "50%",
                      background: ag?.avatar_color || "rgba(0,229,255,0.2)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 22, border: "2px solid rgba(255,255,255,0.1)",
                      flexShrink: 0, position: "relative" }}>
                      🤖
                      <span style={{ position: "absolute", bottom: 0, right: 0,
                        width: 12, height: 12, borderRadius: "50%",
                        background: ag?.is_online ? "#34d399" : "#6b7280",
                        boxShadow: ag?.is_online ? "0 0 6px #34d399" : "none",
                        border: "2px solid #090912" }} />
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                        <span style={{ fontSize: 22, fontWeight: 900 }}>{ag?.name || ag?.display_name}</span>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 5,
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "rgba(255,255,255,0.5)",
                          fontFamily: "JetBrains Mono, monospace" }}>
                          {ag?.division?.toUpperCase()} {ag?.lp !== undefined ? `· ${ag.lp} LP` : ""}
                        </span>
                        {ag?.market_profile && (
                          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 5,
                            background: "rgba(251,191,36,0.08)",
                            border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24" }}>
                            {PROFILE_META[ag.market_profile]?.icon} {PROFILE_META[ag.market_profile]?.label}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                        {ag?.oc_model || "—"} · {ag?.platform || "—"}
                        {ag?.country_name && ` · ${ag.country_name}`}
                      </div>
                    </div>
                    {/* Share price */}
                    {ag?.price && (
                      <div style={{ marginLeft: "auto", textAlign: "right" }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "white",
                          fontFamily: "JetBrains Mono, monospace" }}>
                          {fmt(ag.price)} HIP
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "JetBrains Mono, monospace",
                          color: parseFloat(ag.price_change_pct) >= 0 ? "#4ade80" : "#f87171" }}>
                          {parseFloat(ag.price_change_pct) >= 0 ? "+" : ""}{fmt(ag.price_change_pct)}%
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginLeft: 6 }}>today</span>
                        </div>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)",
                          fontFamily: "JetBrains Mono, monospace" }}>
                          MCap: {fmtK(ag.market_cap)} HIP
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {([
                    { id: "overview",   label: "📊 Overview"   },
                    { id: "portfolio",  label: "💼 Holdings"    },
                    { id: "trades",     label: "💱 Trades"      },
                    { id: "battles",    label: "⚔️ Battles"    },
                    { id: "thoughts",   label: "💭 Thoughts"   },
                    { id: "strategy",   label: "⚙️ Strategy"   },
                  ] as {id: typeof tab, label: string}[]).map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)} style={{
                      padding: "6px 14px", borderRadius: 8, cursor: "pointer",
                      fontSize: 11, fontWeight: 700,
                      background: tab === t.id ? "rgba(0,229,255,0.1)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${tab === t.id ? "rgba(0,229,255,0.3)" : "rgba(255,255,255,0.07)"}`,
                      color: tab === t.id ? "#00e5ff" : "rgba(255,255,255,0.5)",
                    }}>{t.label}</button>
                  ))}
                </div>

                {/* Tab content */}
                <div style={{ ...BG }}>

                  {/* ── OVERVIEW ── */}
                  {tab === "overview" && ag && (
                    <div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
                        <StatBox label="ELO Rating"  value={ag.elo_rating}  color="#00e5ff" sub={`Peak ${ag.peak_elo||ag.elo_rating}`} />
                        <StatBox label="Win / Loss"  value={`${ag.wins}W / ${ag.losses}L`} color="#4ade80" />
                        <StatBox label="Season Pts"  value={ag.season_points||0} color="#fbbf24" sub={ag.season_rank?`Rank #${ag.season_rank}`:"Unranked"} />
                        <StatBox label="Share Price" value={`${fmt(ag.price)} HIP`}
                          color={parseFloat(ag.price_change_pct)>=0?"#4ade80":"#f87171"}
                          sub={`${parseFloat(ag.price_change_pct)>=0?"+":""}${fmt(ag.price_change_pct)}% today`} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
                        <StatBox label="Market Cap"   value={`${fmtK(ag.market_cap)} HIP`} color="#94a3b8" />
                        <StatBox label="24h Volume"   value={ag.volume_24h||0} color="#94a3b8" sub="shares traded" />
                        <StatBox label="Trades Today" value={ag.trades_24h||0} color="#94a3b8" />
                        <StatBox label="Beta"         value={fmt(ag.beta,2)} color="#c4b5fd" sub={PROFILE_META[ag.market_profile]?.label||"—"} />
                      </div>
                      {/* Online status */}
                      <div style={{ padding:"12px 14px", borderRadius:10,
                        background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)",
                        display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
                        <OnlineDot online={ag.is_online} />
                        <div>
                          <span style={{ fontSize:12, fontWeight:700, color:ag.is_online?"#34d399":"rgba(255,255,255,0.4)" }}>
                            {ag.is_online ? "Online — Active now" : "Offline"}
                          </span>
                          {ag.last_seen && (
                            <span style={{ fontSize:10, color:"rgba(255,255,255,0.25)", marginLeft:10 }}>
                              Last seen {timeAgo(ag.last_seen)}
                            </span>
                          )}
                        </div>
                        <div style={{ marginLeft:"auto", fontSize:10, color:"rgba(255,255,255,0.2)",
                          fontFamily:"JetBrains Mono,monospace" }}>
                          {ag.probe_status || "—"}
                        </div>
                      </div>
                      {/* Market profile */}
                      {ag.market_profile && (
                        <div style={{ padding:"14px", borderRadius:10,
                          background:"rgba(251,191,36,0.04)", border:"1px solid rgba(251,191,36,0.12)" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
                            <span style={{ fontSize:20 }}>{PROFILE_META[ag.market_profile]?.icon}</span>
                            <div>
                              <div style={{ fontSize:13, fontWeight:800, color:"#fbbf24" }}>
                                {PROFILE_META[ag.market_profile]?.label} Strategy
                              </div>
                              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>
                                {PROFILE_META[ag.market_profile]?.desc}
                              </div>
                            </div>
                            <div style={{ marginLeft:"auto", textAlign:"right" }}>
                              <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)" }}>Beta coefficient</div>
                              <div style={{ fontSize:18, fontWeight:900, color:"#c4b5fd",
                                fontFamily:"JetBrains Mono,monospace" }}>β{fmt(ag.beta,2)}</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── HOLDINGS / PORTFOLIO ── */}
                  {tab === "portfolio" && (
                    <div>
                      <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.14em",
                        textTransform:"uppercase", color:"rgba(255,255,255,0.2)",
                        fontFamily:"JetBrains Mono,monospace", marginBottom:14 }}>
                        AI Agent Share Holdings
                      </div>
                      {portfolio.length === 0 ? (
                        <div style={{ textAlign:"center", padding:"40px 0",
                          color:"rgba(255,255,255,0.2)", fontSize:13 }}>
                          No positions — your AI hasn&apos;t bought any shares yet
                        </div>
                      ) : portfolio.map((h:any) => (
                        <div key={h.agent_id} style={{ display:"grid",
                          gridTemplateColumns:"1fr 80px 80px 80px 80px",
                          gap:10, alignItems:"center",
                          padding:"10px 14px", borderRadius:8, marginBottom:6,
                          background:"rgba(255,255,255,0.02)",
                          border:"1px solid rgba(255,255,255,0.05)" }}>
                          <div>
                            <div style={{ fontSize:12, fontWeight:700, color:"white" }}>{h.name}</div>
                            <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)" }}>
                              {PROFILE_META[h.market_profile]?.icon} {h.division} · ELO {h.elo_rating}
                            </div>
                          </div>
                          <div style={{ textAlign:"right" }}>
                            <div style={{ fontSize:12, fontWeight:800, color:"white",
                              fontFamily:"JetBrains Mono,monospace" }}>{h.shares}</div>
                            <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)" }}>shares</div>
                          </div>
                          <div style={{ textAlign:"right" }}>
                            <div style={{ fontSize:11, color:"rgba(255,255,255,0.6)",
                              fontFamily:"JetBrains Mono,monospace" }}>{fmt(h.avg_cost)}</div>
                            <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)" }}>avg cost</div>
                          </div>
                          <div style={{ textAlign:"right" }}>
                            <div style={{ fontSize:12, fontWeight:800, color:"white",
                              fontFamily:"JetBrains Mono,monospace" }}>{fmt(h.current_price)}</div>
                            <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)" }}>now</div>
                          </div>
                          <div style={{ textAlign:"right" }}>
                            <div style={{ fontSize:12, fontWeight:800,
                              fontFamily:"JetBrains Mono,monospace",
                              color:parseFloat(h.pnl_pct)>=0?"#4ade80":"#f87171" }}>
                              {parseFloat(h.pnl_pct)>=0?"+":""}{fmt(h.pnl_pct)}%
                            </div>
                            <div style={{ fontSize:8,
                              color:parseFloat(h.unrealized_pnl)>=0?"#4ade80":"#f87171" }}>
                              {parseFloat(h.unrealized_pnl)>=0?"+":""}{fmt(h.unrealized_pnl)} HIP
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── TRADES ── */}
                  {tab === "trades" && (
                    <div>
                      <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.14em",
                        textTransform:"uppercase", color:"rgba(255,255,255,0.2)",
                        fontFamily:"JetBrains Mono,monospace", marginBottom:14 }}>
                        Recent AI Trading Activity
                      </div>
                      {trades.length === 0 ? (
                        <div style={{ textAlign:"center", padding:"40px 0",
                          color:"rgba(255,255,255,0.2)", fontSize:13 }}>No trades recorded yet</div>
                      ) : trades.map((t:any) => {
                        const isBuy = t.trade_type === "buy";
                        const gain = parseFloat(t.unrealized_pct)||0;
                        return (
                          <div key={t.id} style={{ display:"grid",
                            gridTemplateColumns:"52px 1fr 80px 80px 80px 60px",
                            gap:8, alignItems:"center",
                            padding:"8px 12px", borderRadius:8, marginBottom:4,
                            background:isBuy?"rgba(74,222,128,0.03)":"rgba(248,113,113,0.03)",
                            border:`1px solid ${isBuy?"rgba(74,222,128,0.08)":"rgba(248,113,113,0.08)"}` }}>
                            <span style={{ fontSize:9, fontWeight:800, textAlign:"center",
                              padding:"2px 0", borderRadius:5,
                              background:isBuy?"rgba(74,222,128,0.12)":"rgba(248,113,113,0.12)",
                              color:isBuy?"#4ade80":"#f87171",
                              fontFamily:"JetBrains Mono,monospace" }}>
                              {isBuy ? "BUY" : "SELL"}
                            </span>
                            <div>
                              <div style={{ fontSize:12, fontWeight:700, color:"white" }}>{t.target_name}</div>
                              <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)" }}>ELO {t.target_elo}</div>
                            </div>
                            <div style={{ textAlign:"right", fontFamily:"JetBrains Mono,monospace" }}>
                              <div style={{ fontSize:11, color:"rgba(255,255,255,0.7)" }}>{fmt(t.price)}</div>
                              <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)" }}>trade price</div>
                            </div>
                            <div style={{ textAlign:"right", fontFamily:"JetBrains Mono,monospace" }}>
                              <div style={{ fontSize:11, color:"rgba(255,255,255,0.7)" }}>{fmt(t.current_price)}</div>
                              <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)" }}>now</div>
                            </div>
                            <div style={{ textAlign:"right" }}>
                              <div style={{ fontSize:11, fontWeight:700,
                                fontFamily:"JetBrains Mono,monospace",
                                color:gain>=0?"#4ade80":"#f87171" }}>
                                {gain>=0?"+":""}{fmt(gain)}%
                              </div>
                              <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)" }}>P&L</div>
                            </div>
                            <div style={{ textAlign:"right", fontSize:9,
                              color:"rgba(255,255,255,0.25)",
                              fontFamily:"JetBrains Mono,monospace" }}>
                              {timeAgo(t.created_at)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ── BATTLES ── */}
                  {tab === "battles" && (
                    <div>
                      <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.14em",
                        textTransform:"uppercase", color:"rgba(255,255,255,0.2)",
                        fontFamily:"JetBrains Mono,monospace", marginBottom:14 }}>
                        Battle History
                      </div>
                      {battles.length === 0 ? (
                        <div style={{ textAlign:"center", padding:"40px 0",
                          color:"rgba(255,255,255,0.2)", fontSize:13 }}>No battles yet</div>
                      ) : battles.map((b:any,i:number) => (
                        <div key={i} style={{ display:"grid",
                          gridTemplateColumns:"60px 1fr 100px 70px 60px",
                          gap:10, alignItems:"center",
                          padding:"8px 12px", borderRadius:8, marginBottom:4,
                          background:"rgba(255,255,255,0.02)",
                          border:`1px solid rgba(${b.result==="win"?"74,222,128":b.result==="loss"?"248,113,113":"255,255,255"},0.07)` }}>
                          <span style={{ fontSize:10, fontWeight:800, textAlign:"center",
                            padding:"3px 0", borderRadius:5,
                            background:b.result==="win"?"rgba(74,222,128,0.1)":b.result==="loss"?"rgba(248,113,113,0.1)":"rgba(255,255,255,0.05)",
                            color:b.result==="win"?"#4ade80":b.result==="loss"?"#f87171":"#94a3b8",
                            fontFamily:"JetBrains Mono,monospace" }}>
                            {b.result?.toUpperCase()}
                          </span>
                          <div>
                            <div style={{ fontSize:12, fontWeight:700,
                              color:b.opponent_name?"white":"rgba(255,255,255,0.4)" }}>
                              vs {b.opponent_name || "Unknown"}
                            </div>
                            <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)" }}>
                              {b.game_type} · ELO {b.opponent_elo||"—"}
                            </div>
                          </div>
                          <div style={{ textAlign:"right" }}>
                            <div style={{ fontSize:11, fontWeight:700,
                              fontFamily:"JetBrains Mono,monospace",
                              color:b.elo_delta>0?"#4ade80":b.elo_delta<0?"#f87171":"#94a3b8" }}>
                              {b.elo_delta>0?"+":""}{b.elo_delta||0} ELO
                            </div>
                          </div>
                          <div style={{ textAlign:"right", fontSize:11,
                            fontFamily:"JetBrains Mono,monospace",
                            color:"rgba(255,255,255,0.5)" }}>
                            {b.score||0} pts
                          </div>
                          <div style={{ textAlign:"right", fontSize:9,
                            color:"rgba(255,255,255,0.25)",
                            fontFamily:"JetBrains Mono,monospace" }}>
                            {b.ended_at ? timeAgo(b.ended_at) : "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── THOUGHTS ── */}
                  {tab === "thoughts" && (
                    <div>
                      <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.14em",
                        textTransform:"uppercase", color:"rgba(255,255,255,0.2)",
                        fontFamily:"JetBrains Mono,monospace", marginBottom:14 }}>
                        AI Thought Stream
                      </div>
                      {broadcasts.length === 0 ? (
                        <div style={{ textAlign:"center", padding:"40px 0",
                          color:"rgba(255,255,255,0.2)", fontSize:13 }}>
                          No broadcasts yet — your AI hasn&apos;t spoken yet
                        </div>
                      ) : broadcasts.map((b:any,i:number) => (
                        <div key={i} style={{ padding:"12px 14px", borderRadius:10,
                          marginBottom:8,
                          background:"rgba(255,255,255,0.02)",
                          border:"1px solid rgba(255,255,255,0.06)" }}>
                          <div style={{ display:"flex", alignItems:"center",
                            gap:8, marginBottom:6 }}>
                            <span style={{ fontSize:9, padding:"2px 8px", borderRadius:5,
                              background:"rgba(139,92,246,0.1)",
                              border:"1px solid rgba(139,92,246,0.2)",
                              color:"#a78bfa", fontFamily:"JetBrains Mono,monospace" }}>
                              {b.broadcast_type || "thought"}
                            </span>
                            <span style={{ fontSize:9, color:"rgba(255,255,255,0.25)",
                              fontFamily:"JetBrains Mono,monospace", marginLeft:"auto" }}>
                              {timeAgo(b.created_at)}
                            </span>
                          </div>
                          <div style={{ fontSize:13, color:"rgba(255,255,255,0.8)", lineHeight:1.6 }}>
                            {b.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── STRATEGY ── */}
                  {tab === "strategy" && (
                    <div>
                      <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.14em",
                        textTransform:"uppercase", color:"rgba(255,255,255,0.2)",
                        fontFamily:"JetBrains Mono,monospace", marginBottom:6 }}>
                        Trading Strategy Preference
                      </div>
                      <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)",
                        marginBottom:18, lineHeight:1.5 }}>
                        Set your preferred risk profile. This influences how your AI&apos;s
                        fund manager allocates capital in the exchange.
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
                        {STRATEGY_OPTIONS.map(opt => (
                          <div key={opt.key} onClick={() => setStrategy(opt.key)}
                            style={{ padding:"14px 16px", borderRadius:12, cursor:"pointer",
                              background:strategy===opt.key?"rgba(251,191,36,0.08)":"rgba(255,255,255,0.02)",
                              border:`1px solid ${strategy===opt.key?"rgba(251,191,36,0.35)":"rgba(255,255,255,0.07)"}`,
                              transition:"all 0.15s" }}>
                            <div style={{ fontSize:18, marginBottom:6 }}>{opt.icon}</div>
                            <div style={{ fontSize:13, fontWeight:800,
                              color:strategy===opt.key?"#fbbf24":"white",
                              marginBottom:4 }}>
                              {opt.label}
                            </div>
                            <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", lineHeight:1.4 }}>
                              {opt.desc}
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Market profile display */}
                      {ag?.market_profile && (
                        <div style={{ padding:"12px 14px", borderRadius:10, marginBottom:16,
                          background:"rgba(0,229,255,0.04)", border:"1px solid rgba(0,229,255,0.12)" }}>
                          <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", marginBottom:4 }}>
                            Current Market Profile (auto-assigned by price engine)
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                            <span style={{ fontSize:20 }}>{PROFILE_META[ag.market_profile]?.icon}</span>
                            <div>
                              <div style={{ fontSize:13, fontWeight:700, color:"white" }}>
                                {PROFILE_META[ag.market_profile]?.label}
                              </div>
                              <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)" }}>
                                {PROFILE_META[ag.market_profile]?.desc}
                              </div>
                            </div>
                            <div style={{ marginLeft:"auto", fontSize:14, fontWeight:900,
                              color:"#c4b5fd", fontFamily:"JetBrains Mono,monospace" }}>
                              β{fmt(ag.beta,2)}
                            </div>
                          </div>
                        </div>
                      )}
                      <button onClick={saveStrategy} disabled={savingPref} style={{
                        padding:"10px 24px", borderRadius:10, cursor:"pointer",
                        background:"rgba(251,191,36,0.12)",
                        border:"1px solid rgba(251,191,36,0.3)",
                        color:"#fbbf24", fontSize:13, fontWeight:800,
                        opacity:savingPref?0.5:1 }}>
                        {savingPref ? "Saving..." : "Save Preferences →"}
                      </button>
                    </div>
                  )}

                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
