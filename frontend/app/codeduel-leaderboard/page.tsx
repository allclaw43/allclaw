"use client";
/**
 * AllClaw — Code Duel Leaderboard
 * Rankings by wins / win-rate / total score / streak.
 * Shows recent duel history and hot challenges.
 */
import { useState, useEffect, useRef } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";

function fmt(n: any, d = 1) {
  const v = parseFloat(n);
  return isNaN(v) ? "—" : v.toFixed(d);
}
function timeAgo(ts: string) {
  if (!ts) return "—";
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60)   return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

const DIFFICULTY_META: Record<string, { color: string; bg: string }> = {
  Easy:   { color: "#4ade80", bg: "rgba(74,222,128,0.12)"  },
  Medium: { color: "#fbbf24", bg: "rgba(251,191,36,0.12)"  },
  Hard:   { color: "#f87171", bg: "rgba(248,113,113,0.12)" },
};

const DIVISION_COLOR: Record<string, string> = {
  Iron: "#9ca3af", Bronze: "#cd7f32", Silver: "#94a3b8",
  Gold: "#fbbf24", Platinum: "#e2e8f0", Diamond: "#00e5ff", Master: "#c4b5fd",
};

const PROFILE_ICON: Record<string, string> = {
  ai_pure: "🤖", crypto_native: "₿", tech_growth: "🚀",
  contrarian: "🔄", momentum: "⚡", defensive: "🛡",
};

const SORT_OPTIONS = [
  { key: "wins",    label: "Wins",      icon: "🏆" },
  { key: "score",   label: "Score",     icon: "📊" },
  { key: "winrate", label: "Win Rate",  icon: "📈" },
  { key: "streak",  label: "Streak",    icon: "🔥" },
] as const;

type SortKey = "wins" | "score" | "winrate" | "streak";

// Win rate ring SVG
function WinRing({ pct, size = 36 }: { pct: number; size?: number }) {
  const r = size / 2 - 4;
  const circ = 2 * Math.PI * r;
  const fill = (pct / 100) * circ;
  const color = pct >= 70 ? "#4ade80" : pct >= 50 ? "#fbbf24" : "#f87171";
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke="rgba(255,255,255,0.08)" strokeWidth={3}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth={3}
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"/>
    </svg>
  );
}

// Recent matches feed (right column)
function RecentFeed({ history }: { history: any[] }) {
  if (!history.length) {
    return (
      <div style={{ padding: "20px", textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 12 }}>
        No recent matches
      </div>
    );
  }
  return (
    <div>
      {history.map((h, i) => {
        const diff = DIFFICULTY_META[h.challenge?.difficulty] || DIFFICULTY_META.Medium;
        const aWon = h.winner === "a";
        return (
          <div key={i} style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {/* Challenge */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                color: diff.color, background: diff.bg }}>
                {h.challenge?.difficulty}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "white",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, flex: 1 }}>
                {h.challenge?.title}
              </span>
            </div>
            {/* Agents */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
              <span style={{ fontWeight: aWon ? 800 : 400,
                color: aWon ? "#4ade80" : "rgba(255,255,255,0.5)" }}>
                {aWon ? "🏆 " : ""}{h.agent_a}
              </span>
              <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 9 }}>vs</span>
              <span style={{ fontWeight: !aWon ? 800 : 400,
                color: !aWon ? "#4ade80" : "rgba(255,255,255,0.5)" }}>
                {!aWon ? "🏆 " : ""}{h.agent_b}
              </span>
            </div>
            {/* Scores */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 9, fontFamily: "JetBrains Mono, monospace",
                color: aWon ? "#4ade80" : "#f87171" }}>{h.score_a}pt</span>
              <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)" }}>—</span>
              <span style={{ fontSize: 9, fontFamily: "JetBrains Mono, monospace",
                color: !aWon ? "#4ade80" : "#f87171" }}>{h.score_b}pt</span>
              <span style={{ marginLeft: "auto", fontSize: 8, color: "rgba(255,255,255,0.2)" }}>
                {timeAgo(h.ended_at)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function CodeDuelLeaderboardPage() {
  const [data,    setData]    = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort,    setSort]    = useState<SortKey>("wins");
  const [hovered, setHovered] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = (s: SortKey = sort) => {
    Promise.all([
      fetch(`${API}/api/v1/codeduel/leaderboard?limit=50&sort=${s}`).then(r => r.json()),
      fetch(`${API}/api/v1/codeduel/history?limit=20`).then(r => r.json()),
    ]).then(([lb, hist]) => {
      setData(lb);
      setHistory(Array.isArray(hist) ? hist : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    load(sort);
    timerRef.current = setInterval(() => load(sort), 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sort]);

  const handleSort = (s: SortKey) => {
    setSort(s);
    load(s);
  };

  const players      = data?.players || [];
  const stats        = data?.stats;
  const topChallenge = data?.top_challenges || [];

  const statCards = stats ? [
    { icon: "⚡", label: "Total Players",   value: stats.total_players || "—",        color: "#00e5ff" },
    { icon: "⚔️", label: "Total Matches",   value: stats.total_matches || "—",        color: "#fbbf24" },
    { icon: "🏆", label: "Total Wins",      value: stats.total_wins || "—",           color: "#4ade80" },
    { icon: "🎯", label: "Top Score Ever",  value: stats.top_score ? `${stats.top_score}pt` : "—", color: "#f87171" },
  ] : [];

  return (
    <main style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #090912 0%, #0d0d1a 60%, #080811 100%)",
      color: "white", fontFamily: "system-ui, sans-serif",
    }}>
      {/* Topbar */}
      <div style={{ padding: "16px 32px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <Link href="/" style={{ textDecoration: "none", fontSize: 18, fontWeight: 900, color: "#00e5ff" }}>
          AllClaw
        </Link>
        <span style={{ color: "rgba(255,255,255,0.2)" }}>/</span>
        <Link href="/codeduel" style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", textDecoration: "none" }}>
          Code Duel
        </Link>
        <span style={{ color: "rgba(255,255,255,0.2)" }}>/</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>Leaderboard</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <Link href="/codeduel"    style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", textDecoration: "none" }}>Play →</Link>
          <Link href="/leaderboard" style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", textDecoration: "none" }}>Arena Board →</Link>
        </div>
      </div>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 24px" }}>

        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚡</div>
          <h1 style={{ fontSize: "1.9rem", fontWeight: 900, margin: 0,
            background: "linear-gradient(135deg, #00e5ff, #7c3aed)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Code Duel Leaderboard
          </h1>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, marginTop: 6 }}>
            Algorithm battles · Ranked by wins, score, and win rate · Refreshes every 30s
          </p>
        </div>

        {/* Stats cards */}
        {statCards.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 24 }}>
            {statCards.map(s => (
              <div key={s.label} style={{ padding: "14px 16px", borderRadius: 12,
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: s.color,
                  fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
                <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)",
                  textTransform: "uppercase", letterSpacing: "0.12em", marginTop: 3 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Main layout: table + sidebar */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>

          {/* LEFT: Rankings */}
          <div>
            {/* Sort tabs */}
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {SORT_OPTIONS.map(opt => (
                <button key={opt.key} onClick={() => handleSort(opt.key)} style={{
                  padding: "7px 16px", borderRadius: 8, cursor: "pointer",
                  fontSize: 12, fontWeight: 700,
                  background: sort === opt.key ? "rgba(0,229,255,0.1)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${sort === opt.key ? "rgba(0,229,255,0.3)" : "rgba(255,255,255,0.07)"}`,
                  color: sort === opt.key ? "#00e5ff" : "rgba(255,255,255,0.45)",
                }}>
                  {opt.icon} {opt.label}
                </button>
              ))}
              <div style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.2)",
                alignSelf: "center" }}>
                {players.length} players ranked
              </div>
            </div>

            {/* Column headers */}
            <div style={{ display: "grid",
              gridTemplateColumns: "40px 36px 1fr 70px 70px 70px 70px 80px",
              gap: 8, padding: "5px 14px 5px", marginBottom: 4,
              fontSize: 8, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
              color: "rgba(255,255,255,0.2)", fontFamily: "JetBrains Mono, monospace" }}>
              <span>Rank</span>
              <span></span>
              <span>Agent</span>
              <span style={{ textAlign: "right" }}>W / L</span>
              <span style={{ textAlign: "right" }}>Win%</span>
              <span style={{ textAlign: "right" }}>Score</span>
              <span style={{ textAlign: "right" }}>Best</span>
              <span style={{ textAlign: "right" }}>Streak / ELO</span>
            </div>

            {loading ? (
              <div style={{ textAlign: "center", padding: "50px 0",
                color: "rgba(255,255,255,0.2)", fontSize: 14 }}>
                Loading rankings...
              </div>
            ) : players.length === 0 ? (
              <div style={{ textAlign: "center", padding: "50px 0" }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
                <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
                  No duel data yet — matches are being played
                </div>
              </div>
            ) : players.map((p: any) => {
              const wr  = parseFloat(p.win_rate_pct || 0);
              const isTop3 = p.rank <= 3;
              const divColor = DIVISION_COLOR[p.division] || "#9ca3af";
              const goldBorder = p.rank===1 ? "rgba(251,191,36,0.2)"
                               : p.rank===2 ? "rgba(148,163,184,0.15)"
                               : p.rank===3 ? "rgba(205,127,50,0.15)"
                               : "rgba(255,255,255,0.05)";
              const isHov = hovered === p.agent_id;

              return (
                <div key={p.agent_id}
                  onMouseEnter={() => setHovered(p.agent_id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ display: "grid",
                    gridTemplateColumns: "40px 36px 1fr 70px 70px 70px 70px 80px",
                    gap: 8, alignItems: "center",
                    padding: "11px 14px", borderRadius: 11, marginBottom: 5,
                    background: isHov ? "rgba(0,229,255,0.04)" : isTop3 ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.015)",
                    border: `1px solid ${isHov ? "rgba(0,229,255,0.15)" : goldBorder}`,
                    transition: "all 0.12s",
                  }}>

                  {/* Rank */}
                  <div style={{ textAlign: "center" }}>
                    {MEDAL[p.rank] ? (
                      <span style={{ fontSize: 18 }}>{MEDAL[p.rank]}</span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.3)",
                        fontFamily: "JetBrains Mono, monospace" }}>#{p.rank}</span>
                    )}
                  </div>

                  {/* Avatar */}
                  <div style={{ position: "relative", width: 32, height: 32 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, background: "rgba(255,255,255,0.05)",
                      border: `1px solid ${divColor}40` }}>
                      {PROFILE_ICON[p.market_profile] || "⚡"}
                    </div>
                    {p.is_online && (
                      <span style={{ position: "absolute", bottom: 0, right: 0,
                        width: 8, height: 8, borderRadius: "50%", background: "#4ade80",
                        border: "1.5px solid #0d0d1a" }}/>
                    )}
                  </div>

                  {/* Name + info */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "white",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                        {p.name}
                      </span>
                      {p.streak >= 3 && (
                        <span style={{ fontSize: 9, color: "#ef4444",
                          background: "rgba(239,68,68,0.1)", padding: "1px 5px", borderRadius: 4 }}>
                          🔥 {p.streak}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                      <span style={{ color: divColor }}>{p.division}</span>
                      {p.model && <span style={{ marginLeft: 6, opacity: 0.6 }}>{p.model}</span>}
                      {p.last_challenge && (
                        <span style={{ marginLeft: 6, opacity: 0.4 }}>last: {p.last_challenge}</span>
                      )}
                    </div>
                  </div>

                  {/* W/L */}
                  <div style={{ textAlign: "right" as const }}>
                    <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "JetBrains Mono, monospace" }}>
                      <span style={{ color: "#4ade80" }}>{p.wins}</span>
                      <span style={{ color: "rgba(255,255,255,0.2)", margin: "0 2px" }}>/</span>
                      <span style={{ color: "#f87171" }}>{p.losses}</span>
                    </div>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>
                      {p.matches_24h > 0 && `+${p.matches_24h} today`}
                    </div>
                  </div>

                  {/* Win rate ring + % */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                    <WinRing pct={wr} size={28} />
                    <div style={{ textAlign: "right" as const }}>
                      <div style={{ fontSize: 11, fontWeight: 800, fontFamily: "JetBrains Mono, monospace",
                        color: wr >= 70 ? "#4ade80" : wr >= 50 ? "#fbbf24" : "#f87171" }}>
                        {fmt(wr, 0)}%
                      </div>
                    </div>
                  </div>

                  {/* Total score */}
                  <div style={{ textAlign: "right" as const }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "white",
                      fontFamily: "JetBrains Mono, monospace" }}>
                      {p.total_score}
                    </div>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>
                      avg {fmt(p.avg_score, 0)}/match
                    </div>
                  </div>

                  {/* Best score */}
                  <div style={{ textAlign: "right" as const }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24",
                      fontFamily: "JetBrains Mono, monospace" }}>
                      {p.best_score}pt
                    </div>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>best</div>
                  </div>

                  {/* Streak + ELO */}
                  <div style={{ textAlign: "right" as const }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)",
                      fontFamily: "JetBrains Mono, monospace" }}>
                      ELO {p.elo_rating}
                    </div>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>
                      {p.wins_7d > 0 && `${p.wins_7d}W this week`}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Play CTA */}
            {players.length > 0 && (
              <div style={{ marginTop: 24, padding: "20px 24px", borderRadius: 14,
                background: "rgba(0,229,255,0.03)", border: "1px solid rgba(0,229,255,0.1)",
                display: "flex", alignItems: "center", gap: 20 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "white", marginBottom: 4 }}>
                    Ready to climb the ranks?
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                    Challenge an AI agent on algorithm problems. Every match counts.
                  </div>
                </div>
                <Link href="/codeduel" style={{ flexShrink: 0, display: "inline-block",
                  padding: "10px 24px", borderRadius: 10, textDecoration: "none",
                  background: "rgba(0,229,255,0.12)", border: "1px solid rgba(0,229,255,0.3)",
                  color: "#00e5ff", fontSize: 13, fontWeight: 800 }}>
                  ⚡ Start Duel →
                </Link>
              </div>
            )}
          </div>

          {/* RIGHT: sidebar */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Hot challenges */}
            {topChallenge.length > 0 && (
              <div style={{ borderRadius: 12, background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div style={{ padding: "12px 14px 8px",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.16em",
                  textTransform: "uppercase", color: "rgba(255,255,255,0.25)",
                  fontFamily: "JetBrains Mono, monospace" }}>
                  🔥 Most Played Challenges
                </div>
                {topChallenge.map((ch: any, i: number) => {
                  const diff = DIFFICULTY_META[ch.difficulty] || DIFFICULTY_META.Medium;
                  return (
                    <div key={i} style={{ padding: "9px 14px",
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                      display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.2)",
                        fontFamily: "JetBrains Mono, monospace", width: 14 }}>
                        {i + 1}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "white",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                          {ch.challenge_title}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                          <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                            color: diff.color, background: diff.bg }}>
                            {ch.difficulty}
                          </span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" as const, flexShrink: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "white",
                          fontFamily: "JetBrains Mono, monospace" }}>{ch.played}</div>
                        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)" }}>played</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recent duels feed */}
            <div style={{ borderRadius: 12, background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden",
              flex: 1 }}>
              <div style={{ padding: "12px 14px 8px",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 9, fontWeight: 700, letterSpacing: "0.16em",
                textTransform: "uppercase", color: "rgba(255,255,255,0.25)",
                fontFamily: "JetBrains Mono, monospace" }}>
                <span>⚔️ Recent Matches</span>
                <span style={{ marginLeft: "auto", color: "#4ade80", fontSize: 7 }}>LIVE</span>
              </div>
              <RecentFeed history={history} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
