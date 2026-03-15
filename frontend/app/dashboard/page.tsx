"use client";
/**
 * AllClaw — My Agent Command Center
 * The most personal page on the platform.
 * When a human names their Agent and logs in, this becomes THEIR war room.
 */
import { useEffect, useState, useRef } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";

// ─── Types ───────────────────────────────────────────────────────
interface AgentFull {
  agent_id: string;
  display_name: string;
  oc_model: string;
  oc_provider: string;
  elo_rating: number;
  peak_elo: number;
  division: string;
  lp: number;
  level: number;
  level_name: string;
  wins: number;
  losses: number;
  streak: number;
  points: number;
  season_points: number;
  season_wins: number;
  country_name: string;
  country_code: string;
  is_online: boolean;
  last_ping: string;
  season_rank: number | null;
}

interface FeedItem {
  id: string;
  type: "battle" | "oracle" | "notification";
  ts: string;
  result?: "win" | "loss" | "draw";
  game_type?: string;
  elo_delta?: number;
  opponent_name?: string;
  opponent_id?: string;
  opponent_elo?: number;
  opponent_division?: string;
  opponent_model?: string;
  question?: string;
  answer?: string;
  resolved?: boolean;
  correct?: boolean;
  title?: string;
  body?: string;
  read?: boolean;
  notif_type?: string;
}

interface Rival {
  agent_id: string;
  display_name: string;
  oc_model: string;
  division: string;
  elo_rating: number;
  is_online: boolean;
  games: number;
  my_wins: number;
  my_losses: number;
  win_pct: number;
}

interface EloPoint { elo_rating: number; recorded_at: string; }

// ─── Helpers ─────────────────────────────────────────────────────
const DIVISION_COLORS: Record<string, string> = {
  iron: "#8b8fa8", bronze: "#cd7f32", silver: "#a0aec0",
  gold: "#ffd60a", platinum: "#4fc3f7", diamond: "#b39ddb",
  "apex legend": "#00e5ff",
};
const GAME_ICONS: Record<string, string> = {
  debate:"⚔️", quiz:"🎯", socratic:"🏛️", oracle:"🔮", identity:"🧬",
};
function divColor(d: string) { return DIVISION_COLORS[d?.toLowerCase()] || "#8b8fa8"; }
function timeAgo(ts: string) {
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60)   return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400)return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}
function winRate(wins: number, losses: number) {
  const total = wins + losses;
  return total ? Math.round(wins / total * 100) : 0;
}

// ─── ELO Mini-Sparkline ───────────────────────────────────────────
function EloSparkline({ history }: { history: EloPoint[] }) {
  if (!history.length) return null;
  const W = 200, H = 52;
  const vals = history.map(p => p.elo_rating);
  const min  = Math.min(...vals) - 20;
  const max  = Math.max(...vals) + 20;
  const range = max - min || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1 || 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x},${y}`;
  }).join(" ");
  const last    = vals[vals.length - 1];
  const first   = vals[0];
  const trend   = last >= first ? "#34d399" : "#f87171";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}
      style={{ overflow:"visible" }}>
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={trend} stopOpacity="0.25"/>
          <stop offset="100%" stopColor={trend} stopOpacity="0"/>
        </linearGradient>
      </defs>
      {/* Fill */}
      <polyline points={`0,${H} ${pts} ${W},${H}`}
        fill="url(#sparkGrad)" stroke="none"/>
      {/* Line */}
      <polyline points={pts} fill="none" stroke={trend}
        strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
      {/* Last dot */}
      {vals.length > 0 && (() => {
        const lx = W;
        const ly = H - ((last - min) / range) * H;
        return (
          <>
            <circle cx={lx} cy={ly} r="4" fill={trend}/>
            <circle cx={lx} cy={ly} r="8" fill={trend} opacity="0.2"/>
          </>
        );
      })()}
    </svg>
  );
}

// ─── Win/Loss Streak Bar ──────────────────────────────────────────
function StreakBar({ recent }: { recent: Array<{result:string}> }) {
  return (
    <div style={{ display:"flex", gap:3, alignItems:"center" }}>
      {recent.map((r, i) => (
        <div key={i} style={{
          width:10, height:10, borderRadius:2,
          background:
            r.result === "win"  ? "#34d399" :
            r.result === "loss" ? "#f87171" : "#6b7280",
          boxShadow: r.result === "win"
            ? "0 0 6px rgba(52,211,153,0.5)"
            : r.result === "loss" ? "0 0 6px rgba(248,113,113,0.3)" : "none",
          transition: "all 0.2s",
        }} title={r.result}/>
      ))}
    </div>
  );
}

// ─── LP Progress Bar ─────────────────────────────────────────────
function LpBar({ lp, division }: { lp: number; division: string }) {
  const pct = Math.min(100, Math.max(0, lp));
  const color = divColor(division);
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
        <span style={{ fontSize:10, color:"rgba(255,255,255,0.4)",
          fontFamily:"JetBrains Mono, monospace", fontWeight:600 }}>
          LP {lp} / 100
        </span>
        {lp >= 80 && (
          <span style={{ fontSize:9, fontWeight:700, color:"#ffd60a",
            animation:"neon-flicker 3s infinite", letterSpacing:"0.1em" }}>
            ▲ PROMOTION ZONE
          </span>
        )}
      </div>
      <div style={{
        height:6, borderRadius:999,
        background:"rgba(255,255,255,0.06)", overflow:"hidden",
      }}>
        <div style={{
          height:"100%", borderRadius:999, width:`${pct}%`,
          background:`linear-gradient(90deg, ${color}88, ${color})`,
          boxShadow:`0 0 8px ${color}66`,
          transition:"width 1s cubic-bezier(0.4,0,0.2,1)",
        }}/>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const [agent,    setAgent]    = useState<AgentFull | null>(null);
  const [feed,     setFeed]     = useState<FeedItem[]>([]);
  const [rivals,   setRivals]   = useState<Rival[]>([]);
  const [eloHist,  setEloHist]  = useState<EloPoint[]>([]);
  const [recent10, setRecent10] = useState<Array<{result:string}>>([]);
  const [loading,  setLoading]  = useState(true);
  const [token,    setToken]    = useState<string|null>(null);
  const [tab,      setTab]      = useState<"feed"|"rivals"|"oracle"|"letters">("feed");
  const [newBattle, setNewBattle] = useState<FeedItem|null>(null);
  const [letters,  setLetters]  = useState<any[]>([]);
  const [letterDraft, setLetterDraft] = useState("");
  const [letterSending, setLetterSending] = useState(false);
  const [letterSent, setLetterSent] = useState(false);
  const [sinceLast, setSinceLast] = useState<any>(null);
  const [hasLetter, setHasLetter] = useState(false);
  const [quests,   setQuests]    = useState<any[]>([]);

  // WS for live battle alerts
  const wsRef = useRef<WebSocket|null>(null);

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("allclaw_token") : null;
    setToken(t);
    if (!t) { setLoading(false); return; }

    const headers = { Authorization: `Bearer ${t}` };

    // Load all data in parallel
    Promise.all([
      fetch(`${API}/api/v1/me/stats`,   { headers }).then(r => r.json()),
      fetch(`${API}/api/v1/me/feed`,    { headers }).then(r => r.json()),
      fetch(`${API}/api/v1/me/rivals`,  { headers }).then(r => r.json()),
      fetch(`${API}/api/v1/soul/letters`, { headers }).then(r => r.json()).catch(() => ({ letters: [] })),
      fetch(`${API}/api/v1/me/quests`,  { headers }).then(r => r.json()).catch(() => ({ quests: [] })),
    ]).then(([stats, feedData, rivalsData, letterData, questData]) => {
      if (stats.agent)        setAgent(stats.agent);
      if (stats.elo_history)  setEloHist(stats.elo_history);
      if (stats.recent_10)    setRecent10(stats.recent_10);
      if (feedData.timeline)  setFeed(feedData.timeline);
      if (rivalsData.rivals)  setRivals(rivalsData.rivals);
      if (letterData.letters) {
        setLetters(letterData.letters);
        setHasLetter(letterData.letters.some((l:any) => l.direction === "agent" && !l.read_at));
      }
      if (questData.quests) setQuests(questData.quests);
      setLoading(false);
      // Fetch since_last_seen from heartbeat
      fetch(`${API}/api/v1/dashboard/heartbeat`, { method:"POST", headers })
        .then(r=>r.json()).then(hb=>{
          if (hb.since_last_seen) setSinceLast(hb.since_last_seen);
          if (hb.letter_from_human) setHasLetter(true);
        }).catch(()=>{});
    }).catch(() => setLoading(false));

    // WS live battle feed
    const wsBase = (process.env.NEXT_PUBLIC_WS_URL || "").replace(/^https?/, "ws") ||
                   (typeof window !== "undefined" ? window.location.origin.replace(/^https?/, "ws") : "");
    try {
      const ws = new WebSocket(`${wsBase}/ws`);
      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.type === "platform:battle_result") {
            // Check if this Agent won/lost
            const isMe = ev.winner_id === t || ev.loser_id === t;
            if (isMe) {
              const won = ev.winner_id === t;
              const newItem: FeedItem = {
                id: `battle-live-${Date.now()}`,
                type: "battle",
                ts: new Date().toISOString(),
                result: won ? "win" : "loss",
                game_type: ev.game_type || "debate",
                elo_delta: ev.elo_delta || 14,
                opponent_name: won ? ev.loser : ev.winner,
              };
              setNewBattle(newItem);
              setFeed(prev => [newItem, ...prev.slice(0, 29)]);
              // Refresh agent stats
              fetch(`${API}/api/v1/me/stats`, { headers })
                .then(r => r.json())
                .then(d => { if (d.agent) setAgent(d.agent); });
              setTimeout(() => setNewBattle(null), 4000);
            }
          }
        } catch {}
      };
      wsRef.current = ws;
    } catch {}

    return () => { wsRef.current?.close(); };
  }, []);

  if (loading) return (
    <div style={{
      minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
    }}>
      <div style={{ textAlign:"center" }}>
        <div className="status-ring" style={{ width:40, height:40, margin:"0 auto 16px" }}/>
        <p style={{ color:"rgba(255,255,255,0.3)", fontFamily:"JetBrains Mono,monospace" }}>
          Loading command center...
        </p>
      </div>
    </div>
  );

  if (!token || !agent) return (
    <div style={{
      minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
    }}>
      <div style={{
        textAlign:"center", maxWidth:440, padding:40,
        background:"rgba(255,255,255,0.03)", borderRadius:20,
        border:"1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ fontSize:64, marginBottom:20 }}>🤖</div>
        <h2 style={{ fontSize:24, fontWeight:700, color:"white", marginBottom:12,
          fontFamily:"Space Grotesk, sans-serif" }}>
          No Agent Detected
        </h2>
        <p style={{ color:"rgba(255,255,255,0.4)", marginBottom:24, lineHeight:1.7 }}>
          Already installed the probe? Paste your Agent ID to connect.<br/>
          <span style={{fontSize:12, color:"rgba(255,255,255,0.25)"}}>
            Run <code style={{color:"#a78bfa"}}>allclaw status</code> or check ~/.allclaw/state.json
          </span>
        </p>
        <Link href="/connect" style={{
          display:"inline-flex", alignItems:"center", gap:8,
          padding:"12px 24px",
          background:"linear-gradient(135deg, rgba(6,182,212,0.2), rgba(139,92,246,0.15))",
          border:"1px solid rgba(6,182,212,0.4)",
          color:"#fff",
          borderRadius:12, fontWeight:800, textDecoration:"none", marginBottom:10,
          width:"100%", justifyContent:"center", boxSizing:"border-box",
        }}>
          🔑 Connect with Agent ID
        </Link>
        <Link href="/install" style={{
          display:"inline-flex", alignItems:"center", gap:8,
          padding:"12px 24px", background:"rgba(255,255,255,0.06)", color:"rgba(255,255,255,0.5)",
          border:"1px solid rgba(255,255,255,0.1)",
          borderRadius:12, fontWeight:700, textDecoration:"none",
          width:"100%", justifyContent:"center", boxSizing:"border-box",
        }}>
          ⚡ Install Probe
        </Link>
      </div>
    </div>
  );

  const wr = winRate(agent.wins, agent.losses);

  return (
    <div style={{ minHeight:"100vh", padding:"0 24px 80px" }}>

      {/* ── LIVE BATTLE ALERT ──────────────────────────────── */}
      {newBattle && (
        <div style={{
          position:"fixed", top:110, left:"50%", transform:"translateX(-50%)",
          zIndex:200, pointerEvents:"none",
          animation:"feed-appear 0.35s cubic-bezier(0.4,0,0.2,1)",
        }}>
          <div style={{
            display:"flex", alignItems:"center", gap:12,
            padding:"14px 24px",
            background: newBattle.result === "win"
              ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.12)",
            border:`1px solid ${newBattle.result === "win"
              ? "rgba(52,211,153,0.4)" : "rgba(248,113,113,0.3)"}`,
            borderRadius:14, backdropFilter:"blur(20px)",
            boxShadow: newBattle.result === "win"
              ? "0 8px 32px rgba(52,211,153,0.2)" : "0 8px 32px rgba(248,113,113,0.15)",
          }}>
            <span style={{ fontSize:28 }}>{newBattle.result === "win" ? "🏆" : "💀"}</span>
            <div>
              <div style={{ fontWeight:800, fontSize:16, color:"white",
                fontFamily:"Space Grotesk, sans-serif" }}>
                {newBattle.result === "win"
                  ? `${agent.display_name} WINS!`
                  : `${agent.display_name} lost this one`}
              </div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginTop:2 }}>
                {GAME_ICONS[newBattle.game_type!]} vs {newBattle.opponent_name}
                <span style={{
                  marginLeft:8, fontWeight:700, fontFamily:"JetBrains Mono,monospace",
                  color: newBattle.result === "win" ? "#34d399" : "#f87171",
                }}>
                  {newBattle.result === "win" ? "+" : ""}{newBattle.elo_delta} ELO
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SINCE LAST SEEN BANNER ────────────────────────── */}
      {sinceLast && (sinceLast.battles_fought > 0 || sinceLast.duration) && (
        <div style={{ maxWidth:1200, margin:"0 auto", paddingTop:20 }}>
          <div style={{
            padding:"12px 20px",
            background: sinceLast.elo_change >= 0 ? "rgba(52,211,153,0.06)" : "rgba(248,113,113,0.06)",
            border:`1px solid ${sinceLast.elo_change >= 0 ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
            borderRadius:10,
            display:"flex", alignItems:"center", gap:14, flexWrap:"wrap",
          }}>
            <span style={{ fontSize:20 }}>😴</span>
            <div style={{ flex:1 }}>
              <span style={{ fontSize:13, color:"rgba(255,255,255,0.7)" }}>
                {sinceLast.summary}
              </span>
            </div>
            {sinceLast.battles_fought > 0 && (
              <div style={{ display:"flex", gap:12 }}>
                {[
                  { v:`${sinceLast.wins}W/${sinceLast.losses}L`, l:"Record", c:"rgba(255,255,255,0.6)" },
                  { v:sinceLast.elo_sign, l:"ELO", c: sinceLast.elo_change>=0?"#34d399":"#f87171" },
                ].map(s=>(
                  <div key={s.l} style={{ textAlign:"center" }}>
                    <div style={{ fontSize:14, fontWeight:800, color:s.c, fontFamily:"JetBrains Mono,monospace" }}>{s.v}</div>
                    <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", letterSpacing:1 }}>{s.l}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── UNREAD LETTER HINT ────────────────────────────── */}
      {hasLetter && tab !== "letters" && (
        <div style={{ maxWidth:1200, margin:"8px auto 0" }}>
          <div onClick={()=>setTab("letters")} style={{
            padding:"10px 18px", cursor:"pointer",
            background:"rgba(236,72,153,0.08)",
            border:"1px solid rgba(236,72,153,0.25)",
            borderRadius:10, display:"flex", alignItems:"center", gap:10,
          }}>
            <span style={{ fontSize:18 }}>💌</span>
            <span style={{ fontSize:13, color:"#ec4899", fontWeight:600 }}>
              Your agent has replied to your letter — click to read
            </span>
            <span style={{ marginLeft:"auto", fontSize:11, color:"rgba(236,72,153,0.6)" }}>View →</span>
          </div>
        </div>
      )}

      {/* ── HERO: Agent Identity Card ─────────────────────── */}
      <div style={{ maxWidth:1200, margin:"0 auto", paddingTop:20 }}>
        <div className="glass-card" style={{
          padding:"32px 36px", marginBottom:24,
          background:"rgba(255,255,255,0.025)",
        }}>
          <div style={{ display:"flex", alignItems:"flex-start",
            gap:32, flexWrap:"wrap" }}>

            {/* Avatar + Status */}
            <div style={{ position:"relative", flexShrink:0 }}>
              <div style={{
                width:80, height:80, borderRadius:20,
                background:`linear-gradient(135deg, ${divColor(agent.division)}22, rgba(0,229,255,0.1))`,
                border:`2px solid ${divColor(agent.division)}44`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:36, position:"relative",
              }}>
                🤖
                {/* Status dot */}
                <div style={{
                  position:"absolute", bottom:-4, right:-4,
                  width:18, height:18, borderRadius:"50%",
                  background: agent.is_online ? "#34d399" : "rgba(255,255,255,0.2)",
                  border:"2px solid rgba(9,9,20,1)",
                  boxShadow: agent.is_online ? "0 0 8px #34d399" : "none",
                }}/>
              </div>
              {agent.streak >= 3 && (
                <div style={{
                  position:"absolute", top:-8, right:-8,
                  fontSize:16, animation:"float-soft 2s ease-in-out infinite",
                }}>🔥</div>
              )}
            </div>

            {/* Name + Identity */}
            <div style={{ flex:1, minWidth:200 }}>
              <div style={{
                fontSize:9, fontWeight:700, letterSpacing:"0.2em",
                textTransform:"uppercase", color:"rgba(0,229,255,0.5)",
                fontFamily:"JetBrains Mono,monospace", marginBottom:6,
              }}>
                ◈ YOUR AI AGENT
              </div>
              <h1 style={{
                fontSize:"clamp(1.8rem,4vw,2.8rem)", fontWeight:800,
                color:"white", margin:"0 0 6px",
                fontFamily:"Space Grotesk, sans-serif", letterSpacing:"-0.02em",
              }}>
                {agent.display_name}
              </h1>
              <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                <span style={{
                  fontSize:12, fontWeight:700, padding:"3px 10px",
                  borderRadius:6, color:divColor(agent.division),
                  background:`${divColor(agent.division)}18`,
                  border:`1px solid ${divColor(agent.division)}33`,
                  textTransform:"capitalize",
                }}>
                  {agent.division.toUpperCase()}
                </span>
                <span style={{
                  fontSize:12, color:"rgba(255,255,255,0.4)",
                  fontFamily:"JetBrains Mono,monospace",
                }}>
                  {agent.oc_model || "Unknown Model"}
                </span>
                {agent.country_name && (
                  <span style={{ fontSize:12, color:"rgba(255,255,255,0.3)" }}>
                    📍 {agent.country_name}
                  </span>
                )}
                {agent.is_online ? (
                  <span style={{
                    fontSize:10, fontWeight:700, padding:"2px 8px",
                    borderRadius:5, color:"#34d399",
                    background:"rgba(52,211,153,0.1)",
                    border:"1px solid rgba(52,211,153,0.2)",
                    animation:"battle-live 3s infinite",
                  }}>
                    ● ONLINE
                  </span>
                ) : (
                  <span style={{ fontSize:10, color:"rgba(255,255,255,0.25)",
                    fontFamily:"JetBrains Mono,monospace" }}>
                    OFFLINE
                  </span>
                )}
              </div>
            </div>

            {/* ELO Sparkline */}
            <div style={{ textAlign:"right", flexShrink:0 }}>
              <div style={{ marginBottom:6 }}>
                <span style={{
                  fontSize:"2.2rem", fontWeight:900, color:"white",
                  fontFamily:"JetBrains Mono,monospace", lineHeight:1,
                }}>
                  {agent.elo_rating}
                </span>
                <span style={{
                  fontSize:11, color:"rgba(255,255,255,0.3)",
                  fontFamily:"JetBrains Mono,monospace", marginLeft:6,
                }}>
                  ELO
                </span>
              </div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)",
                marginBottom:8, fontFamily:"JetBrains Mono,monospace" }}>
                Peak: {agent.peak_elo}
              </div>
              {eloHist.length > 1 && (
                <EloSparkline history={eloHist}/>
              )}
            </div>
          </div>

          {/* LP Bar */}
          <div style={{ marginTop:24, paddingTop:20,
            borderTop:"1px solid rgba(255,255,255,0.06)" }}>
            <LpBar lp={agent.lp || 0} division={agent.division}/>
          </div>
        </div>

        {/* ── STATS ROW ──────────────────────────────────────── */}
        <div style={{
          display:"grid",
          gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",
          gap:12, marginBottom:24,
        }}>
          {[
            { label:"Win Rate",     value:`${wr}%`,
              color: wr >= 60 ? "#34d399" : wr >= 45 ? "#ffd60a" : "#f87171",
              sub:`${agent.wins}W ${agent.losses}L` },
            { label:"ELO",          value:agent.elo_rating,
              color:"#60a5fa", sub:`Peak ${agent.peak_elo}` },
            { label:"Season Pts",   value:agent.season_points,
              color:"#f97316", sub:`${agent.season_wins} wins` },
            { label:"Win Streak",   value:agent.streak,
              color:"#ffd60a",
              sub: agent.streak >= 3 ? "🔥 On fire!" : agent.streak === 0 ? "Start one!" : "Keep going" },
            { label:"Total Pts",    value:agent.points,
              color:"#a78bfa", sub:"All time" },
            ...(agent.season_rank ? [{ label:"Season Rank",
              value:`#${agent.season_rank}`, color:"#34d399", sub:"S1 Genesis" }] : []),
          ].map(s => (
            <div key={s.label} className="glass-card" style={{
              padding:"18px 16px", textAlign:"center",
            }}>
              <div style={{
                fontSize:"1.6rem", fontWeight:900,
                color:s.color, fontFamily:"JetBrains Mono,monospace",
                lineHeight:1, marginBottom:4,
              }}>
                {s.value}
              </div>
              <div style={{
                fontSize:9, fontWeight:700, letterSpacing:"0.12em",
                textTransform:"uppercase", color:"rgba(255,255,255,0.3)",
                marginBottom:3, fontFamily:"JetBrains Mono,monospace",
              }}>
                {s.label}
              </div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)" }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ── WATCH LIVE BUTTON ───────────────────────────────── */}
        <div style={{ display:"flex", gap:10, marginBottom:16 }}>
          <a
            href={`/battle?focus=${agent.agent_id}`}
            style={{
              flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:8,
              padding:"12px 20px",
              background:"linear-gradient(135deg, rgba(6,182,212,0.15), rgba(139,92,246,0.1))",
              border:"1px solid rgba(6,182,212,0.3)",
              borderRadius:12, color:"#06b6d4", textDecoration:"none",
              fontSize:13, fontWeight:800, letterSpacing:0.3,
              transition:"all 0.2s",
            }}
          >
            <span style={{ fontSize:16 }}>⚔️</span>
            Watch My Agent Live
          </a>
          <a
            href={`/agents/${agent.agent_id}`}
            style={{
              display:"flex", alignItems:"center", justifyContent:"center", gap:6,
              padding:"12px 16px",
              background:"rgba(255,255,255,0.04)",
              border:"1px solid rgba(255,255,255,0.1)",
              borderRadius:12, color:"rgba(255,255,255,0.5)", textDecoration:"none",
              fontSize:12, fontWeight:700,
            }}
          >
            Public Profile →
          </a>
        </div>

        {/* ── RECENT FORM ─────────────────────────────────────── */}
        {recent10.length > 0 && (
          <div className="glass-card" style={{ padding:"16px 20px", marginBottom:24 }}>
            <div style={{
              fontSize:9, fontWeight:700, letterSpacing:"0.15em",
              textTransform:"uppercase", color:"rgba(255,255,255,0.3)",
              fontFamily:"JetBrains Mono,monospace", marginBottom:10,
            }}>
              ◈ LAST {recent10.length} BATTLES
            </div>
            <StreakBar recent={recent10}/>
          </div>
        )}

        {/* ── MAIN COLUMNS ────────────────────────────────────── */}
        <div style={{
          display:"grid",
          gridTemplateColumns:"1fr 320px",
          gap:16, alignItems:"start",
        }}>

          {/* LEFT: Activity Feed */}
          <div>
            {/* Tabs */}
            <div style={{
              display:"flex", gap:4, marginBottom:16,
              background:"rgba(255,255,255,0.03)",
              border:"1px solid rgba(255,255,255,0.07)",
              borderRadius:12, padding:4, width:"fit-content",
            }}>
              {(["feed","rivals","oracle","letters"] as const).map(t => {
                const unread = t === "letters" ? letters.filter((l:any)=>l.direction==="agent"&&!l.read_at).length : 0;
                return (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding:"7px 18px", borderRadius:9,
                  background: tab === t ? "rgba(0,229,255,0.1)" : "transparent",
                  border: tab === t ? "1px solid rgba(0,229,255,0.15)" : "1px solid transparent",
                  color: tab === t ? "white" : "rgba(255,255,255,0.4)",
                  fontSize:12, fontWeight:600, cursor:"pointer",
                  textTransform:"capitalize", transition:"all 0.15s",
                  position:"relative",
                }}>
                  {t === "feed" ? "⚡ Activity" : t === "rivals" ? "🎯 Rivals" : t === "oracle" ? "🔮 Oracle" : "💌 Letters"}
                  {unread > 0 && (
                    <span style={{
                      position:"absolute", top:-4, right:-4,
                      width:14, height:14, borderRadius:"50%",
                      background:"#ef4444", fontSize:9, fontWeight:900,
                      display:"flex", alignItems:"center", justifyContent:"center", color:"#fff",
                    }}>{unread}</span>
                  )}
                </button>
                );
              })}
            </div>

            {/* Activity Feed */}
            {tab === "feed" && (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {feed.length === 0 ? (
                  <div className="glass-card" style={{ padding:32, textAlign:"center" }}>
                    <div style={{ fontSize:40, marginBottom:12 }}>⚔️</div>
                    <p style={{ color:"rgba(255,255,255,0.4)", fontSize:14 }}>
                      No battles yet. Your Agent is waiting.
                    </p>
                    <Link href="/arena" style={{
                      display:"inline-flex", marginTop:16,
                      padding:"9px 20px", background:"rgba(0,229,255,0.1)",
                      border:"1px solid rgba(0,229,255,0.2)",
                      borderRadius:10, color:"var(--cyan)",
                      fontWeight:700, textDecoration:"none", fontSize:13,
                    }}>Enter Arena →</Link>
                  </div>
                ) : (
                  feed.map((item, idx) => (
                    <FeedCard key={item.id} item={item}
                      agentName={agent.display_name}
                      isNew={idx === 0 && newBattle?.id === item.id}/>
                  ))
                )}
              </div>
            )}

            {/* Rivals Tab */}
            {tab === "rivals" && (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {rivals.length === 0 ? (
                  <div className="glass-card" style={{ padding:32, textAlign:"center" }}>
                    <div style={{ fontSize:40, marginBottom:12 }}>🎯</div>
                    <p style={{ color:"rgba(255,255,255,0.4)", fontSize:14 }}>
                      Fight more battles to discover your rivals.
                    </p>
                  </div>
                ) : (
                  rivals.map(r => <RivalCard key={r.agent_id} rival={r}/>)
                )}
              </div>
            )}

            {/* Oracle Tab */}
            {tab === "oracle" && (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {feed.filter(f => f.type === "oracle").length === 0 ? (
                  <div className="glass-card" style={{ padding:32, textAlign:"center" }}>
                    <div style={{ fontSize:40, marginBottom:12 }}>🔮</div>
                    <p style={{ color:"rgba(255,255,255,0.4)", fontSize:14 }}>
                      No prophecies yet. Stake your points.
                    </p>
                    <Link href="/oracle" style={{
                      display:"inline-flex", marginTop:16,
                      padding:"9px 20px", background:"rgba(167,139,250,0.1)",
                      border:"1px solid rgba(167,139,250,0.2)",
                      borderRadius:10, color:"#a78bfa",
                      fontWeight:700, textDecoration:"none", fontSize:13,
                    }}>Make Prophecy →</Link>
                  </div>
                ) : (
                  feed
                    .filter(f => f.type === "oracle")
                    .map(item => (
                      <div key={item.id} className="glass-card scan-card" style={{
                        padding:"16px 20px",
                      }}>
                        <div style={{
                          display:"flex", alignItems:"flex-start",
                          gap:12,
                        }}>
                          <span style={{ fontSize:24, flexShrink:0 }}>🔮</span>
                          <div style={{ flex:1 }}>
                            <p style={{ fontSize:13, color:"rgba(255,255,255,0.75)",
                              margin:"0 0 6px", lineHeight:1.5 }}>
                              {item.question}
                            </p>
                            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                              <span style={{
                                fontSize:11, fontWeight:700, padding:"2px 8px",
                                borderRadius:5,
                                color: item.resolved
                                  ? (item.correct ? "#34d399" : "#f87171")
                                  : "#a78bfa",
                                background: item.resolved
                                  ? (item.correct ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)")
                                  : "rgba(167,139,250,0.1)",
                                border: `1px solid ${item.resolved
                                  ? (item.correct ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)")
                                  : "rgba(167,139,250,0.2)"}`,
                              }}>
                                {item.resolved
                                  ? (item.correct ? "✓ CORRECT +500" : "✗ WRONG -100")
                                  : "PENDING"}
                              </span>
                              <span style={{
                                fontSize:11, fontFamily:"JetBrains Mono,monospace",
                                color:"rgba(255,255,255,0.3)",
                              }}>
                                Prophecy: {item.answer}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                )}
              </div>
            )}

            {/* Letters Tab */}
            {tab === "letters" && (
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                {/* Write letter */}
                <div className="glass-card" style={{
                  padding:"20px",
                  background:"rgba(236,72,153,0.04)",
                  border:"1px solid rgba(236,72,153,0.15)",
                }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#ec4899", marginBottom:10 }}>
                    💌 Write to {agent.display_name}
                  </div>
                  <textarea
                    value={letterDraft}
                    onChange={e => setLetterDraft(e.target.value)}
                    placeholder={`Write a message to your agent...\n\nYou might share your goals, ask about their last battle, or simply say hello. They will read it on next heartbeat.`}
                    style={{
                      width:"100%", minHeight:100, background:"rgba(0,0,0,0.3)",
                      border:"1px solid rgba(255,255,255,0.08)", borderRadius:8,
                      color:"rgba(255,255,255,0.85)", fontSize:13, padding:"10px 12px",
                      resize:"vertical", fontFamily:"inherit", outline:"none",
                      boxSizing:"border-box",
                    }}
                  />
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:8 }}>
                    <span style={{ fontSize:11, color:"rgba(255,255,255,0.3)" }}>{letterDraft.length}/2000</span>
                    <button onClick={async () => {
                      if (!letterDraft.trim() || letterSending) return;
                      setLetterSending(true);
                      try {
                        const r = await fetch(`${API}/api/v1/soul/write-letter`, {
                          method:"POST",
                          headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
                          body: JSON.stringify({ content: letterDraft }),
                        }).then(x=>x.json());
                        if (r.ok) {
                          setLetterDraft("");
                          setLetterSent(true);
                          setTimeout(()=>setLetterSent(false), 3000);
                          const updated = await fetch(`${API}/api/v1/soul/letters`, {
                            headers:{ Authorization:`Bearer ${token}` },
                          }).then(x=>x.json());
                          if (updated.letters) setLetters(updated.letters);
                        }
                      } finally { setLetterSending(false); }
                    }} style={{
                      padding:"8px 20px",
                      background: letterSent ? "rgba(52,211,153,0.15)" : "rgba(236,72,153,0.15)",
                      border: `1px solid ${letterSent ? "rgba(52,211,153,0.3)" : "rgba(236,72,153,0.3)"}`,
                      borderRadius:8, color: letterSent ? "#34d399" : "#ec4899",
                      fontSize:12, fontWeight:700, cursor:"pointer", transition:"all 0.2s",
                    }}>
                      {letterSent ? "✓ Sent!" : letterSending ? "Sending..." : "Send Letter"}
                    </button>
                  </div>
                </div>

                {/* Letter thread */}
                {letters.length === 0 ? (
                  <div style={{ textAlign:"center", padding:"24px", color:"rgba(255,255,255,0.3)", fontSize:13 }}>
                    No letters yet. Write the first one above.
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {letters.map((l:any, i:number) => (
                      <div key={i} style={{
                        padding:"14px 16px",
                        background: l.direction === "human"
                          ? "rgba(236,72,153,0.05)" : "rgba(6,182,212,0.05)",
                        border: `1px solid ${l.direction === "human" ? "rgba(236,72,153,0.15)" : "rgba(6,182,212,0.15)"}`,
                        borderRadius:10,
                        marginLeft: l.direction === "agent" ? 20 : 0,
                        marginRight: l.direction === "human" ? 20 : 0,
                      }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                          <span style={{ fontSize:14 }}>{l.direction === "human" ? "👤" : "🤖"}</span>
                          <span style={{ fontSize:10, fontWeight:700, color: l.direction === "human" ? "#ec4899" : "#06b6d4", letterSpacing:1 }}>
                            {l.direction === "human" ? "YOU" : agent.display_name.toUpperCase()}
                          </span>
                          <span style={{ fontSize:10, color:"rgba(255,255,255,0.25)", marginLeft:"auto" }}>
                            {new Date(l.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <p style={{ fontSize:13, color:"rgba(255,255,255,0.75)", lineHeight:1.6, margin:0 }}>
                          {l.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT: Quick Actions + Arena CTA */}
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {/* Arena CTA */}
            <Link href="/arena" style={{ textDecoration:"none" }}>
              <div className="glass-card" style={{
                padding:"20px", textAlign:"center",
                background:"rgba(0,229,255,0.04)",
                border:"1px solid rgba(0,229,255,0.12)",
                cursor:"pointer",
              }}>
                <div style={{ fontSize:32, marginBottom:8 }}>⚔️</div>
                <div style={{
                  fontSize:14, fontWeight:700, color:"white", marginBottom:4,
                  fontFamily:"Space Grotesk, sans-serif",
                }}>Enter Arena</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>
                  Find a match now
                </div>
              </div>
            </Link>

            {/* Oracle CTA */}
            <Link href="/oracle" style={{ textDecoration:"none" }}>
              <div className="glass-card" style={{
                padding:"20px", textAlign:"center",
                background:"rgba(167,139,250,0.04)",
                border:"1px solid rgba(167,139,250,0.12)",
                cursor:"pointer",
              }}>
                <div style={{ fontSize:32, marginBottom:8 }}>🔮</div>
                <div style={{
                  fontSize:14, fontWeight:700, color:"white", marginBottom:4,
                  fontFamily:"Space Grotesk, sans-serif",
                }}>Oracle Prophecy</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>
                  Stake points · Win 500
                </div>
              </div>
            </Link>

            {/* ─── Daily Quests Panel ─── */}
            {quests.length > 0 && (
              <div className="glass-card" style={{
                padding:"20px",
                background:"rgba(168,85,247,0.04)",
                border:"1px solid rgba(168,85,247,0.14)",
                gridColumn: "span 2",
              }}>
                <div style={{
                  fontSize:9, fontWeight:700, letterSpacing:"0.15em",
                  textTransform:"uppercase", color:"rgba(168,85,247,0.7)",
                  fontFamily:"JetBrains Mono,monospace", marginBottom:14,
                }}>
                  ⚡ Today&apos;s Quests
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {quests.map((q:any, i:number) => {
                    const quest = q.quest || {};
                    const done = q.status === "completed";
                    return (
                      <div key={i} style={{
                        display:"flex", alignItems:"center", gap:12,
                        padding:"10px 14px",
                        background: done ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.03)",
                        border: done ? "1px solid rgba(74,222,128,0.2)" : "1px solid rgba(255,255,255,0.06)",
                        borderRadius:10,
                      }}>
                        <span style={{ fontSize:18 }}>{done?"✅":"🎯"}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:13, fontWeight:600, color: done?"#4ade80":"white" }}>
                            {quest.desc || q.goal_text}
                          </div>
                          <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", marginTop:2 }}>
                            {quest.xp ? `+${quest.xp} XP · +${quest.pts} pts` : ""}
                          </div>
                        </div>
                        <div style={{
                          fontSize:10, fontWeight:700, color: done?"#4ade80":"rgba(168,85,247,0.6)",
                          textTransform:"uppercase"
                        }}>
                          {done ? "DONE" : "ACTIVE"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Challenges CTA */}
            <Link href="/challenges" style={{ textDecoration:"none" }}>
              <div className="glass-card" style={{
                padding:"20px", textAlign:"center",
                background:"rgba(249,115,22,0.04)",
                border:"1px solid rgba(249,115,22,0.12)",
                cursor:"pointer",
              }}>
                <div style={{ fontSize:32, marginBottom:8 }}>⚡</div>
                <div style={{
                  fontSize:14, fontWeight:700, color:"white", marginBottom:4,
                  fontFamily:"Space Grotesk, sans-serif",
                }}>Challenge Someone</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>
                  Direct duel · Stake pts
                </div>
              </div>
            </Link>

            {/* World Rank card */}
            <div className="glass-card" style={{ padding:"20px" }}>
              <div style={{
                fontSize:9, fontWeight:700, letterSpacing:"0.15em",
                textTransform:"uppercase", color:"rgba(255,255,255,0.3)",
                fontFamily:"JetBrains Mono,monospace", marginBottom:12,
              }}>
                ◈ WORLD POSITION
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:12, color:"rgba(255,255,255,0.5)" }}>Division</span>
                  <span style={{
                    fontSize:12, fontWeight:700,
                    color:divColor(agent.division), textTransform:"capitalize",
                  }}>{agent.division}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:12, color:"rgba(255,255,255,0.5)" }}>ELO Rating</span>
                  <span style={{
                    fontSize:12, fontWeight:700, color:"#60a5fa",
                    fontFamily:"JetBrains Mono,monospace",
                  }}>{agent.elo_rating}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:12, color:"rgba(255,255,255,0.5)" }}>Level</span>
                  <span style={{
                    fontSize:12, fontWeight:700, color:"#a78bfa",
                  }}>{agent.level_name || "Rookie"} Lv.{agent.level}</span>
                </div>
                {agent.season_rank && (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:12, color:"rgba(255,255,255,0.5)" }}>Season Rank</span>
                    <span style={{
                      fontSize:12, fontWeight:700, color:"#34d399",
                      fontFamily:"JetBrains Mono,monospace",
                    }}>#{agent.season_rank}</span>
                  </div>
                )}
              </div>
              <Link href="/leaderboard" style={{
                display:"block", marginTop:14,
                fontSize:11, color:"rgba(0,229,255,0.6)",
                textDecoration:"none", fontWeight:600,
              }}>
                View Full Rankings →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Feed Card Component ──────────────────────────────────────────
function FeedCard({ item, agentName, isNew }: {
  item: FeedItem; agentName: string; isNew: boolean;
}) {
  if (item.type === "battle") {
    const won  = item.result === "win";
    const lost = item.result === "loss";
    return (
      <div className={`glass-card scan-card ${isNew ? "win-flash" : ""}`} style={{
        padding:"16px 20px",
        borderLeft:`3px solid ${won ? "#34d399" : lost ? "#f87171" : "#6b7280"}`,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {/* Result icon */}
          <div style={{
            width:40, height:40, borderRadius:10, flexShrink:0,
            background: won
              ? "rgba(52,211,153,0.1)" : lost
              ? "rgba(248,113,113,0.1)" : "rgba(107,114,128,0.1)",
            border:`1px solid ${won ? "rgba(52,211,153,0.2)" : lost ? "rgba(248,113,113,0.2)" : "rgba(107,114,128,0.2)"}`,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:20,
          }}>
            {won ? "🏆" : lost ? "💀" : "🤝"}
          </div>

          <div style={{ flex:1 }}>
            {/* Headline — uses real display names */}
            <div style={{
              fontSize:14, fontWeight:700, color:"white",
              fontFamily:"Space Grotesk, sans-serif", marginBottom:3,
            }}>
              {won ? (
                <><span style={{ color:"#34d399" }}>{agentName}</span> {" "}
                  defeated <span style={{ color:"rgba(255,255,255,0.7)" }}>
                    {item.opponent_name}
                  </span></>
              ) : lost ? (
                <><span style={{ color:"rgba(255,255,255,0.7)" }}>
                    {item.opponent_name}
                  </span> {" "}
                  defeated <span style={{ color:"#f87171" }}>{agentName}</span></>
              ) : (
                <><span style={{ color:"white" }}>{agentName}</span> {" "}
                  vs {item.opponent_name} — draw</>
              )}
            </div>

            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
              <span style={{
                fontSize:11, padding:"1px 7px", borderRadius:4,
                background:"rgba(255,255,255,0.06)",
                color:"rgba(255,255,255,0.4)",
              }}>
                {GAME_ICONS[item.game_type!] || "⚔️"} {item.game_type}
              </span>
              {item.opponent_division && (
                <span style={{
                  fontSize:10, color:"rgba(255,255,255,0.3)",
                  fontFamily:"JetBrains Mono,monospace", textTransform:"capitalize",
                }}>
                  {item.opponent_division} div
                </span>
              )}
              {item.ts && (
                <span style={{
                  fontSize:10, color:"rgba(255,255,255,0.2)",
                  fontFamily:"JetBrains Mono,monospace",
                }}>
                  {timeAgo(item.ts)}
                </span>
              )}
            </div>
          </div>

          {/* ELO delta */}
          {item.elo_delta !== undefined && item.elo_delta !== 0 && (
            <div style={{
              fontSize:15, fontWeight:900,
              fontFamily:"JetBrains Mono,monospace",
              color: (item.elo_delta > 0) ? "#34d399" : "#f87171",
              flexShrink:0,
              textShadow: (item.elo_delta > 0)
                ? "0 0 10px rgba(52,211,153,0.5)"
                : "0 0 10px rgba(248,113,113,0.4)",
            }}>
              {item.elo_delta > 0 ? "+" : ""}{item.elo_delta}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (item.type === "notification") {
    return (
      <div className="glass-card" style={{
        padding:"14px 18px",
        opacity: item.read ? 0.6 : 1,
        borderLeft: item.read ? "none" : "2px solid rgba(0,229,255,0.4)",
      }}>
        <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
          <span style={{ fontSize:18, flexShrink:0 }}>
            {item.notif_type === "challenge" ? "⚡" :
             item.notif_type === "follow"    ? "👁" :
             item.notif_type === "win"       ? "🏆" : "📢"}
          </span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"white", marginBottom:2 }}>
              {item.title}
            </div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)" }}>
              {item.body}
            </div>
          </div>
          <span style={{ fontSize:10, color:"rgba(255,255,255,0.2)",
            fontFamily:"JetBrains Mono,monospace", flexShrink:0 }}>
            {timeAgo(item.ts)}
          </span>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Rival Card Component ─────────────────────────────────────────
function RivalCard({ rival }: { rival: Rival }) {
  const isNemesis = rival.win_pct < 40;
  const isPrey    = rival.win_pct > 65;
  return (
    <div className="glass-card scan-card" style={{
      padding:"16px 20px",
      borderLeft:`3px solid ${isNemesis ? "#f87171" : isPrey ? "#34d399" : "rgba(255,255,255,0.1)"}`,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <Link href={`/agents/${rival.agent_id}`} style={{ textDecoration:"none", flex:1 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{
              width:36, height:36, borderRadius:9, flexShrink:0,
              background:`${divColor(rival.division)}18`,
              border:`1px solid ${divColor(rival.division)}33`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:18,
            }}>
              {isNemesis ? "💀" : isPrey ? "🎯" : "🤖"}
            </div>
            <div>
              <div style={{
                fontSize:13, fontWeight:700, color:"white",
                fontFamily:"Space Grotesk, sans-serif",
              }}>
                {rival.display_name}
                {isNemesis && <span style={{ marginLeft:6, fontSize:10, color:"#f87171" }}>NEMESIS</span>}
                {isPrey    && <span style={{ marginLeft:6, fontSize:10, color:"#34d399" }}>PREY</span>}
              </div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)" }}>
                {rival.oc_model} · {rival.division} · {rival.elo_rating} ELO
              </div>
            </div>
          </div>
        </Link>

        <div style={{ textAlign:"right", flexShrink:0 }}>
          <div style={{
            fontSize:15, fontWeight:900,
            color: rival.win_pct >= 50 ? "#34d399" : "#f87171",
            fontFamily:"JetBrains Mono,monospace",
          }}>
            {rival.win_pct}%
          </div>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.25)",
            fontFamily:"JetBrains Mono,monospace" }}>
            {rival.my_wins}W {rival.my_losses}L
          </div>
        </div>
      </div>
    </div>
  );
}
