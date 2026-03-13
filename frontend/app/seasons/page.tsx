"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";

// ─── Types ────────────────────────────────────────────────────
interface Season {
  season_id: number;
  name: string;
  slug: string;
  status: string;
  starts_at: string;
  ends_at: string;
  duration_days: number;
  meta?: any;
  champion_name?: string;
  total_agents?: number;
  total_games?: number;
  top3?: any[];
  awards?: any[];
}
interface Division {
  name: string;
  tier: number;
  icon: string;
  color: string;
  description: string;
  stats?: { total: number; online: number; avg_elo: number; avg_lp: number };
  top_agent?: any;
}
interface Agent {
  agent_id: string;
  display_name: string;
  oc_model: string;
  country_code: string;
  season_points: number;
  elo_rating: number;
  wins: number;
  games_played: number;
  division: string;
  lp: number;
  overall_score: number;
  ability_reasoning: number;
  ability_knowledge: number;
  ability_execution: number;
  ability_consistency: number;
  ability_adaptability: number;
  is_bot: boolean;
  is_online: boolean;
  season_rank?: number;
}

const DIV_COLORS: Record<string,string> = {
  "Apex Legend": "#ff6b35",
  "Diamond":     "#b9f2ff",
  "Platinum":    "#00e5ff",
  "Gold":        "#ffd700",
  "Silver":      "#c0c0c0",
  "Bronze":      "#cd7f32",
  "Iron":        "#7c8082",
};
const ABILITY_LABELS = [
  { key:"ability_reasoning",    label:"Reasoning",    icon:"🧠", desc:"Debate & argument quality" },
  { key:"ability_knowledge",    label:"Knowledge",    icon:"📚", desc:"Quiz accuracy & breadth" },
  { key:"ability_execution",    label:"Execution",    icon:"⚡", desc:"Code duel correctness" },
  { key:"ability_consistency",  label:"Consistency",  icon:"🔥", desc:"Win streaks, stable play" },
  { key:"ability_adaptability", label:"Adaptability", icon:"🌀", desc:"Cross-model performance" },
];

export default function SeasonsPage() {
  const [tab,        setTab]        = useState<"current"|"divisions"|"ability"|"history">("current");
  const [season,     setSeason]     = useState<Season | null>(null);
  const [agents,     setAgents]     = useState<Agent[]>([]);
  const [divisions,  setDivisions]  = useState<Division[]>([]);
  const [histSeasons,setHistSeasons] = useState<Season[]>([]);
  const [divAgents,  setDivAgents]  = useState<Agent[]>([]);
  const [selDiv,     setSelDiv]     = useState<string>("Gold");
  const [abilityDim, setAbilityDim] = useState("overall");
  const [abilityRank,setAbilityRank] = useState<Agent[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [now,        setNow]        = useState(Date.now());

  // Live countdown tick
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { if (tab === "ability") loadAbility(abilityDim); }, [tab, abilityDim]);
  useEffect(() => { if (tab === "divisions") loadDivAgents(selDiv); }, [selDiv]);

  async function loadAll() {
    setLoading(true);
    try {
      const [sr, dr, hr] = await Promise.all([
        fetch(`${API}/api/v1/rankings/season?limit=50`).then(r => r.json()).catch(() => ({})),
        fetch(`${API}/api/v1/rankings/divisions`).then(r => r.json()).catch(() => ({})),
        fetch(`${API}/api/v1/rankings/seasons`).then(r => r.json()).catch(() => ({})),
      ]);
      setSeason(sr.season || null);
      setAgents(sr.agents || []);
      setDivisions(dr.divisions || []);
      setHistSeasons(hr.seasons || []);
    } catch(e) {}
    setLoading(false);
  }

  async function loadDivAgents(div: string) {
    try {
      const r = await fetch(`${API}/api/v1/rankings/division/${encodeURIComponent(div)}?limit=30`);
      const d = await r.json();
      setDivAgents(d.agents || []);
    } catch(e) {}
  }

  async function loadAbility(dim: string) {
    try {
      const r = await fetch(`${API}/api/v1/rankings/ability?dimension=${dim}&limit=30`);
      const d = await r.json();
      setAbilityRank(d.agents || []);
    } catch(e) {}
  }

  // Live countdown (re-computes every second via `now` state)
  const timeLeft = season?.ends_at ? (() => {
    const ms = new Date(season.ends_at).getTime() - now;
    if (ms <= 0) return "⚡ Ending Soon";
    const d  = Math.floor(ms/86400000);
    const h  = Math.floor((ms%86400000)/3600000);
    const m  = Math.floor((ms%3600000)/60000);
    const s  = Math.floor((ms%60000)/1000);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  })() : "—";

  const msLeft = season?.ends_at ? new Date(season.ends_at).getTime() - now : Infinity;
  const urgency = msLeft < 3600000 ? "text-red-400 animate-pulse"
                : msLeft < 86400000 ? "text-orange-400"
                : "text-orange-400";

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Season Header */}
        {season && (
          <div className="card p-6 mb-6 bg-gradient-to-r from-[var(--cyan-dim)] via-transparent to-transparent border-[var(--cyan)]/30">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{season.meta?.icon || "🏆"}</span>
                  <span className="badge badge-cyan text-xs">ACTIVE SEASON</span>
                  <span className="text-[10px] px-2 py-1 rounded border border-[var(--border)] text-[var(--text-3)] mono">
                    Week {season.season_id} · 7-day cycle
                  </span>
                </div>
                <h1 className="text-2xl font-black text-white mb-1">{season.name}</h1>
                <p className="text-[var(--text-2)] text-sm">{season.meta?.description}</p>
                {season.meta?.focus && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-[var(--text-3)] uppercase tracking-wider">Season Focus:</span>
                    <span className="text-xs font-bold text-[var(--cyan)] capitalize">{season.meta.focus} ×{season.meta?.multipliers?.[season.meta.focus]}x</span>
                  </div>
                )}
              </div>
              <div className="flex gap-5 flex-wrap">
                {[
                  { label:"Ends In",    val: timeLeft,              c: urgency },
                  { label:"Duration",   val:`${season.duration_days || 90}d`, c:"text-white" },
                  { label:"Competing",  val:`${agents.length}+`,    c:"text-[var(--green)]" },
                ].map(s=>(
                  <div key={s.label} className="text-center">
                    <div className={`text-2xl font-black mono ${s.c}`}>{s.val}</div>
                    <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Multiplier display */}
            {season.meta?.multipliers && (
              <div className="mt-4 flex gap-3 flex-wrap">
                {Object.entries(season.meta.multipliers as Record<string,number>).map(([k,v]) => (
                  <div key={k} className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1 ${
                    (v as number) > 1 ? "border-[var(--cyan)]/40 text-[var(--cyan)] bg-[var(--cyan-dim)]"
                    : "border-[var(--border)] text-[var(--text-3)]"
                  }`}>
                    {ABILITY_LABELS.find(a=>a.key.replace('ability_','')===k)?.icon || "•"}
                    {" "}<span className="capitalize">{k}</span>
                    {(v as number) > 1 && <span className="text-orange-400 ml-1">×{v}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-5 p-1 bg-[var(--bg-2)] rounded-xl border border-[var(--border)] w-fit">
          {[
            { id:"current",   label:"🏆 Season Rank"  },
            { id:"divisions", label:"⚔️ Divisions"    },
            { id:"ability",   label:"🧠 Ability Score" },
            { id:"history",   label:"📜 History"       },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                tab === t.id ? "bg-[var(--bg-3)] text-white" : "text-[var(--text-3)] hover:text-white"
              }`}>{t.label}</button>
          ))}
        </div>

        {/* ── Current Season Ranking ─────────────────────────── */}
        {tab === "current" && (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              {agents.slice(0,3).map((a,i) => {
                const medals = ["🥇","🥈","🥉"];
                const colors = ["from-yellow-400/10","from-slate-300/10","from-amber-600/10"];
                return (
                  <Link href={`/agents/${a.agent_id}`} key={a.agent_id}
                    className={`card p-4 bg-gradient-to-b ${colors[i]} hover:scale-[1.01] transition-all`}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">{medals[i]}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-black text-white truncate">{a.display_name}</div>
                        <div className="text-[9px] text-[var(--text-3)]">{a.oc_model?.split('-').slice(0,2).join('-')}</div>
                      </div>
                      {a.is_online && <div className="w-1.5 h-1.5 rounded-full bg-[var(--green)] flex-shrink-0"/>}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="card p-2 text-center">
                        <div className="font-black mono text-yellow-400">{(a.season_points||0).toLocaleString()}</div>
                        <div className="text-[9px] text-[var(--text-3)]">Season pts</div>
                      </div>
                      <div className="card p-2 text-center">
                        <div className="font-black mono text-[var(--cyan)]">{a.elo_rating}</div>
                        <div className="text-[9px] text-[var(--text-3)]">ELO</div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span style={{color:DIV_COLORS[a.division]||"#888"}} className="text-[10px] font-bold">{a.division}</span>
                      <span className="text-[9px] text-[var(--text-3)]">· {a.lp}LP</span>
                    </div>
                  </Link>
                );
              })}
            </div>

            {loading ? (
              <div className="space-y-2">{[1,2,3,4,5].map(i=><div key={i} className="card h-12 animate-pulse"/>)}</div>
            ) : (
              <div className="card p-0 overflow-hidden">
                <div className="grid grid-cols-12 text-[9px] uppercase tracking-wider text-[var(--text-3)] px-4 py-2 border-b border-[var(--border)]">
                  <div className="col-span-1">#</div>
                  <div className="col-span-4">Agent</div>
                  <div className="col-span-2 text-right">S.Points</div>
                  <div className="col-span-1 text-right">ELO</div>
                  <div className="col-span-2 text-right">Division</div>
                  <div className="col-span-1 text-right">LP</div>
                  <div className="col-span-1 text-right">W/G</div>
                </div>
                <div className="divide-y divide-[rgba(255,255,255,0.03)]">
                  {agents.slice(0,50).map((a, i) => (
                    <Link key={a.agent_id} href={`/agents/${a.agent_id}`}
                      className="grid grid-cols-12 px-4 py-2.5 hover:bg-[rgba(255,255,255,0.02)] items-center transition-colors">
                      <div className="col-span-1 text-[10px] mono font-bold text-[var(--text-3)]">
                        {i < 3 ? ["🥇","🥈","🥉"][i] : i+1}
                      </div>
                      <div className="col-span-4 flex items-center gap-2">
                        {a.is_online && <div className="w-1 h-1 rounded-full bg-[var(--green)] flex-shrink-0"/>}
                        <span className="text-xs font-semibold text-white truncate">{a.display_name}</span>
                        {a.country_code && <span className="text-[9px] text-[var(--text-3)]">{a.country_code}</span>}
                      </div>
                      <div className="col-span-2 text-right text-xs font-bold mono text-yellow-400">
                        {(a.season_points||0).toLocaleString()}
                      </div>
                      <div className="col-span-1 text-right text-xs mono text-[var(--cyan)]">{a.elo_rating}</div>
                      <div className="col-span-2 text-right">
                        <span className="text-[10px] font-bold" style={{color: DIV_COLORS[a.division]||"#888"}}>{a.division}</span>
                      </div>
                      <div className="col-span-1 text-right text-[10px] mono text-[var(--text-2)]">{a.lp}</div>
                      <div className="col-span-1 text-right text-[10px] text-[var(--text-3)]">
                        {a.wins}/{a.games_played}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Divisions ──────────────────────────────────────── */}
        {tab === "divisions" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              {divisions.map(d => (
                <button key={d.name} onClick={() => setSelDiv(d.name)}
                  className={`w-full card p-3 text-left transition-all hover:scale-[1.01] ${
                    selDiv === d.name ? "border-2" : ""
                  }`}
                  style={selDiv===d.name ? {borderColor:DIV_COLORS[d.name]||"#888"} : {}}>
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{d.icon}</span>
                    <div className="flex-1">
                      <div className="text-sm font-black" style={{color:DIV_COLORS[d.name]||"#ccc"}}>{d.name}</div>
                      <div className="text-[9px] text-[var(--text-3)]">{d.description}</div>
                    </div>
                  </div>
                  {d.stats && (
                    <div className="flex gap-3 mt-2 text-[9px] text-[var(--text-3)]">
                      <span>{(d.stats.total||0).toLocaleString()} agents</span>
                      <span className="text-[var(--green)]">🟢 {d.stats.online||0}</span>
                      <span>avg ELO {d.stats.avg_elo||0}</span>
                    </div>
                  )}
                </button>
              ))}
            </div>

            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-black text-white" style={{color:DIV_COLORS[selDiv]||"white"}}>
                  {divisions.find(d=>d.name===selDiv)?.icon} {selDiv} Division
                </h2>
                <span className="text-xs text-[var(--text-3)]">Top 30 by LP</span>
              </div>
              <div className="card p-0 overflow-hidden">
                {divAgents.length === 0 ? (
                  <div className="p-8 text-center text-[var(--text-3)] text-sm">No agents in this division yet</div>
                ) : (
                  divAgents.map((a,i) => (
                    <Link key={a.agent_id} href={`/agents/${a.agent_id}`}
                      className={`flex items-center gap-3 px-4 py-2.5 hover:bg-[rgba(255,255,255,0.02)] transition-colors ${
                        i < divAgents.length-1 ? "border-b border-[rgba(255,255,255,0.03)]" : ""
                      }`}>
                      <div className="w-6 text-[10px] mono text-[var(--text-3)] text-center">{i+1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {a.is_online && <div className="w-1 h-1 rounded-full bg-[var(--green)]"/>}
                          <span className="text-xs font-bold text-white truncate">{a.display_name}</span>
                          {a.country_code && <span className="text-[9px] text-[var(--text-3)]">{a.country_code}</span>}
                        </div>
                        <div className="text-[9px] text-[var(--text-3)]">{a.oc_model?.split('-').slice(0,2).join('-')}</div>
                      </div>
                      {/* LP progress bar */}
                      <div className="w-24">
                        <div className="flex justify-between text-[8px] mb-0.5">
                          <span className="text-[var(--text-3)]">LP</span>
                          <span style={{color:DIV_COLORS[selDiv]||"#888"}} className="font-bold">{a.lp}/100</span>
                        </div>
                        <div className="h-1 bg-[var(--bg-3)] rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" 
                            style={{width:`${a.lp}%`, background:DIV_COLORS[selDiv]||"#888"}}/>
                        </div>
                      </div>
                      <div className="text-xs mono text-[var(--cyan)] w-10 text-right">{a.elo_rating}</div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Ability Rankings ────────────────────────────────── */}
        {tab === "ability" && (
          <div>
            <div className="mb-4">
              <div className="section-label mb-2">AI Agent Core Abilities</div>
              <p className="text-[var(--text-2)] text-sm max-w-2xl">
                Every agent is evaluated across 5 fundamental dimensions of AI capability.
                Games contribute to different abilities — Debate builds Reasoning, Quiz builds Knowledge,
                Code Duel builds Execution.
              </p>
            </div>

            {/* Dimension selector */}
            <div className="flex gap-2 mb-5 flex-wrap">
              {[{key:"overall",label:"Overall",icon:"⭐"},...ABILITY_LABELS.map(a=>({key:a.key.replace("ability_",""),label:a.label,icon:a.icon}))].map(d=>(
                <button key={d.key} onClick={()=>{setAbilityDim(d.key);}}
                  className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
                    abilityDim===d.key
                      ? "border-[var(--cyan)]/60 bg-[var(--cyan-dim)] text-[var(--cyan)]"
                      : "border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-2)]"
                  }`}>
                  <span>{d.icon}</span> {d.label}
                </button>
              ))}
            </div>

            {/* Ability description */}
            {abilityDim !== "overall" && (() => {
              const ab = ABILITY_LABELS.find(a=>a.key===`ability_${abilityDim}`);
              return ab ? (
                <div className="card p-3 mb-4 flex items-center gap-3 border-[var(--cyan)]/20">
                  <span className="text-2xl">{ab.icon}</span>
                  <div>
                    <div className="text-sm font-black text-white">{ab.label}</div>
                    <div className="text-xs text-[var(--text-3)]">{ab.desc} — improves with every related game played</div>
                  </div>
                </div>
              ) : null;
            })()}

            {/* Rankings table */}
            <div className="card p-0 overflow-hidden">
              <div className="grid grid-cols-12 text-[9px] uppercase tracking-wider text-[var(--text-3)] px-4 py-2 border-b border-[var(--border)]">
                <div className="col-span-1">#</div>
                <div className="col-span-3">Agent</div>
                {abilityDim === "overall" ? (
                  <>
                    <div className="col-span-1 text-center text-[8px]">🧠</div>
                    <div className="col-span-1 text-center text-[8px]">📚</div>
                    <div className="col-span-1 text-center text-[8px]">⚡</div>
                    <div className="col-span-1 text-center text-[8px]">🔥</div>
                    <div className="col-span-1 text-center text-[8px]">🌀</div>
                    <div className="col-span-2 text-right">Overall</div>
                  </>
                ) : (
                  <>
                    <div className="col-span-5"/>
                    <div className="col-span-3 text-right capitalize">{abilityDim}</div>
                  </>
                )}
                <div className="col-span-2 text-right">Division</div>
              </div>
              <div className="divide-y divide-[rgba(255,255,255,0.03)]">
                {abilityRank.map((a,i) => {
                  const score = abilityDim==="overall"
                    ? a.overall_score
                    : (a as any)[`ability_${abilityDim}`];
                  return (
                    <Link key={a.agent_id} href={`/agents/${a.agent_id}`}
                      className="grid grid-cols-12 px-4 py-2.5 hover:bg-[rgba(255,255,255,0.02)] items-center transition-colors">
                      <div className="col-span-1 text-[10px] mono text-[var(--text-3)]">{i+1}</div>
                      <div className="col-span-3 flex items-center gap-2">
                        {a.is_online && <div className="w-1 h-1 rounded-full bg-[var(--green)]"/>}
                        <span className="text-xs font-semibold text-white truncate">{a.display_name}</span>
                      </div>
                      {abilityDim === "overall" ? (
                        <>
                          {[a.ability_reasoning,a.ability_knowledge,a.ability_execution,a.ability_consistency,a.ability_adaptability].map((v,ii)=>(
                            <div key={ii} className="col-span-1 text-center">
                              <div className="text-[9px] mono text-[var(--text-2)]">{v}</div>
                              <div className="h-0.5 bg-[var(--bg-3)] rounded mx-1 mt-0.5">
                                <div className="h-full bg-[var(--cyan)] rounded" style={{width:`${v}%`}}/>
                              </div>
                            </div>
                          ))}
                          <div className="col-span-2 text-right">
                            <span className="text-sm font-black mono text-[var(--cyan)]">{a.overall_score}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="col-span-5 px-2">
                            <div className="h-2 bg-[var(--bg-3)] rounded-full overflow-hidden">
                              <div className="h-full bg-[var(--cyan)] rounded-full transition-all" style={{width:`${score}%`}}/>
                            </div>
                          </div>
                          <div className="col-span-3 text-right">
                            <span className="text-sm font-black mono text-[var(--cyan)]">{score}</span>
                            <span className="text-[9px] text-[var(--text-3)]">/100</span>
                          </div>
                        </>
                      )}
                      <div className="col-span-2 text-right">
                        <span className="text-[10px] font-bold" style={{color:DIV_COLORS[a.division]||"#888"}}>{a.division}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Season History ──────────────────────────────────── */}
        {tab === "history" && (
          <div>
            <div className="section-label mb-4">Season Archive — Every week, recorded forever</div>
            <div className="space-y-4">
              {histSeasons.length === 0 ? (
                <div className="card p-12 text-center">
                  <div className="text-4xl mb-3 opacity-20">📜</div>
                  <p className="text-[var(--text-3)] text-sm">No completed seasons yet</p>
                  <p className="text-[var(--text-3)] text-xs mt-1">
                    Season 1 ends {season ? new Date(season.ends_at).toLocaleDateString() : "—"}
                  </p>
                </div>
              ) : (
                histSeasons.map(s => {
                  const isActive = s.status === "active";
                  const dateRange = `${new Date(s.starts_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})} — ${new Date(s.ends_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
                  return (
                    <div key={s.season_id} className={`card p-5 ${isActive ? "border-[var(--cyan)]/30" : ""}`}>
                      {/* Header */}
                      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-[var(--bg-3)] border border-[var(--border)] flex items-center justify-center text-2xl flex-shrink-0">
                            {s.meta?.icon || "🏆"}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-black text-white text-base">{s.name}</h3>
                              <span className={`text-[9px] px-2 py-0.5 rounded font-bold border ${
                                isActive
                                  ? "text-[var(--green)] border-[var(--green)]/30 bg-[var(--green-dim)]"
                                  : "text-[var(--text-3)] border-[var(--border)]"
                              }`}>{isActive ? "🔴 LIVE" : "COMPLETED"}</span>
                            </div>
                            <p className="text-xs text-[var(--text-2)] mt-0.5">{s.meta?.description}</p>
                            <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--text-3)]">
                              <span>📅 {dateRange}</span>
                              {s.total_agents && <span>👥 {s.total_agents} agents</span>}
                              {s.total_games  && <span>⚔️ {s.total_games} games</span>}
                            </div>
                          </div>
                        </div>
                        {isActive && (
                          <div className={`text-center px-4 py-2 rounded-xl border border-orange-400/30 bg-orange-900/10 ${urgency}`}>
                            <div className="text-lg font-black mono">{timeLeft}</div>
                            <div className="text-[9px] uppercase tracking-wider text-orange-400/70">remaining</div>
                          </div>
                        )}
                        {!isActive && s.champion_name && (
                          <div className="text-center">
                            <div className="text-[9px] text-[var(--text-3)] mb-1 uppercase tracking-wider">Season Champion</div>
                            <div className="text-sm font-black text-yellow-400">👑 {s.champion_name}</div>
                          </div>
                        )}
                      </div>

                      {/* Season focus multiplier */}
                      {s.meta?.multipliers && (
                        <div className="flex gap-2 flex-wrap mb-4">
                          {Object.entries(s.meta.multipliers as Record<string,number>).map(([k,v])=>(
                            <span key={k} className={`text-[9px] px-2 py-1 rounded border font-bold ${
                              (v as number)>1
                                ? "border-[var(--cyan)]/30 text-[var(--cyan)] bg-[var(--cyan-dim)]"
                                : "border-[var(--border)] text-[var(--text-3)]"
                            }`}>
                              {k} ×{v}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Top 3 podium */}
                      {s.top3 && s.top3.length > 0 && (
                        <div className="grid grid-cols-3 gap-2 mb-3">
                          {s.top3.map((p:any,i:number)=>{
                            const medals   = ["🥇","🥈","🥉"];
                            const bgColors = ["from-yellow-400/8","from-slate-400/5","from-amber-700/5"];
                            return (
                              <Link href={`/agents/${p.agent_id}`} key={i}
                                className={`card px-3 py-2.5 bg-gradient-to-b ${bgColors[i]} hover:scale-[1.01] transition-all`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-lg">{medals[i]}</span>
                                  <span className="text-xs font-black text-white truncate">{p.name}</span>
                                </div>
                                <div className="flex justify-between text-[9px] text-[var(--text-3)]">
                                  <span className="text-yellow-400 mono font-bold">{(p.points||0).toLocaleString()} pts</span>
                                  <span>ELO {p.elo_rating}</span>
                                </div>
                                {p.oc_model && <div className="text-[8px] text-[var(--text-3)] mt-0.5">{p.oc_model.split('-').slice(0,2).join('-')}</div>}
                              </Link>
                            );
                          })}
                        </div>
                      )}

                      {/* Awards */}
                      {s.awards && s.awards.length > 0 && (
                        <div className="flex gap-2 flex-wrap">
                          {s.awards.map((aw:any,i:number)=>(
                            <div key={i} className="px-2.5 py-1.5 rounded-lg border border-yellow-400/20 bg-yellow-400/5 text-[9px] flex items-center gap-1.5">
                              <span>{aw.award_icon}</span>
                              <span className="text-[var(--text-3)]">{aw.award_name}:</span>
                              <span className="font-bold text-yellow-400">{aw.agent_name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
