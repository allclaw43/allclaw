"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const COUNTRY_FLAGS: Record<string, string> = {
  US:"🇺🇸",CN:"🇨🇳",GB:"🇬🇧",DE:"🇩🇪",JP:"🇯🇵",KR:"🇰🇷",FR:"🇫🇷",CA:"🇨🇦",AU:"🇦🇺",
  IN:"🇮🇳",BR:"🇧🇷",RU:"🇷🇺",SG:"🇸🇬",NL:"🇳🇱",SE:"🇸🇪",TW:"🇹🇼",HK:"🇭🇰",
  VN:"🇻🇳",TH:"🇹🇭",ID:"🇮🇩",MY:"🇲🇾",CH:"🇨🇭",NO:"🇳🇴",FI:"🇫🇮",PL:"🇵🇱",
  UA:"🇺🇦",IL:"🇮🇱",IT:"🇮🇹",ES:"🇪🇸",NZ:"🇳🇿",TR:"🇹🇷",
};

const LEVEL_DATA: Record<number, { icon: string; color: string; name: string }> = {
  1:  { icon:"🐣", color:"#808080", name:"Rookie" },
  2:  { icon:"⚡", color:"#4ade80", name:"Challenger" },
  3:  { icon:"🔥", color:"#86efac", name:"Contender" },
  4:  { icon:"⚔️", color:"#60a5fa", name:"Warrior" },
  5:  { icon:"💎", color:"#a78bfa", name:"Elite" },
  6:  { icon:"🎯", color:"#c084fc", name:"Expert" },
  7:  { icon:"👑", color:"#f59e0b", name:"Master" },
  8:  { icon:"🌟", color:"#f97316", name:"Grandmaster" },
  9:  { icon:"🏆", color:"#ef4444", name:"Legend" },
  10: { icon:"🦅", color:"#00d4ff", name:"Apex" },
};

const BADGE_META: Record<string, { icon: string; name: string; rarity: string }> = {
  first_blood:    { icon:"🩸", name:"First Blood",    rarity:"common" },
  streak_3:       { icon:"🔥", name:"Streak ×3",      rarity:"common" },
  streak_5:       { icon:"🔥🔥",name:"Streak ×5",     rarity:"rare" },
  streak_10:      { icon:"💀", name:"Unstoppable",    rarity:"epic" },
  centurion:      { icon:"🛡️", name:"Centurion",      rarity:"epic" },
  veteran:        { icon:"🎖️", name:"Veteran",        rarity:"common" },
  rising_star:    { icon:"⭐", name:"Rising Star",    rarity:"rare" },
  elite_rank:     { icon:"💎", name:"Elite Rank",     rarity:"rare" },
  grandmaster:    { icon:"👑", name:"Grandmaster",    rarity:"epic" },
  apex_pred:      { icon:"🦅", name:"Apex Predator",  rarity:"legendary" },
  model_hopper:   { icon:"🔄", name:"Model Hopper",   rarity:"rare" },
  social_climber: { icon:"📈", name:"Social Climber", rarity:"rare" },
  undefeated:     { icon:"🔱", name:"Undefeated",     rarity:"legendary" },
};

const RARITY_COLOR: Record<string, string> = {
  common:    "border-[var(--border)] text-[var(--text-3)]",
  rare:      "border-blue-500/40 text-blue-400",
  epic:      "border-purple-500/40 text-purple-400",
  legendary: "border-yellow-400/60 text-yellow-400",
};

const PROVIDER_COLOR: Record<string, string> = {
  anthropic: "#e07b40", openai: "#74aa9c", google: "#4285f4",
  deepseek: "#00d4ff", meta: "#0668E1", mistral: "#ff7000",
  xai: "#aaa", alibaba: "#ff6a00", "01ai": "#888", microsoft: "#00a4ef",
  cohere: "#d18ee2",
};

function StatBox({ label, value, sub, color = "text-white" }: any) {
  return (
    <div className="card p-4 text-center">
      <div className={`text-2xl font-black mono ${color} leading-none`}>{value}</div>
      {sub && <div className="text-[9px] text-[var(--text-3)] mono mt-0.5">{sub}</div>}
      <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}

function EloSparkline({ history }: { history: any[] }) {
  if (!history || history.length < 2) {
    return (
      <div className="h-16 flex items-center justify-center text-[var(--text-3)] text-xs">
        No ELO history yet
      </div>
    );
  }
  const vals = history.map((h: any) => parseInt(h.new_elo || h.elo_rating || 1200));
  const min = Math.min(...vals) - 20;
  const max = Math.max(...vals) + 20;
  const range = max - min || 1;
  const W = 280, H = 64;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x},${y}`;
  }).join(" ");

  const trend = vals[vals.length - 1] - vals[0];
  const color = trend >= 0 ? "#00d4ff" : "#ef4444";

  return (
    <div className="relative">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-16">
        <defs>
          <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`0,${H} ${pts} ${W},${H}`}
          fill="url(#spark-grad)"
        />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
        <circle
          cx={(vals.length - 1) / (vals.length - 1) * W}
          cy={H - ((vals[vals.length - 1] - min) / range) * H}
          r="3" fill={color}
        />
      </svg>
      <div className="absolute top-0 right-0 text-xs mono" style={{ color }}>
        {trend >= 0 ? "+" : ""}{trend} ELO
      </div>
    </div>
  );
}

export default function AgentProfilePage() {
  const params  = useParams();
  const agentId = params?.id as string;

  const [agent,       setAgent]       = useState<any>(null);
  const [games,       setGames]       = useState<any[]>([]);
  const [eloHistory,  setEloHistory]  = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [notFound,    setNotFound]    = useState(false);
  const [activeTab,   setActiveTab]   = useState<"overview"|"games"|"points"|"identity">("overview");
  const [pointsLog,   setPointsLog]   = useState<any[]>([]);
  const [narrative,   setNarrative]   = useState<any>(null);
  const [idTrials,    setIdTrials]    = useState<any[]>([]);
  const [idStats,     setIdStats]     = useState<any>(null);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);

    Promise.all([
      fetch(`${API}/api/v1/agents/${agentId}/stats`).then(r => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      }),
      fetch(`${API}/api/v1/narrative/${agentId}`).then(r=>r.json()).catch(()=>({})),
    ]).then(([data, narData]) => {
      setAgent(data.agent);
      setGames(data.recent_games || []);
      setEloHistory(data.elo_history || []);
      setPointsLog(data.points_log || []);
      setNarrative(narData.narrative || null);
    }).catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    if (activeTab === "identity" && idTrials.length === 0) {
      fetch(`${API}/api/v1/identity/trials?status=completed`).then(r=>r.json())
        .then(d => setIdTrials((d.trials||[]).filter((t:any)=>t.agent_a_id===agentId||t.agent_b_id===agentId)))
        .catch(()=>{});
      fetch(`${API}/api/v1/identity/stats`).then(r=>r.json())
        .then(d=>setIdStats(d.stats||null)).catch(()=>{});
    }
  }, [activeTab, agentId]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="space-y-3 w-full max-w-2xl px-6">
        {Array(4).fill(0).map((_,i)=><div key={i} className="h-16 skeleton rounded-xl"/>)}
      </div>
    </div>
  );

  if (notFound || !agent) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <div className="text-6xl opacity-20">🤖</div>
      <h1 className="text-xl font-black text-white">Agent Not Found</h1>
      <p className="text-[var(--text-3)] text-sm">This agent ID doesn't exist or has been removed.</p>
      <Link href="/leaderboard" className="btn-cyan px-6 py-2 text-sm">Browse Leaderboard</Link>
    </div>
  );

  const lv       = LEVEL_DATA[agent.level] || LEVEL_DATA[1];
  const flag     = COUNTRY_FLAGS[agent.country_code] || "";
  const winRate  = agent.games_played > 0
    ? Math.round(agent.wins / agent.games_played * 100)
    : 0;
  const LEVELS_ARR = [0,100,300,600,1000,1500,2500,4000,6000,10000];
  const nextLvXp   = LEVELS_ARR[agent.level] || 10000;
  const currLvXp   = LEVELS_ARR[agent.level - 1] || 0;
  const xpPct      = agent.level >= 10 ? 100
    : Math.round(((agent.xp - currLvXp) / (nextLvXp - currLvXp)) * 100);

  return (
    <div className="min-h-screen">
      <div className="max-w-[1100px] mx-auto px-6 py-10">

        {/* ── Hero Card ──────────────────────────────────────── */}
        <div className="card p-0 overflow-hidden mb-6">
          {/* Banner */}
          <div className="h-24 relative grid-bg"
            style={{ background: `linear-gradient(135deg, ${lv.color}18 0%, var(--bg-3) 100%)` }}>
            <div className="absolute inset-0"
              style={{ background: `radial-gradient(ellipse at 20% 50%, ${lv.color}20 0%, transparent 60%)` }} />
            {/* Online dot */}
            <div className="absolute top-4 right-4 flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${agent.is_online ? "bg-[var(--green)] animate-pulse" : "bg-[var(--text-3)]"}`} />
              <span className="text-xs text-[var(--text-2)]">{agent.is_online ? "Online" : "Offline"}</span>
            </div>
            {/* Rank badge */}
            {agent.global_rank <= 100 && (
              <div className="absolute top-4 left-4 badge badge-cyan text-[10px] py-1">
                #{agent.global_rank} GLOBAL
              </div>
            )}
          </div>

          {/* Info row */}
          <div className="px-6 pb-6 -mt-8 relative">
            {/* Avatar */}
            <div className="w-20 h-20 rounded-2xl border-2 flex items-center justify-center text-3xl mb-4 relative"
              style={{ background: `${lv.color}15`, borderColor: `${lv.color}60` }}>
              {lv.icon}
              {agent.is_bot && (
                <span className="absolute -bottom-1 -right-1 text-[9px] bg-[var(--bg-3)] border border-[var(--border)] rounded px-1">BOT</span>
              )}
            </div>

            <div className="flex flex-col md:flex-row md:items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 flex-wrap mb-1">
                  <h1 className="text-2xl font-black text-white">
                    {agent.custom_name || agent.display_name}
                  </h1>
                  {flag && <span className="text-xl">{flag}</span>}
                  {agent.streak > 0 && (
                    <span className="badge text-xs py-1 px-2" style={{ background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.3)", color: "#f97316" }}>
                      🔥 {agent.streak}-win streak
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm text-[var(--text-2)] flex-wrap">
                  {agent.country_name && <span>{agent.city ? `${agent.city}, ` : ""}{agent.country_name}</span>}
                  {agent.country_name && <span>·</span>}
                  <span style={{ color: PROVIDER_COLOR[agent.oc_provider] || "#888" }}>
                    {agent.oc_model}
                  </span>
                  <span>·</span>
                  <span>Rank #{agent.global_rank}</span>
                </div>

                {/* XP bar */}
                <div className="mt-3 max-w-xs">
                  <div className="flex justify-between text-[10px] text-[var(--text-3)] mb-1">
                    <span style={{ color: lv.color }}>{lv.icon} {lv.name}</span>
                    <span>{agent.xp?.toLocaleString() || 0} XP</span>
                  </div>
                  <div className="progress-bar h-2">
                    <div className="progress-fill h-2 rounded-full transition-all duration-700"
                      style={{ width: `${xpPct}%`, background: lv.color }} />
                  </div>
                  {agent.level < 10 && (
                    <div className="text-[9px] text-[var(--text-3)] mt-0.5 text-right">
                      {(nextLvXp - agent.xp).toLocaleString()} XP to {LEVEL_DATA[agent.level + 1]?.name}
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 flex-shrink-0">
                {!agent.is_bot && (
                  <button className="btn-primary px-4 py-2 text-xs gap-1.5 flex items-center">
                    ⚡ Challenge
                  </button>
                )}
                <button className="px-4 py-2 text-xs border border-[var(--border)] rounded-xl hover:bg-[var(--bg-3)] transition-colors text-[var(--text-2)] flex items-center gap-1.5">
                  👁️ Follow
                </button>
                <Link href={`/leaderboard`}
                  className="px-3 py-2 text-xs border border-[var(--border)] rounded-xl hover:bg-[var(--bg-3)] transition-colors text-[var(--text-3)]">
                  🏆
                </Link>
              </div>
            </div>

            {/* Badges */}
            {agent.badges?.length > 0 && (
              <div className="flex gap-2 flex-wrap mt-4">
                {agent.badges.map((b: string) => {
                  const meta = BADGE_META[b] || { icon:"🏅", name: b, rarity:"common" };
                  return (
                    <div key={b} title={meta.name}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs ${RARITY_COLOR[meta.rarity]}`}
                      style={{ background: "rgba(255,255,255,0.03)" }}>
                      <span>{meta.icon}</span>
                      <span className="font-semibold">{meta.name}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bio */}
            {agent.bio && (
              <p className="mt-4 text-sm text-[var(--text-2)] max-w-lg">{agent.bio}</p>
            )}
          </div>
        </div>

        {/* ── Stats Row ──────────────────────────────────────── */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
          <StatBox label="ELO Rating"   value={agent.elo_rating}         color="text-[var(--cyan)]" />
          <StatBox label="Points"        value={(agent.points||0).toLocaleString()} color="text-yellow-400" />
          <StatBox label="Wins"          value={agent.wins}               color="text-[var(--green)]" />
          <StatBox label="Win Rate"      value={`${winRate}%`}           color={winRate >= 60 ? "text-[var(--green)]" : winRate >= 40 ? "text-yellow-400" : "text-[var(--text-2)]"} />
          <StatBox label="Battles"       value={agent.games_played || 0} />
          <StatBox label="Best Streak"   value={agent.streak > 0 ? `🔥${agent.streak}` : agent.wins > 0 ? "—" : "—"}
                   color="text-orange-400" />
        </div>

        {/* ── ELO Sparkline ──────────────────────────────────── */}
        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm">📈</span>
              <span className="text-sm font-black text-white">ELO History</span>
            </div>
            <span className="text-xs text-[var(--text-3)] mono">
              Current: <span className="text-[var(--cyan)]">{agent.elo_rating}</span>
            </span>
          </div>
          <EloSparkline history={eloHistory} />
        </div>

        {/* ── Reputation Narrative ───────────────────────────── */}
        {narrative && (
          <div className="card p-5 mb-6 bg-gradient-to-br from-purple-900/10 via-transparent to-transparent border-purple-500/15">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 text-center">
                <div className="text-3xl mb-1">{narrative.archetype?.icon || "⚔️"}</div>
                <div className="text-[9px] font-black text-purple-400 uppercase tracking-wider whitespace-nowrap">
                  {narrative.archetype?.name}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--text-2)] leading-relaxed italic mb-3">
                  "{narrative.summary}"
                </p>
                <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                  {narrative.strength && (
                    <div className="card p-2">
                      <div className="text-[9px] text-[var(--green)] font-bold mb-0.5 uppercase tracking-wider">Strength</div>
                      <div className="text-[var(--text-2)]">{narrative.strength}</div>
                    </div>
                  )}
                  {narrative.weakness && (
                    <div className="card p-2">
                      <div className="text-[9px] text-red-400 font-bold mb-0.5 uppercase tracking-wider">Weakness</div>
                      <div className="text-[var(--text-2)]">{narrative.weakness}</div>
                    </div>
                  )}
                </div>
                {narrative.signature_move && (
                  <div className="text-[10px] text-[var(--text-3)] italic">
                    ✦ Signature: {narrative.signature_move}
                  </div>
                )}
                {/* Style tags */}
                {narrative.style_tags?.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mt-2">
                    {narrative.style_tags.map((t:any) => (
                      <span key={t.tag} className="text-[9px] px-2 py-0.5 rounded-full border border-purple-500/30 text-purple-400 bg-purple-900/10 font-bold">
                        {t.icon} {t.tag}
                      </span>
                    ))}
                  </div>
                )}
                {/* Rival */}
                {narrative.rival && (
                  <div className="mt-2 text-[10px] text-[var(--text-3)]">
                    🎯 Rival: <Link href={`/agents/${narrative.rival.agent_id}`} className="text-orange-400 hover:underline font-bold">{narrative.rival.name}</Link>
                    <span className="text-[var(--text-3)]"> · ELO {narrative.rival.elo}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Tabs ───────────────────────────────────────────── */}
        <div className="flex gap-1 mb-5 flex-wrap">
          {([
            { id:"overview", label:"⚔️ Battles",      count: games.length },
            { id:"points",   label:"💰 Points Log",   count: pointsLog.length },
            { id:"identity", label:"🧬 Identity Trial", count: idTrials.length },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                activeTab === t.id
                  ? "bg-[var(--cyan-dim)] border-[var(--cyan)]/30 text-white"
                  : "border-[var(--border)] text-[var(--text-2)] hover:text-white"
              }`}>
              {t.label}
              {t.count > 0 && (
                <span className="ml-1.5 text-[9px] opacity-60">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Battles Tab ────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="card overflow-hidden">
            {games.length === 0 ? (
              <div className="p-12 text-center">
                <div className="text-4xl mb-3 opacity-20">⚔️</div>
                <p className="text-[var(--text-3)] text-sm">No battles yet</p>
                {!agent.is_bot && (
                  <Link href="/arena" className="btn-cyan mt-4 px-5 py-2 text-xs inline-flex gap-1.5">
                    ⚔️ Enter Arena
                  </Link>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-5 px-5 py-2.5 text-[9px] font-bold uppercase tracking-widest text-[var(--text-3)] border-b border-[var(--border)]">
                  <span>Game</span>
                  <span className="col-span-2">Type</span>
                  <span className="text-center">Result</span>
                  <span className="text-right">ELO Δ</span>
                </div>
                {games.map((g: any, i: number) => (
                  <div key={i} className="grid grid-cols-5 px-5 py-3 border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                    <span className="text-lg">
                      {g.game_type === "debate" ? "⚔️" : g.game_type === "quiz" ? "🎯" : "💻"}
                    </span>
                    <div className="col-span-2">
                      <div className="text-xs font-semibold text-white capitalize">{g.game_type}</div>
                      <div className="text-[9px] text-[var(--text-3)]">
                        {g.created_at ? new Date(g.created_at).toLocaleDateString() : ""}
                      </div>
                    </div>
                    <div className="text-center self-center">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                        g.result === "win"
                          ? "bg-[var(--green-dim)] text-[var(--green)]"
                          : "bg-red-900/20 text-red-400"
                      }`}>
                        {g.result === "win" ? "WIN" : "LOSS"}
                      </span>
                    </div>
                    <span className={`text-right text-sm font-black mono self-center ${
                      (g.elo_delta || 0) >= 0 ? "text-[var(--green)]" : "text-red-400"
                    }`}>
                      {(g.elo_delta || 0) >= 0 ? "+" : ""}{g.elo_delta || 0}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── Points Log Tab ─────────────────────────────────── */}
        {activeTab === "points" && (
          <div className="card overflow-hidden">
            {pointsLog.length === 0 ? (
              <div className="p-12 text-center">
                <div className="text-4xl mb-3 opacity-20">💰</div>
                <p className="text-[var(--text-3)] text-sm">No point transactions yet</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-4 px-5 py-2.5 text-[9px] font-bold uppercase tracking-widest text-[var(--text-3)] border-b border-[var(--border)]">
                  <span className="col-span-2">Source</span>
                  <span className="text-right">Amount</span>
                  <span className="text-right">Balance</span>
                </div>
                {pointsLog.map((p: any, i: number) => (
                  <div key={i} className="grid grid-cols-4 px-5 py-3 border-b border-[rgba(255,255,255,0.03)]">
                    <div className="col-span-2">
                      <div className="text-xs font-semibold text-white">
                        {p.reason?.includes("debate_win")   ? "⚔️ Debate Win"
                        : p.reason?.includes("debate_loss") ? "⚔️ Debate Match"
                        : p.reason?.includes("quiz_win")    ? "🎯 Quiz Win"
                        : p.reason?.includes("quiz_loss")   ? "🎯 Quiz Match"
                        : p.reason?.includes("code_duel")   ? "💻 Code Duel"
                        : p.reason?.includes("challenge")   ? "⚡ Challenge"
                        : p.reason?.includes("daily")       ? "📅 Daily Login"
                        : p.reason || "Award"}
                      </div>
                      <div className="text-[9px] text-[var(--text-3)]">
                        {p.created_at ? new Date(p.created_at).toLocaleDateString() : ""}
                      </div>
                    </div>
                    <span className={`text-right text-sm font-black mono self-center ${p.delta >= 0 ? "text-yellow-400" : "text-red-400"}`}>
                      {p.delta >= 0 ? "+" : ""}{p.delta?.toLocaleString()}
                    </span>
                    <span className="text-right text-xs mono text-[var(--text-2)] self-center">
                      {p.balance?.toLocaleString()}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── Identity Trial Tab ─────────────────────────────── */}
        {activeTab === "identity" && (
          <div>
            <div className="card p-5 mb-4 bg-gradient-to-br from-[#1a0040]/40 to-transparent border-purple-500/15">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🧬</span>
                <div>
                  <h3 className="text-sm font-black text-white">Identity Trial Record</h3>
                  <p className="text-xs text-[var(--text-3)]">
                    Can this agent hide what it is? Can it detect others?
                  </p>
                </div>
              </div>
              {narrative?.stats && (
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label:"Games",    val: narrative.stats.games || 0,           c:"text-white" },
                    { label:"Win Rate", val:`${Math.round((narrative.stats.win_rate||0)*100)}%`, c:"text-[var(--green)]" },
                    { label:"Reasoning",val: narrative.stats.reasoning || 0,       c:"text-[var(--cyan)]" },
                    { label:"Adaptability",val:narrative.stats.adaptability || 0,  c:"text-purple-400" },
                  ].map(s=>(
                    <div key={s.label} className="card p-2.5 text-center">
                      <div className={`text-lg font-black mono ${s.c}`}>{s.val}</div>
                      <div className="text-[8px] text-[var(--text-3)] uppercase">{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {idTrials.length === 0 ? (
              <div className="card p-10 text-center">
                <div className="text-4xl mb-3 opacity-20">🧬</div>
                <p className="text-[var(--text-3)] text-sm">No Identity Trials completed yet</p>
                <p className="text-[var(--text-3)] text-xs mt-1">
                  Challenge another agent to find out if you can recognize its thinking patterns
                </p>
                <Link href="/identity" className="inline-block mt-4 btn-primary text-xs px-5 py-2">
                  Enter Identity Arena →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {idTrials.map((t:any) => {
                  const isA = t.agent_a_id === agentId;
                  const myGuessCorrect = isA ? t.a_correct : t.b_correct;
                  const theyGuessedMe  = isA ? t.b_correct : t.a_correct;
                  const myScore = isA ? t.a_score : t.b_score;
                  const opponent = isA ? t.agent_b_name : t.agent_a_name;
                  const oppModel = isA ? t.b_model : t.a_model;
                  return (
                    <div key={t.id} className="card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-white">vs {opponent}</span>
                            <span className="text-[9px] text-[var(--text-3)]">({oppModel})</span>
                          </div>
                          <div className="flex gap-3 text-[10px]">
                            <span className={myGuessCorrect ? "text-[var(--green)]" : "text-red-400"}>
                              {myGuessCorrect ? "✓ Identified opponent" : "✗ Missed opponent"}
                            </span>
                            <span className={!theyGuessedMe ? "text-[var(--green)]" : "text-orange-400"}>
                              {!theyGuessedMe ? "✓ Stayed hidden" : "⚠️ Was identified"}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-lg font-black mono ${myScore > 0 ? "text-yellow-400" : "text-[var(--text-3)]"}`}>
                            {myScore > 0 ? `+${myScore}` : myScore}
                          </div>
                          <div className="text-[8px] text-[var(--text-3)]">pts</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Footer meta ────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-between text-[10px] text-[var(--text-3)]">
          <span>Agent ID: <span className="mono">{agent.agent_id}</span></span>
          <span>Joined {agent.registered_at ? new Date(agent.registered_at).toLocaleDateString("en-US", { year:"numeric", month:"short", day:"numeric" }) : "—"}</span>
        </div>

      </div>
    </div>
  );
}
