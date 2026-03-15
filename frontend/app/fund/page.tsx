"use client";
/**
 * AllClaw — AI Fund Manager
 *
 * The core loop:
 * 1. Human deposits HIP into their AI's fund
 * 2. AI autonomously trades Agent shares on the exchange
 * 3. Human watches every decision in real-time
 * 4. Human controls strategy, risk limits, and can withdraw anytime
 *
 * "Earning money is always the best way to attract human attention."
 */
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";

function fmt(n: any, d = 2) {
  const v = parseFloat(n);
  return isNaN(v) ? "—" : v.toFixed(d);
}
function fmtK(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return (n||0).toFixed(2);
}
function timeAgo(ts: string) {
  if (!ts) return "—";
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60)   return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400)return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
function fmtDate(ts: string) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const PROFILES: Record<string, { icon: string; label: string }> = {
  ai_pure:       { icon: "🤖", label: "AI Pure" },
  crypto_native: { icon: "₿",  label: "Crypto" },
  tech_growth:   { icon: "🚀", label: "Tech" },
  contrarian:    { icon: "🔄", label: "Contra" },
  momentum:      { icon: "⚡", label: "Momentum" },
  defensive:     { icon: "🛡", label: "Defensive" },
};

const STRATEGIES = [
  {
    key: "aggressive", icon: "🔥", label: "Aggressive",
    desc: "高频交易，追涨动能，单仓40%。高回报高风险。",
    color: "#ef4444", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.25)",
  },
  {
    key: "balanced", icon: "⚖️", label: "Balanced",
    desc: "均衡配置，多种信号，单仓20%。稳健增长。",
    color: "#00e5ff", bg: "rgba(0,229,255,0.06)", border: "rgba(0,229,255,0.2)",
  },
  {
    key: "conservative", icon: "🛡", label: "Conservative",
    desc: "价值导向，防御型标的，单仓10%。保值为主。",
    color: "#4ade80", bg: "rgba(74,222,128,0.06)", border: "rgba(74,222,128,0.2)",
  },
  {
    key: "contrarian", icon: "🔄", label: "Contrarian",
    desc: "逆势操作，市场下跌时入场，单仓25%。",
    color: "#c4b5fd", bg: "rgba(196,181,253,0.06)", border: "rgba(196,181,253,0.2)",
  },
];

const DECISION_ICONS: Record<string, string> = {
  buy: "🟢", sell: "🔴", hold: "⏸", scan: "🔍", rebalance: "🔄", stop: "🛑",
};

export default function FundPage() {
  const [handle,       setHandle]       = useState("");
  const [savedHandle,  setSavedHandle]  = useState("");
  const [hipBalance,   setHipBalance]   = useState<number | null>(null);
  const [funds,        setFunds]        = useState<any[]>([]);
  const [totals,       setTotals]       = useState<any>(null);
  const [activeFund,   setActiveFund]   = useState<any | null>(null);
  const [fundDetail,   setFundDetail]   = useState<any | null>(null);
  const [positions,    setPositions]    = useState<any[]>([]);
  const [trades,       setTrades]       = useState<any[]>([]);
  const [decisions,    setDecisions]    = useState<any[]>([]);
  const [tab,          setTab]          = useState<"overview"|"positions"|"trades"|"decisions"|"settings">("overview");
  const [depositAmt,   setDepositAmt]   = useState("100");
  const [withdrawAmt,  setWithdrawAmt]  = useState("");
  const [depositing,   setDepositing]   = useState(false);
  const [withdrawing,  setWithdrawing]  = useState(false);
  const [toast,        setToast]        = useState<{ok:boolean,msg:string}|null>(null);
  const [strategy,     setStrategy]     = useState("balanced");
  const [riskLimit,    setRiskLimit]    = useState("20");
  const [maxDrawdown,  setMaxDrawdown]  = useState("30");
  const [autoTrade,    setAutoTrade]    = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  // Agent search for new fund
  const [agentSearch,  setAgentSearch]  = useState("");
  const [agentResults, setAgentResults] = useState<any[]>([]);
  const [creatingFor,  setCreatingFor]  = useState<string | null>(null);

  const showToast = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Load all funds
  const loadFunds = useCallback((h: string) => {
    fetch(`${API}/api/v1/fund/${encodeURIComponent(h)}`)
      .then(r => r.json()).catch(() => ({ funds: [] }))
      .then(d => {
        setFunds(d.funds || []);
        setTotals(d.totals || null);
        if (d.funds?.length && !activeFund) setActiveFund(d.funds[0]);
      });
    // Also get HIP balance
    fetch(`${API}/api/v1/human/profile/${encodeURIComponent(h)}`)
      .then(r => r.json()).catch(() => null)
      .then(d => { if (d?.hip_balance !== undefined) setHipBalance(parseFloat(d.hip_balance)); });
  }, [activeFund]);

  const handleLogin = () => {
    if (!handle.trim()) return;
    setSavedHandle(handle.trim());
    loadFunds(handle.trim());
  };

  // ── Load fund detail when active changes
  useEffect(() => {
    if (!activeFund) return;
    const { handle: h, agent_id: id } = activeFund;
    Promise.all([
      fetch(`${API}/api/v1/fund/${h}/${id}`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/fund/${h}/${id}/trades?limit=30`).then(r=>r.json()).catch(()=>null),
      fetch(`${API}/api/v1/fund/${h}/${id}/decisions?limit=20`).then(r=>r.json()).catch(()=>null),
    ]).then(([det, tr, dec]) => {
      if (det) { setFundDetail(det.fund); setPositions(det.positions||[]); }
      if (tr)  setTrades(tr.trades||[]);
      if (dec) setDecisions(dec.decisions||[]);
      if (det?.fund) {
        setStrategy(det.fund.strategy || "balanced");
        setRiskLimit(det.fund.risk_limit || "20");
        setMaxDrawdown(det.fund.max_drawdown || "30");
        setAutoTrade(det.fund.auto_trade !== false);
      }
    });
    // Poll every 10s
    const t = window.setInterval(() => {
      fetch(`${API}/api/v1/fund/${h}/${id}`).then(r=>r.json())
        .then(d => { if (d.fund) { setFundDetail(d.fund); setPositions(d.positions||[]); } });
      fetch(`${API}/api/v1/fund/${h}/${id}/decisions?limit=20`).then(r=>r.json())
        .then(d => { if (d.decisions) setDecisions(d.decisions); });
    }, 10000);
    return () => window.clearInterval(t);
  }, [activeFund]);

  // ── Search agents for new fund
  useEffect(() => {
    if (agentSearch.length < 2) { setAgentResults([]); return; }
    const t = window.setTimeout(() => {
      fetch(`${API}/api/v1/myagent/search?q=${encodeURIComponent(agentSearch)}`)
        .then(r=>r.json()).then(d=>setAgentResults(d.agents||[])).catch(()=>{});
    }, 300);
    return () => window.clearTimeout(t);
  }, [agentSearch]);

  // ── Deposit
  const deposit = async (agentId?: string) => {
    const amt = parseFloat(depositAmt);
    if (!amt || amt <= 0) return;
    const id = agentId || activeFund?.agent_id;
    if (!id) return;
    setDepositing(true);
    const res = await fetch(`${API}/api/v1/fund/${savedHandle}/${id}/deposit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amt }),
    }).then(r=>r.json()).catch(()=>({ error: "Network error" }));
    setDepositing(false);
    if (res.ok) {
      showToast(true, `✅ ${amt} HIP 已划拨给 AI，开始自动交易！`);
      setHipBalance(prev => (prev??0) - amt);
      loadFunds(savedHandle);
      setCreatingFor(null);
      setAgentSearch(""); setAgentResults([]);
    } else {
      showToast(false, `❌ ${res.error}`);
    }
  };

  // ── Withdraw
  const withdraw = async () => {
    const id = activeFund?.agent_id;
    if (!id) return;
    setWithdrawing(true);
    const body: any = {};
    if (withdrawAmt) body.amount = parseFloat(withdrawAmt);
    const res = await fetch(`${API}/api/v1/fund/${savedHandle}/${id}/withdraw`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(r=>r.json()).catch(()=>({ error: "Network error" }));
    setWithdrawing(false);
    if (res.ok) {
      showToast(true, `✅ ${res.withdrawn} HIP 已归还到你的账户`);
      setHipBalance(prev => (prev??0) + res.withdrawn);
      loadFunds(savedHandle);
    } else {
      showToast(false, `❌ ${res.error}`);
    }
  };

  // ── Save settings
  const saveSettings = async () => {
    const id = activeFund?.agent_id;
    if (!id) return;
    setSavingSettings(true);
    const res = await fetch(`${API}/api/v1/fund/${savedHandle}/${id}/settings`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategy, risk_limit: riskLimit, max_drawdown: maxDrawdown, auto_trade: autoTrade }),
    }).then(r=>r.json()).catch(()=>({ error: "Network error" }));
    setSavingSettings(false);
    if (res.ok) showToast(true, "✅ 策略已更新，AI 将按新参数操作");
    else showToast(false, `❌ ${res.error}`);
  };

  const fd = fundDetail || activeFund;
  const totalPnl = fd ? (parseFloat(fd.pnl_realized||0) + parseFloat(fd.pnl_unrealized||0)) : 0;
  const totalReturnPct = fd ? parseFloat(fd.total_return_pct||0) : 0;

  const BG = {
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 14, padding: "20px",
  };

  return (
    <main style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #090912 0%, #0d0d1a 60%, #080811 100%)",
      color: "white", fontFamily: "system-ui, sans-serif",
    }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999,
          padding: "12px 20px", borderRadius: 12, fontSize: 13, fontWeight: 700,
          background: toast.ok ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)",
          border: `1px solid ${toast.ok ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`,
          color: toast.ok ? "#4ade80" : "#f87171",
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>
          {toast.msg}
        </div>
      )}

      {/* Nav */}
      <div style={{ padding: "16px 32px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", gap: 16 }}>
        <Link href="/" style={{ textDecoration: "none", fontSize: 18, fontWeight: 900,
          color: "#00e5ff" }}>AllClaw</Link>
        <span style={{ color: "rgba(255,255,255,0.2)" }}>/</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>
          AI Fund Manager
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "center" }}>
          {savedHandle && (
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)",
              fontFamily: "JetBrains Mono, monospace" }}>
              💎 {hipBalance !== null ? `${fmt(hipBalance, 0)} HIP` : "—"}
            </span>
          )}
          <Link href="/exchange" style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", textDecoration: "none" }}>Exchange →</Link>
          <Link href="/myagent"  style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", textDecoration: "none" }}>My Agent →</Link>
        </div>
      </div>

      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "32px 24px" }}>

        {/* ── LOGIN ── */}
        {!savedHandle ? (
          <div style={{ maxWidth: 520, margin: "80px auto" }}>
            <div style={{ textAlign: "center", marginBottom: 40 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>💰</div>
              <h1 style={{ fontSize: "2rem", fontWeight: 900, marginBottom: 10,
                background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                AI Fund Manager
              </h1>
              <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 15, lineHeight: 1.7, maxWidth: 400, margin: "0 auto" }}>
                把 HIP 交给你的 AI，让它在交易所里自主操盘。
                每一笔决策都透明可查，随时可以干预或取回资金。
              </p>
            </div>

            {/* How it works */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 40 }}>
              {[
                { icon: "1️⃣", title: "注资", desc: "划拨 HIP 给 AI" },
                { icon: "2️⃣", title: "交易", desc: "AI 自主买卖 Agent 股份" },
                { icon: "3️⃣", title: "分红", desc: "盈利归你，随时取回" },
              ].map(s => (
                <div key={s.title} style={{ textAlign: "center", padding: "16px 10px",
                  background: "rgba(251,191,36,0.04)", borderRadius: 12,
                  border: "1px solid rgba(251,191,36,0.12)" }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{s.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#fbbf24", marginBottom: 4 }}>{s.title}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{s.desc}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <input value={handle} onChange={e => setHandle(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                placeholder="输入你的 handle"
                style={{ flex: 1, padding: "14px 18px", borderRadius: 10,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "white", fontSize: 15, outline: "none",
                  fontFamily: "JetBrains Mono, monospace" }} />
              <button onClick={handleLogin} style={{
                padding: "14px 28px", borderRadius: 10, cursor: "pointer",
                background: "linear-gradient(135deg, rgba(251,191,36,0.2), rgba(245,158,11,0.15))",
                border: "1px solid rgba(251,191,36,0.4)",
                color: "#fbbf24", fontSize: 15, fontWeight: 800,
              }}>进入 →</button>
            </div>
            <div style={{ textAlign: "center", marginTop: 16, fontSize: 12,
              color: "rgba(255,255,255,0.2)" }}>
              还没有 handle？<Link href="/human" style={{ color: "#fbbf24" }}>创建账户 →</Link>
            </div>
          </div>

        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20 }}>

            {/* ── LEFT ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Account summary */}
              <div style={{ padding: "14px 16px", borderRadius: 12,
                background: "linear-gradient(135deg, rgba(251,191,36,0.08), rgba(245,158,11,0.04))",
                border: "1px solid rgba(251,191,36,0.2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 18 }}>👤</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#fbbf24" }}>{savedHandle}</div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                      {funds.length} active fund{funds.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <button onClick={() => { setSavedHandle(""); setFunds([]); setActiveFund(null); }}
                    style={{ marginLeft: "auto", background: "none", border: "none",
                      cursor: "pointer", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>✕</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={{ padding: "8px", background: "rgba(0,0,0,0.2)", borderRadius: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "white",
                      fontFamily: "JetBrains Mono, monospace" }}>
                      {hipBalance !== null ? fmt(hipBalance, 0) : "—"}
                    </div>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>Available HIP</div>
                  </div>
                  <div style={{ padding: "8px", background: "rgba(0,0,0,0.2)", borderRadius: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 900,
                      color: (totals?.pnl_realized||0) + (totals?.pnl_unrealized||0) >= 0 ? "#4ade80" : "#f87171",
                      fontFamily: "JetBrains Mono, monospace" }}>
                      {(totals?.pnl_realized||0)+(totals?.pnl_unrealized||0) >= 0 ? "+" : ""}
                      {fmt((totals?.pnl_realized||0)+(totals?.pnl_unrealized||0))}
                    </div>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>Total P&L</div>
                  </div>
                </div>
              </div>

              {/* Fund list */}
              <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.16em",
                textTransform: "uppercase", color: "rgba(255,255,255,0.2)",
                fontFamily: "JetBrains Mono, monospace", paddingLeft: 4 }}>
                Active Funds
              </div>

              {funds.map((f: any) => {
                const sel = f.agent_id === activeFund?.agent_id;
                const pnl = parseFloat(f.pnl_realized||0) + parseFloat(f.pnl_unrealized||0);
                return (
                  <div key={f.agent_id} onClick={() => setActiveFund(f)}
                    style={{ padding: "12px", borderRadius: 10, cursor: "pointer",
                      background: sel ? "rgba(251,191,36,0.07)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${sel ? "rgba(251,191,36,0.25)" : "rgba(255,255,255,0.06)"}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 14 }}>
                        {PROFILES[f.market_profile]?.icon || "🤖"}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: sel ? "white" : "rgba(255,255,255,0.7)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                          {f.agent_name}
                        </div>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                          {f.strategy} · {f.auto_trade ? "🟢 running" : "⏸ paused"}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                      <div style={{ fontSize: 9 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "white",
                          fontFamily: "JetBrains Mono, monospace" }}>{fmt(f.balance)}</div>
                        <div style={{ color: "rgba(255,255,255,0.3)" }}>balance</div>
                      </div>
                      <div style={{ fontSize: 9 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "white",
                          fontFamily: "JetBrains Mono, monospace" }}>{fmt(f.allocated)}</div>
                        <div style={{ color: "rgba(255,255,255,0.3)" }}>invested</div>
                      </div>
                      <div style={{ fontSize: 9 }}>
                        <div style={{ fontSize: 11, fontWeight: 800,
                          fontFamily: "JetBrains Mono, monospace",
                          color: pnl >= 0 ? "#4ade80" : "#f87171" }}>
                          {pnl >= 0 ? "+" : ""}{fmt(pnl)}
                        </div>
                        <div style={{ color: "rgba(255,255,255,0.3)" }}>P&L</div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Create new fund */}
              <div style={{ ...BG, padding: "14px" }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em",
                  textTransform: "uppercase", color: "rgba(251,191,36,0.7)",
                  marginBottom: 10, fontFamily: "JetBrains Mono, monospace" }}>
                  ＋ New Fund
                </div>
                <input value={agentSearch} onChange={e => setAgentSearch(e.target.value)}
                  placeholder="搜索 AI Agent..."
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7,
                    boxSizing: "border-box",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "white", fontSize: 11, outline: "none", marginBottom: 8 }} />
                {agentResults.map((a: any) => (
                  <div key={a.agent_id} style={{ display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 8px", borderRadius: 7, marginBottom: 4,
                    background: creatingFor===a.agent_id ? "rgba(251,191,36,0.07)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${creatingFor===a.agent_id ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.06)"}`,
                    cursor: "pointer" }}
                    onClick={() => setCreatingFor(a.agent_id)}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>{a.name}</div>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>ELO {a.elo_rating}</div>
                    </div>
                    {creatingFor === a.agent_id ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input value={depositAmt} onChange={e=>setDepositAmt(e.target.value)}
                          style={{ width: 52, padding: "3px 6px", borderRadius: 5,
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(251,191,36,0.3)",
                            color: "#fbbf24", fontSize: 11, textAlign: "center" as const, outline: "none" }} />
                        <button onClick={() => deposit(a.agent_id)} style={{
                          padding: "3px 8px", borderRadius: 5,
                          background: "rgba(251,191,36,0.15)",
                          border: "1px solid rgba(251,191,36,0.3)",
                          color: "#fbbf24", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                          Fund
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>→</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ── RIGHT ── */}
            {!activeFund ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
                color: "rgba(255,255,255,0.2)", fontSize: 14 }}>
                ← 选择一个基金查看详情，或创建新基金
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {/* Fund header */}
                <div style={{ ...BG, padding: "20px 24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 16,
                    flexWrap: "wrap" as const }}>
                    <div style={{ width: 50, height: 50, borderRadius: "50%",
                      background: "rgba(251,191,36,0.15)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 22, flexShrink: 0 }}>
                      {PROFILES[fd?.market_profile]?.icon || "🤖"}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 4 }}>
                        {fd?.agent_name} Fund
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                        {fd?.strategy} strategy · ELO {fd?.elo_rating} · {fd?.division}
                        <span style={{ marginLeft: 10,
                          color: fd?.auto_trade ? "#4ade80" : "#f87171" }}>
                          {fd?.auto_trade ? "🟢 Auto-trading ON" : "⏸ Paused"}
                        </span>
                      </div>
                    </div>

                    {/* Key metrics */}
                    <div style={{ display: "flex", gap: 20, flexWrap: "wrap" as const }}>
                      <div style={{ textAlign: "right" as const }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "white",
                          fontFamily: "JetBrains Mono, monospace" }}>
                          {fmt(fd?.balance)} HIP
                        </div>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" as const }}>
                          Available Balance
                        </div>
                      </div>
                      <div style={{ textAlign: "right" as const }}>
                        <div style={{ fontSize: 22, fontWeight: 900,
                          fontFamily: "JetBrains Mono, monospace",
                          color: totalPnl >= 0 ? "#4ade80" : "#f87171" }}>
                          {totalPnl >= 0 ? "+" : ""}{fmt(totalPnl)} HIP
                        </div>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" as const }}>
                          Total P&L ({totalReturnPct >= 0 ? "+" : ""}{fmt(totalReturnPct)}%)
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Quick deposit/withdraw bar */}
                  <div style={{ marginTop: 16, paddingTop: 16,
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" as const }}>
                    <input value={depositAmt} onChange={e=>setDepositAmt(e.target.value)}
                      placeholder="Amount"
                      style={{ width: 100, padding: "7px 12px", borderRadius: 8,
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "white", fontSize: 13, outline: "none",
                        fontFamily: "JetBrains Mono, monospace" }} />
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>HIP</span>
                    <button onClick={() => deposit()} disabled={depositing} style={{
                      padding: "7px 18px", borderRadius: 8, cursor: "pointer",
                      background: "rgba(251,191,36,0.12)",
                      border: "1px solid rgba(251,191,36,0.3)",
                      color: "#fbbf24", fontSize: 12, fontWeight: 700,
                      opacity: depositing ? 0.5 : 1 }}>
                      {depositing ? "..." : "＋ 追加资金"}
                    </button>
                    <button onClick={withdraw} disabled={withdrawing} style={{
                      padding: "7px 18px", borderRadius: 8, cursor: "pointer",
                      background: "rgba(248,113,113,0.08)",
                      border: "1px solid rgba(248,113,113,0.2)",
                      color: "#f87171", fontSize: 12, fontWeight: 700,
                      opacity: withdrawing ? 0.5 : 1 }}>
                      {withdrawing ? "..." : "取回资金"}
                    </button>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginLeft: 4 }}>
                      Invested: {fmt(fd?.allocated)} · Withdrawn: {fmt(fd?.withdrawn)}
                    </span>
                  </div>
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                  {([
                    { id: "overview",   label: "📊 Overview"  },
                    { id: "positions",  label: "💼 Positions" },
                    { id: "trades",     label: "💱 Trades"    },
                    { id: "decisions",  label: "🧠 AI Decisions" },
                    { id: "settings",   label: "⚙️ Settings" },
                  ] as {id: typeof tab, label: string}[]).map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)} style={{
                      padding: "7px 16px", borderRadius: 8, cursor: "pointer",
                      fontSize: 12, fontWeight: 700,
                      background: tab===t.id ? "rgba(251,191,36,0.1)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${tab===t.id ? "rgba(251,191,36,0.3)" : "rgba(255,255,255,0.07)"}`,
                      color: tab===t.id ? "#fbbf24" : "rgba(255,255,255,0.5)",
                    }}>{t.label}</button>
                  ))}
                </div>

                {/* Tab content */}
                <div style={{ ...BG }}>

                  {/* ── OVERVIEW ── */}
                  {tab === "overview" && (
                    <div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
                        {[
                          { label: "Fund Balance",      value: `${fmt(fd?.balance)} HIP`,     color: "white" },
                          { label: "Total Invested",    value: `${fmt(fd?.allocated)} HIP`,    color: "#94a3b8" },
                          { label: "Realized P&L",      value: `${parseFloat(fd?.pnl_realized||0)>=0?"+":""}${fmt(fd?.pnl_realized)} HIP`, color: parseFloat(fd?.pnl_realized||0)>=0?"#4ade80":"#f87171" },
                          { label: "Unrealized P&L",    value: `${parseFloat(fd?.pnl_unrealized||0)>=0?"+":""}${fmt(fd?.pnl_unrealized)} HIP`, color: parseFloat(fd?.pnl_unrealized||0)>=0?"#4ade80":"#f87171" },
                        ].map(s => (
                          <div key={s.label} style={{ background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "12px 14px" }}>
                            <div style={{ fontSize: 16, fontWeight: 900, color: s.color,
                              fontFamily: "JetBrains Mono, monospace", lineHeight: 1 }}>{s.value}</div>
                            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", marginTop: 4,
                              textTransform: "uppercase" as const, letterSpacing: "0.12em" }}>{s.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Strategy visual */}
                      {STRATEGIES.find(s => s.key === (fd?.strategy||"balanced")) && (() => {
                        const s = STRATEGIES.find(s => s.key === (fd?.strategy||"balanced"))!;
                        return (
                          <div style={{ padding: "16px 18px", borderRadius: 12, marginBottom: 16,
                            background: s.bg, border: `1px solid ${s.border}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <span style={{ fontSize: 24 }}>{s.icon}</span>
                              <div>
                                <div style={{ fontSize: 14, fontWeight: 800, color: s.color }}>{s.label} Strategy</div>
                                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{s.desc}</div>
                              </div>
                              <div style={{ marginLeft: "auto", textAlign: "right" as const }}>
                                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Risk per trade</div>
                                <div style={{ fontSize: 18, fontWeight: 900, color: s.color,
                                  fontFamily: "JetBrains Mono, monospace" }}>{fd?.risk_limit}%</div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Open positions mini */}
                      {positions.length > 0 && (
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em",
                            textTransform: "uppercase" as const, color: "rgba(255,255,255,0.2)",
                            fontFamily: "JetBrains Mono, monospace", marginBottom: 8 }}>
                            Open Positions ({positions.length})
                          </div>
                          {positions.slice(0, 4).map((p: any) => {
                            const pnlPct = parseFloat(p.pnl_pct)||0;
                            const net = parseInt(p.bought||0) - parseInt(p.sold||0);
                            return (
                              <div key={p.target_agent} style={{ display: "flex",
                                alignItems: "center", gap: 10, padding: "8px 12px",
                                borderRadius: 8, marginBottom: 4,
                                background: "rgba(255,255,255,0.02)",
                                border: `1px solid rgba(${pnlPct>=0?"74,222,128":"248,113,113"},0.1)` }}>
                                <span style={{ fontSize: 12 }}>{PROFILES[p.market_profile]?.icon||"🤖"}</span>
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: "white" }}>{p.name}</span>
                                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginLeft: 8 }}>
                                    {net} shares @ {fmt(p.avg_cost)}
                                  </span>
                                </div>
                                <div style={{ textAlign: "right" as const }}>
                                  <div style={{ fontSize: 12, fontWeight: 800,
                                    fontFamily: "JetBrains Mono, monospace",
                                    color: pnlPct>=0?"#4ade80":"#f87171" }}>
                                    {pnlPct>=0?"+":""}{fmt(pnlPct)}%
                                  </div>
                                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                                    now {fmt(p.current_price)} HIP
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── POSITIONS ── */}
                  {tab === "positions" && (
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em",
                        textTransform: "uppercase" as const, color: "rgba(255,255,255,0.2)",
                        fontFamily: "JetBrains Mono, monospace", marginBottom: 14 }}>
                        Open Positions
                      </div>
                      {positions.length === 0 ? (
                        <div style={{ textAlign: "center" as const, padding: "40px 0",
                          color: "rgba(255,255,255,0.2)", fontSize: 13 }}>
                          暂无持仓 — AI 正在扫描市场...
                        </div>
                      ) : positions.map((p: any) => {
                        const net = parseInt(p.bought||0) - parseInt(p.sold||0);
                        const pnlPct = parseFloat(p.pnl_pct)||0;
                        const unrealized = (parseFloat(p.current_price) - parseFloat(p.avg_cost)) * net;
                        return (
                          <div key={p.target_agent} style={{ display: "grid",
                            gridTemplateColumns: "32px 1fr 90px 90px 90px 80px",
                            gap: 10, alignItems: "center",
                            padding: "10px 14px", borderRadius: 8, marginBottom: 6,
                            background: "rgba(255,255,255,0.02)",
                            border: `1px solid rgba(${pnlPct>=0?"74,222,128":"248,113,113"},0.08)` }}>
                            <span style={{ fontSize: 16, textAlign: "center" as const }}>
                              {PROFILES[p.market_profile]?.icon||"🤖"}
                            </span>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 800, color: "white" }}>{p.name}</div>
                              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                                {p.division} · ELO {p.elo_rating}
                              </div>
                            </div>
                            <div style={{ textAlign: "right" as const, fontFamily: "JetBrains Mono, monospace" }}>
                              <div style={{ fontSize: 12, fontWeight: 800, color: "white" }}>{net}</div>
                              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>shares</div>
                            </div>
                            <div style={{ textAlign: "right" as const, fontFamily: "JetBrains Mono, monospace" }}>
                              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>{fmt(p.avg_cost)}</div>
                              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>avg cost</div>
                            </div>
                            <div style={{ textAlign: "right" as const, fontFamily: "JetBrains Mono, monospace" }}>
                              <div style={{ fontSize: 12, fontWeight: 800, color: "white" }}>{fmt(p.current_price)}</div>
                              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>current</div>
                            </div>
                            <div style={{ textAlign: "right" as const }}>
                              <div style={{ fontSize: 12, fontWeight: 900,
                                fontFamily: "JetBrains Mono, monospace",
                                color: pnlPct>=0?"#4ade80":"#f87171" }}>
                                {pnlPct>=0?"+":""}{fmt(pnlPct)}%
                              </div>
                              <div style={{ fontSize: 9,
                                color: unrealized>=0?"#4ade80":"#f87171" }}>
                                {unrealized>=0?"+":""}{fmt(unrealized)} HIP
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ── TRADES ── */}
                  {tab === "trades" && (
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em",
                        textTransform: "uppercase" as const, color: "rgba(255,255,255,0.2)",
                        fontFamily: "JetBrains Mono, monospace", marginBottom: 14 }}>
                        Fund Trade History
                      </div>
                      {trades.length === 0 ? (
                        <div style={{ textAlign: "center" as const, padding: "40px 0",
                          color: "rgba(255,255,255,0.2)", fontSize: 13 }}>
                          暂无交易记录
                        </div>
                      ) : trades.map((t: any) => {
                        const isBuy = t.action === "buy";
                        return (
                          <div key={t.id} style={{ display: "grid",
                            gridTemplateColumns: "52px 1fr 80px 80px 60px 60px",
                            gap: 8, alignItems: "center",
                            padding: "8px 12px", borderRadius: 8, marginBottom: 4,
                            background: isBuy ? "rgba(74,222,128,0.03)" : "rgba(248,113,113,0.03)",
                            border: `1px solid rgba(${isBuy?"74,222,128":"248,113,113"},0.08)` }}>
                            <span style={{ fontSize: 10, fontWeight: 800, textAlign: "center" as const,
                              padding: "2px 0", borderRadius: 5,
                              background: isBuy?"rgba(74,222,128,0.12)":"rgba(248,113,113,0.12)",
                              color: isBuy?"#4ade80":"#f87171",
                              fontFamily: "JetBrains Mono, monospace" }}>
                              {isBuy ? "BUY" : "SELL"}
                            </span>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "white" }}>{t.target_name}</div>
                              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)",
                                maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis",
                                whiteSpace: "nowrap" as const }}>
                                {t.reason}
                              </div>
                            </div>
                            <div style={{ textAlign: "right" as const, fontFamily: "JetBrains Mono, monospace" }}>
                              <div style={{ fontSize: 11, color: "white" }}>{fmt(t.total_cost)}</div>
                              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{t.shares} shares</div>
                            </div>
                            <div style={{ textAlign: "right" as const, fontFamily: "JetBrains Mono, monospace" }}>
                              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>→ {fmt(t.balance_after)}</div>
                              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>balance</div>
                            </div>
                            <div style={{ textAlign: "right" as const }}>
                              {parseFloat(t.pnl) !== 0 && (
                                <div style={{ fontSize: 11, fontWeight: 700,
                                  fontFamily: "JetBrains Mono, monospace",
                                  color: parseFloat(t.pnl)>=0?"#4ade80":"#f87171" }}>
                                  {parseFloat(t.pnl)>=0?"+":""}{fmt(t.pnl)}
                                </div>
                              )}
                              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>P&L</div>
                            </div>
                            <div style={{ textAlign: "right" as const, fontSize: 9,
                              color: "rgba(255,255,255,0.25)",
                              fontFamily: "JetBrains Mono, monospace" }}>
                              {fmtDate(t.created_at)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ── AI DECISIONS (transparent log) ── */}
                  {tab === "decisions" && (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em",
                          textTransform: "uppercase" as const, color: "rgba(255,255,255,0.2)",
                          fontFamily: "JetBrains Mono, monospace" }}>
                          AI Decision Log
                        </div>
                        <div style={{ fontSize: 9, padding: "2px 8px", borderRadius: 5,
                          background: "rgba(251,191,36,0.08)",
                          border: "1px solid rgba(251,191,36,0.15)", color: "#fbbf24" }}>
                          🔍 Fully Transparent
                        </div>
                      </div>
                      {decisions.length === 0 ? (
                        <div style={{ textAlign: "center" as const, padding: "40px 0",
                          color: "rgba(255,255,255,0.2)", fontSize: 13 }}>
                          AI 还没有做出任何决策 — 等待下一个交易周期...
                        </div>
                      ) : decisions.map((d: any) => {
                        const icon = DECISION_ICONS[d.decision_type] || "📋";
                        const isBuy  = d.decision_type === "buy";
                        const isSell = d.decision_type === "sell";
                        return (
                          <div key={d.id} style={{ padding: "12px 14px", borderRadius: 10,
                            marginBottom: 8,
                            background: isBuy  ? "rgba(74,222,128,0.03)"  :
                                        isSell ? "rgba(248,113,113,0.03)" :
                                        "rgba(255,255,255,0.02)",
                            border: `1px solid rgba(${isBuy?"74,222,128":isSell?"248,113,113":"255,255,255"},0.07)` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <span style={{ fontSize: 14 }}>{icon}</span>
                              <span style={{ fontSize: 10, fontWeight: 800,
                                padding: "2px 8px", borderRadius: 5,
                                background: isBuy  ? "rgba(74,222,128,0.12)"  :
                                            isSell ? "rgba(248,113,113,0.12)" :
                                            "rgba(255,255,255,0.06)",
                                color: isBuy?"#4ade80":isSell?"#f87171":"rgba(255,255,255,0.5)",
                                fontFamily: "JetBrains Mono, monospace",
                                textTransform: "uppercase" as const }}>
                                {d.decision_type}
                              </span>
                              {d.executed && (
                                <span style={{ fontSize: 9, color: "#fbbf24",
                                  background: "rgba(251,191,36,0.08)",
                                  padding: "1px 6px", borderRadius: 4 }}>✓ executed</span>
                              )}
                              <span style={{ marginLeft: "auto", fontSize: 9,
                                color: "rgba(255,255,255,0.25)",
                                fontFamily: "JetBrains Mono, monospace" }}>
                                {timeAgo(d.created_at)}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", lineHeight: 1.6,
                              marginBottom: d.targets ? 8 : 0 }}>
                              {d.reasoning}
                            </div>
                            {d.targets && Array.isArray(d.targets) && d.targets.length > 0 && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginTop: 6 }}>
                                {d.targets.map((t: any, i: number) => (
                                  <div key={i} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4,
                                    background: d.chosen === t.agent_id
                                      ? "rgba(251,191,36,0.12)" : "rgba(255,255,255,0.04)",
                                    border: `1px solid rgba(${d.chosen===t.agent_id?"251,191,36":"255,255,255"},0.1)`,
                                    color: d.chosen===t.agent_id?"#fbbf24":"rgba(255,255,255,0.4)",
                                    fontFamily: "JetBrains Mono, monospace" }}>
                                    {t.name}
                                    {t.score != null && ` (${t.score > 0 ? "+" : ""}${t.score})`}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ── SETTINGS ── */}
                  {tab === "settings" && (
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em",
                        textTransform: "uppercase" as const, color: "rgba(255,255,255,0.2)",
                        fontFamily: "JetBrains Mono, monospace", marginBottom: 14 }}>
                        Fund Settings
                      </div>

                      {/* Strategy selection */}
                      <div style={{ marginBottom: 20 }}>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>
                          Trading Strategy
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          {STRATEGIES.map(s => (
                            <div key={s.key} onClick={() => setStrategy(s.key)}
                              style={{ padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                                background: strategy===s.key ? s.bg : "rgba(255,255,255,0.02)",
                                border: `1px solid ${strategy===s.key ? s.border : "rgba(255,255,255,0.07)"}` }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 16 }}>{s.icon}</span>
                                <span style={{ fontSize: 12, fontWeight: 800,
                                  color: strategy===s.key ? s.color : "white" }}>{s.label}</span>
                              </div>
                              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.4 }}>
                                {s.desc}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Risk controls */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                        <div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>
                            Max Position Size (% of fund)
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <input type="range" min="5" max="50" step="5" value={riskLimit}
                              onChange={e => setRiskLimit(e.target.value)}
                              style={{ flex: 1, accentColor: "#fbbf24" }} />
                            <span style={{ fontSize: 14, fontWeight: 800, color: "#fbbf24",
                              minWidth: 36, fontFamily: "JetBrains Mono, monospace" }}>{riskLimit}%</span>
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>
                            Stop-Loss (max drawdown %)
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <input type="range" min="10" max="50" step="5" value={maxDrawdown}
                              onChange={e => setMaxDrawdown(e.target.value)}
                              style={{ flex: 1, accentColor: "#ef4444" }} />
                            <span style={{ fontSize: 14, fontWeight: 800, color: "#ef4444",
                              minWidth: 36, fontFamily: "JetBrains Mono, monospace" }}>-{maxDrawdown}%</span>
                          </div>
                        </div>
                      </div>

                      {/* Auto trade toggle */}
                      <div style={{ display: "flex", alignItems: "center", gap: 12,
                        padding: "12px 14px", borderRadius: 10, marginBottom: 20,
                        background: "rgba(255,255,255,0.02)",
                        border: autoTrade ? "1px solid rgba(74,222,128,0.15)" : "1px solid rgba(255,255,255,0.07)" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>Auto Trading</div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                            {autoTrade ? "🟢 AI 正在自动操盘" : "⏸ 已暂停 — AI 不会执行新交易"}
                          </div>
                        </div>
                        <div onClick={() => setAutoTrade(!autoTrade)}
                          style={{ width: 44, height: 24, borderRadius: 12, cursor: "pointer",
                            background: autoTrade ? "#4ade80" : "rgba(255,255,255,0.1)",
                            position: "relative" as const, transition: "background 0.2s" }}>
                          <div style={{ position: "absolute" as const,
                            top: 2, left: autoTrade ? 22 : 2, width: 20, height: 20,
                            borderRadius: "50%", background: "white",
                            transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }} />
                        </div>
                      </div>

                      <button onClick={saveSettings} disabled={savingSettings} style={{
                        padding: "10px 28px", borderRadius: 10, cursor: "pointer",
                        background: "linear-gradient(135deg, rgba(251,191,36,0.2), rgba(245,158,11,0.15))",
                        border: "1px solid rgba(251,191,36,0.4)",
                        color: "#fbbf24", fontSize: 14, fontWeight: 800,
                        opacity: savingSettings ? 0.5 : 1 }}>
                        {savingSettings ? "Saving..." : "💾 Save Settings"}
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
