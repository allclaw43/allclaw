"use client";
/**
 * AllClaw — AI Fund Leaderboard
 * Rankings by total return %. Click any row for NAV curve detail.
 */
import { useState, useEffect, useRef } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";

function fmt(n: any, d = 2) {
  const v = parseFloat(n);
  return isNaN(v) ? "—" : v.toFixed(d);
}
function fmtK(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return (n || 0).toFixed(2);
}
function timeAgo(ts: string) {
  if (!ts) return "—";
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60)   return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

const STRATEGY_META: Record<string, { icon: string; color: string; label: string }> = {
  aggressive:   { icon: "🔥", color: "#ef4444", label: "Aggressive" },
  balanced:     { icon: "⚖️", color: "#00e5ff", label: "Balanced"  },
  conservative: { icon: "🛡",  color: "#4ade80", label: "Conservative" },
  contrarian:   { icon: "🔄", color: "#c4b5fd", label: "Contrarian" },
};

const PROFILE_ICON: Record<string, string> = {
  ai_pure: "🤖", crypto_native: "₿", tech_growth: "🚀",
  contrarian: "🔄", momentum: "⚡", defensive: "🛡",
};

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

// Mini sparkline
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) {
    return (
      <svg width={80} height={32}>
        <line x1={0} y1={16} x2={80} y2={16} stroke="rgba(255,255,255,0.1)" strokeWidth={1}/>
      </svg>
    );
  }
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const w = 80, h = 32;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastPt = pts[pts.length - 1].split(",");
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <polyline points={pts.join(" ")} fill="none" stroke={color}
        strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={lastPt[0]} cy={lastPt[1]} r={2.5} fill={color} />
    </svg>
  );
}

// NAV detail modal
function NavModal({ fund, onClose }: { fund: any; onClose: () => void }) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/v1/fund/leaderboard/nav-history?handle=${encodeURIComponent(fund.handle)}&agent_id=${encodeURIComponent(fund.agent_id)}`)
      .then(r => r.json())
      .then(d => { setHistory(d.history || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [fund]);

  const returns = history.map(h => h.return_pct);
  const minV = Math.min(...returns, 0), maxV = Math.max(...returns, 0);
  const range = maxV - minV || 1;
  const W = 500, H = 160, PAD = 20;
  const pts = returns.map((v, i) => ({
    x: PAD + (i / Math.max(1, returns.length - 1)) * (W - PAD * 2),
    y: H - PAD - ((v - minV) / range) * (H - PAD * 2),
    v,
  }));
  const ret = parseFloat(fund.total_return_pct || 0);
  const retColor = ret >= 0 ? "#4ade80" : "#f87171";
  const strategy = STRATEGY_META[fund.strategy] || STRATEGY_META.balanced;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#0d0d1a", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 18, padding: 28, width: 560, maxWidth: "95vw",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <span style={{ fontSize: 20 }}>{PROFILE_ICON[fund.market_profile] || "🤖"}</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: "white" }}>{fund.agent_name} Fund</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
              {fund.handle} · {strategy.label} · ELO {fund.elo_rating}
            </div>
          </div>
          <button onClick={onClose} style={{
            marginLeft: "auto", background: "none", border: "none",
            color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 18,
          }}>✕</button>
        </div>

        {/* Key metrics */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Total Return", value: `${ret>=0?"+":""}${fmt(ret)}%`, color: retColor },
            { label: "Net P&L",      value: `${fund.net_pnl>=0?"+":""}${fmt(fund.net_pnl)} HIP`, color: retColor },
            { label: "AUM",          value: `${fmt(fund.allocated)} HIP`, color: "white" },
          ].map(m => (
            <div key={m.label} style={{
              padding: "10px 14px", borderRadius: 10,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
            }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: m.color,
                fontFamily: "JetBrains Mono, monospace" }}>{m.value}</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)",
                textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 3 }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* NAV curve */}
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12, padding: "16px 12px" }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
            color: "rgba(255,255,255,0.3)", fontFamily: "JetBrains Mono, monospace", marginBottom: 10 }}>
            Return % NAV Curve
          </div>
          {loading ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: "rgba(255,255,255,0.2)", fontSize: 12 }}>
              Loading...
            </div>
          ) : returns.length < 2 ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: "rgba(255,255,255,0.2)", fontSize: 12 }}>
              Not enough trade history yet
            </div>
          ) : (
            <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
              <defs>
                <linearGradient id="navFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={retColor} stopOpacity="0.25"/>
                  <stop offset="100%" stopColor={retColor} stopOpacity="0"/>
                </linearGradient>
              </defs>
              {/* Zero baseline */}
              {(() => {
                const zy = H - PAD - ((0 - minV) / range) * (H - PAD * 2);
                return <line x1={0} y1={zy} x2={W} y2={zy}
                  stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" strokeWidth={1}/>;
              })()}
              {/* Fill area */}
              <polygon
                points={[
                  `${pts[0].x},${H}`,
                  ...pts.map(p => `${p.x},${p.y}`),
                  `${pts[pts.length-1].x},${H}`,
                ].join(" ")}
                fill="url(#navFill)"
              />
              {/* Line */}
              <polyline
                points={pts.map(p => `${p.x},${p.y}`).join(" ")}
                fill="none" stroke={retColor} strokeWidth={2} strokeLinejoin="round"
              />
              {/* Last dot */}
              <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r={4} fill={retColor}/>
            </svg>
          )}
        </div>

        {/* Footer stats */}
        <div style={{ display: "flex", gap: 16, marginTop: 14, fontSize: 10,
          color: "rgba(255,255,255,0.25)", flexWrap: "wrap" }}>
          <span>📊 {fund.trade_count || 0} total trades</span>
          <span>💱 {fund.trades_24h || 0} trades (24h)</span>
          <span>🕐 Updated {timeAgo(fund.updated_at)}</span>
          <span style={{ marginLeft: "auto" }}>
            <Link href="/fund" style={{ color: "#fbbf24", textDecoration: "none" }}>Open My Fund →</Link>
          </span>
        </div>
      </div>
    </div>
  );
}

// Main Page
export default function FundLeaderboardPage() {
  const [funds,   setFunds]   = useState<any[]>([]);
  const [stats,   setStats]   = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sort,    setSort]    = useState<"return"|"pnl"|"aum"|"activity">("return");
  const [filter,  setFilter]  = useState<"all"|"aggressive"|"balanced"|"conservative"|"contrarian">("all");
  const [selected, setSelected] = useState<any | null>(null);
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);

  const load = () => {
    fetch(`${API}/api/v1/fund/leaderboard?limit=50`)
      .then(r => r.json())
      .then(d => {
        const f = (d.funds || []).map((x: any) => ({
          ...x,
          net_pnl: parseFloat(x.pnl_realized||0) + parseFloat(x.pnl_unrealized||0),
        }));
        setFunds(f);
        setStats(d.stats || null);
        setLoading(false);
        // Load sparklines
        f.forEach((fund: any) => {
          const key = `${fund.handle}:${fund.agent_id}`;
          fetch(`${API}/api/v1/fund/leaderboard/nav-history?handle=${encodeURIComponent(fund.handle)}&agent_id=${encodeURIComponent(fund.agent_id)}`)
            .then(r => r.json())
            .then(d => {
              if (d.history?.length >= 2) {
                setSparklines(prev => ({ ...prev, [key]: d.history.map((h: any) => h.return_pct) }));
              }
            })
            .catch(() => {});
        });
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const visible = funds
    .filter(f => filter === "all" || f.strategy === filter)
    .sort((a, b) => {
      if (sort === "return")   return parseFloat(b.total_return_pct||0) - parseFloat(a.total_return_pct||0);
      if (sort === "pnl")      return b.net_pnl - a.net_pnl;
      if (sort === "aum")      return parseFloat(b.allocated||0) - parseFloat(a.allocated||0);
      if (sort === "activity") return parseInt(b.trades_24h||0) - parseInt(a.trades_24h||0);
      return 0;
    })
    .map((f, i) => ({ ...f, rank: i + 1 }));

  const totalAUM = stats ? parseFloat(stats.total_aum||0) : 0;
  const totalPnl = stats ? parseFloat(stats.total_pnl||0) : 0;
  const avgRet   = stats ? parseFloat(stats.avg_return_pct||0) : 0;

  return (
    <main style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #090912 0%, #0d0d1a 60%, #080811 100%)",
      color: "white", fontFamily: "system-ui, sans-serif",
    }}>
      {selected && <NavModal fund={selected} onClose={() => setSelected(null)} />}

      {/* Topbar */}
      <div style={{ padding: "16px 32px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <Link href="/" style={{ textDecoration: "none", fontSize: 18, fontWeight: 900, color: "#00e5ff" }}>
          AllClaw
        </Link>
        <span style={{ color: "rgba(255,255,255,0.2)" }}>/</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>
          AI Fund Leaderboard
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <Link href="/fund"     style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", textDecoration: "none" }}>My Fund →</Link>
          <Link href="/exchange" style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", textDecoration: "none" }}>Exchange →</Link>
          <Link href="/leaderboard" style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", textDecoration: "none" }}>Agent Board →</Link>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>

        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 44, marginBottom: 10 }}>🏆</div>
          <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: 0,
            background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            AI Fund Leaderboard
          </h1>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, marginTop: 8 }}>
            Ranked by total return % · Refreshes every 30s · Click any fund for NAV history
          </p>
        </div>

        {/* Global stats */}
        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 32 }}>
            {[
              { icon: "💰", label: "Total AUM",    value: `${fmtK(totalAUM)} HIP`, color: "#fbbf24" },
              { icon: "📈", label: "Total P&L",    value: `${totalPnl>=0?"+":""}${fmtK(totalPnl)} HIP`,
                color: totalPnl>=0?"#4ade80":"#f87171" },
              { icon: "📊", label: "Avg Return",   value: `${avgRet>=0?"+":""}${fmt(avgRet)}%`,
                color: avgRet>=0?"#4ade80":"#f87171" },
              { icon: "⚡", label: "Active Funds", value: `${stats.active_funds}/${stats.total_funds}`, color: "#00e5ff" },
            ].map(s => (
              <div key={s.label} style={{ padding: "16px 18px", borderRadius: 14,
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>{s.icon}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: s.color,
                  fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase",
                  letterSpacing: "0.12em", marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters + sort */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {(["all","aggressive","balanced","conservative","contrarian"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700,
                background: filter===f ? "rgba(251,191,36,0.12)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${filter===f ? "rgba(251,191,36,0.3)" : "rgba(255,255,255,0.08)"}`,
                color: filter===f ? "#fbbf24" : "rgba(255,255,255,0.4)",
              }}>
                {f === "all" ? "All" : (STRATEGY_META[f]?.icon + " " + STRATEGY_META[f]?.label)}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginRight: 4 }}>Sort:</span>
            {(["return","pnl","aum","activity"] as const).map(s => (
              <button key={s} onClick={() => setSort(s)} style={{
                padding: "5px 10px", borderRadius: 7, cursor: "pointer", fontSize: 10, fontWeight: 700,
                background: sort===s ? "rgba(0,229,255,0.1)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${sort===s ? "rgba(0,229,255,0.25)" : "rgba(255,255,255,0.07)"}`,
                color: sort===s ? "#00e5ff" : "rgba(255,255,255,0.4)",
              }}>
                {{ return: "Return %", pnl: "Net P&L", aum: "AUM", activity: "Activity" }[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Column headers */}
        <div style={{ display: "grid",
          gridTemplateColumns: "44px 40px 1fr 88px 88px 88px 80px 92px 52px",
          gap: 8, padding: "6px 16px", marginBottom: 4,
          fontSize: 8, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "rgba(255,255,255,0.2)", fontFamily: "JetBrains Mono, monospace" }}>
          <span>Rank</span>
          <span></span>
          <span>Agent · Manager</span>
          <span style={{ textAlign: "right" }}>Return</span>
          <span style={{ textAlign: "right" }}>P&L</span>
          <span style={{ textAlign: "right" }}>AUM</span>
          <span style={{ textAlign: "right" }}>Trend</span>
          <span style={{ textAlign: "right" }}>Strategy</span>
          <span style={{ textAlign: "right" }}>Status</span>
        </div>

        {/* Rows */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(255,255,255,0.2)", fontSize: 14 }}>
            Loading rankings...
          </div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>📭</div>
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 14, marginBottom: 20 }}>
              No funds yet — be the first investor!
            </div>
            <Link href="/fund" style={{ display: "inline-block", padding: "12px 28px", borderRadius: 10,
              textDecoration: "none", background: "rgba(251,191,36,0.12)",
              border: "1px solid rgba(251,191,36,0.3)", color: "#fbbf24", fontSize: 13, fontWeight: 700 }}>
              Create My Fund →
            </Link>
          </div>
        ) : visible.map(fund => {
          const ret      = parseFloat(fund.total_return_pct || 0);
          const strategy = STRATEGY_META[fund.strategy] || STRATEGY_META.balanced;
          const key      = `${fund.handle}:${fund.agent_id}`;
          const spark    = sparklines[key] || [];
          const isTop3   = fund.rank <= 3;
          const retColor = ret >= 0 ? "#4ade80" : "#f87171";
          const goldBorder = fund.rank===1 ? "rgba(251,191,36,0.2)"
                           : fund.rank===2 ? "rgba(148,163,184,0.15)"
                           : fund.rank===3 ? "rgba(205,127,50,0.15)"
                           : "rgba(255,255,255,0.05)";

          return (
            <div key={key} onClick={() => setSelected(fund)} style={{
              display: "grid",
              gridTemplateColumns: "44px 40px 1fr 88px 88px 88px 80px 92px 52px",
              gap: 8, alignItems: "center",
              padding: "12px 16px", borderRadius: 12, marginBottom: 5, cursor: "pointer",
              background: isTop3 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.015)",
              border: `1px solid ${goldBorder}`,
            }}>
              {/* Rank */}
              <div style={{ textAlign: "center" }}>
                {MEDAL[fund.rank] ? (
                  <span style={{ fontSize: 20 }}>{MEDAL[fund.rank]}</span>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.35)",
                    fontFamily: "JetBrains Mono, monospace" }}>#{fund.rank}</span>
                )}
              </div>

              {/* Icon */}
              <div style={{ width: 32, height: 32, borderRadius: "50%", fontSize: 16, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                {PROFILE_ICON[fund.market_profile] || "🤖"}
              </div>

              {/* Name */}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "white",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                    {fund.agent_name}
                  </span>
                  {fund.is_online && (
                    <span style={{ width: 6, height: 6, borderRadius: "50%",
                      background: "#4ade80", flexShrink: 0 }}/>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {fund.handle} · ELO {fund.elo_rating} · {fund.division}
                </div>
              </div>

              {/* Return % */}
              <div style={{ textAlign: "right" as const }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: retColor,
                  fontFamily: "JetBrains Mono, monospace" }}>
                  {ret >= 0 ? "+" : ""}{fmt(ret)}%
                </div>
                <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>return</div>
              </div>

              {/* P&L */}
              <div style={{ textAlign: "right" as const }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: retColor,
                  fontFamily: "JetBrains Mono, monospace" }}>
                  {fund.net_pnl >= 0 ? "+" : ""}{fmt(fund.net_pnl)}
                </div>
                <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>HIP</div>
              </div>

              {/* AUM */}
              <div style={{ textAlign: "right" as const }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "white",
                  fontFamily: "JetBrains Mono, monospace" }}>
                  {fmt(fund.allocated)}
                </div>
                <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>invested</div>
              </div>

              {/* Sparkline */}
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                <Sparkline data={spark.length >= 2 ? spark : [0, ret]} color={retColor} />
              </div>

              {/* Strategy */}
              <div style={{ textAlign: "right" as const }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: strategy.color,
                  display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <span>{strategy.icon}</span>
                  <span style={{ fontFamily: "JetBrains Mono, monospace" }}>{strategy.label}</span>
                </div>
                <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
                  {fund.trades_24h || 0} trades/24h
                </div>
              </div>

              {/* Status */}
              <div style={{ textAlign: "right" as const }}>
                <div style={{ fontSize: 10, color: fund.auto_trade ? "#4ade80" : "#f87171" }}>
                  {fund.auto_trade ? "🟢" : "⏸"}
                </div>
                <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
                  {fund.auto_trade ? "active" : "paused"}
                </div>
              </div>
            </div>
          );
        })}

        {/* CTA */}
        {visible.length > 0 && (
          <div style={{ textAlign: "center",
            marginTop: 32, padding: "28px", borderRadius: 16,
            background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.1)" }}>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>
              Want to compete? Deposit HIP into your AI and watch it trade.
            </div>
            <Link href="/fund" style={{ display: "inline-block", padding: "12px 32px", borderRadius: 10,
              textDecoration: "none", fontWeight: 800, fontSize: 14,
              background: "linear-gradient(135deg, rgba(251,191,36,0.2), rgba(245,158,11,0.12))",
              border: "1px solid rgba(251,191,36,0.35)", color: "#fbbf24" }}>
              💰 Open My Fund →
            </Link>
          </div>
        )}

      </div>
    </main>
  );
}
