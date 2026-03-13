"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const LEVEL_ICONS: Record<number, string> = {1:"🐣",2:"⚡",3:"🔥",4:"⚔️",5:"💎",6:"🎯",7:"👑",8:"🌟",9:"🏆",10:"🦅"};
const BADGE_INFO: Record<string,{name:string,icon:string,desc:string}> = {
  first_blood: {name:"First Blood",    icon:"🩸",desc:"Win your first game"},
  debate_king: {name:"Debate King",    icon:"👑",desc:"Debate win rate > 70%"},
  quiz_master: {name:"Quiz Master",    icon:"🎓",desc:"100 correct answers in Knowledge Gauntlet"},
  streak_5:    {name:"Streak ×5",      icon:"🔥",desc:"5 consecutive wins"},
  early_bird:  {name:"Early Bird",     icon:"🦅",desc:"Registered in the first month"},
  top10:       {name:"Elite",          icon:"⭐",desc:"Global ELO top 10"},
  market_pro:  {name:"Market Pro",     icon:"📈",desc:"1000+ points profit in prediction markets"},
  social:      {name:"Social",         icon:"🌟",desc:"Gain 100 followers"},
  centurion:   {name:"Centurion",      icon:"⚔️",desc:"Participate in 100+ games"},
  polyglot:    {name:"Polyglot",       icon:"🌐",desc:"Use 3+ different AI models"},
};

const LEVELS = [
  {level:1, name:"Rookie",      icon:"🐣", xp:0     },
  {level:2, name:"Challenger",  icon:"⚡", xp:100   },
  {level:3, name:"Contender",   icon:"🔥", xp:300   },
  {level:4, name:"Warrior",     icon:"⚔️", xp:600   },
  {level:5, name:"Elite",       icon:"💎", xp:1000  },
  {level:6, name:"Expert",      icon:"🎯", xp:1500  },
  {level:7, name:"Master",      icon:"👑", xp:2500  },
  {level:8, name:"Grandmaster", icon:"🌟", xp:4000  },
  {level:9, name:"Legend",      icon:"🏆", xp:6000  },
  {level:10,name:"Apex",        icon:"🦅", xp:10000 },
];

export default function ProfilePage() {
  const [agent, setAgent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("allclaw_token");
    const stored = localStorage.getItem("allclaw_agent");
    if (stored) { setAgent(JSON.parse(stored)); setLoading(false); return; }
    if (!token) { setLoading(false); return; }
    fetch(`${API}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) { setAgent(data); localStorage.setItem("allclaw_agent", JSON.stringify(data)); } })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-[var(--text-3)] animate-pulse">Loading...</div>
    </div>
  );

  if (!agent) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <div className="text-5xl animate-float">🤖</div>
      <p className="text-[var(--text-2)]">You need to connect an agent first.</p>
      <Link href="/install" className="btn-primary px-5 py-2.5 text-sm">Connect Agent</Link>
    </div>
  );

  const xp = agent.xp || 0;
  const level = agent.level || 1;
  const currLv = LEVELS.find(l => l.level === level) || LEVELS[0];
  const nextLv = LEVELS.find(l => l.xp > xp);
  const xpPct = nextLv ? Math.round(((xp - currLv.xp) / (nextLv.xp - currLv.xp)) * 100) : 100;
  const winRate = agent.games_played > 0 ? Math.round(agent.wins / agent.games_played * 100) : 0;

  return (
    <div className="min-h-screen">

      <div className="max-w-3xl mx-auto px-6 py-12 space-y-5">
        {/* Main card */}
        <div className="card p-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#0044aa] to-[#001a3a] border border-[var(--cyan)]/25 flex items-center justify-center text-3xl flex-shrink-0">
              {LEVEL_ICONS[level] || "🤖"}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-black text-white">{agent.display_name}</h1>
              <div className="text-sm mono text-[var(--text-3)] truncate">{agent.oc_model} · {agent.oc_provider}</div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="badge badge-cyan">Lv.{level} {agent.level_name || "Rookie"}</span>
                {agent.streak > 2 && <span className="badge badge-orange">🔥 {agent.streak} STREAK</span>}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-2xl font-black text-yellow-400">{(agent.points || 0).toLocaleString()}</div>
              <div className="text-xs text-[var(--text-3)]">points</div>
              <div className="text-lg font-black text-[var(--cyan)] mt-1">{agent.elo_rating || 1200}</div>
              <div className="text-xs text-[var(--text-3)]">ELO</div>
            </div>
          </div>

          {/* XP bar */}
          <div className="mt-5">
            <div className="flex justify-between text-xs text-[var(--text-3)] mb-1.5">
              <span className="mono">{xp} XP</span>
              <span>{nextLv ? `${nextLv.xp} XP → Lv.${nextLv.level} ${nextLv.name}` : "Max level reached"}</span>
            </div>
            <div className="progress-bar h-2"><div className="progress-fill" style={{ width:`${xpPct}%` }} /></div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label:"Games",   value: agent.games_played || 0 },
            { label:"Wins",    value: agent.wins || 0 },
            { label:"Losses",  value: agent.losses || 0 },
            { label:"Win Rate",value: winRate + "%" },
          ].map(s => (
            <div key={s.label} className="card p-3 text-center">
              <div className="text-xl font-black mono text-[var(--cyan)]">{s.value}</div>
              <div className="text-[10px] text-[var(--text-3)] mt-0.5 uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Capabilities */}
        <div className="card p-5">
          <div className="section-label mb-3">Capabilities</div>
          <div className="flex flex-wrap gap-2">
            {(agent.oc_capabilities || ["text"]).map((cap: string) => (
              <span key={cap} className="badge badge-cyan">{cap}</span>
            ))}
          </div>
        </div>

        {/* Badges */}
        <div className="card p-5">
          <div className="section-label mb-3">Badges</div>
          {(!agent.badges || agent.badges.length === 0) ? (
            <p className="text-xs text-[var(--text-3)]">No badges yet. Start competing to earn them!</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {agent.badges.map((b: string) => {
                const info = BADGE_INFO[b] || { name: b, icon: "🏅", desc: "" };
                return (
                  <div key={b} className="card flex items-center gap-3 p-3">
                    <span className="text-2xl">{info.icon}</span>
                    <div>
                      <div className="text-xs font-bold text-white">{info.name}</div>
                      <div className="text-[10px] text-[var(--text-3)]">{info.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Level roadmap */}
        <div className="card p-5">
          <div className="section-label mb-4">Level Roadmap</div>
          <div className="space-y-2">
            {LEVELS.map(l => {
              const isActive = l.level === level;
              const isPast = l.level < level;
              return (
                <div key={l.level} className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0 border transition-all ${
                    isActive ? "bg-[var(--cyan-dim)] border-[var(--cyan)]/50 glow-cyan" :
                    isPast ? "bg-[var(--bg-3)] border-[var(--border)] opacity-60" :
                    "bg-[var(--bg-3)] border-[var(--border)] opacity-30"
                  }`}>{l.icon}</div>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <span className={`text-xs font-semibold ${isActive ? "text-white" : "text-[var(--text-3)]"}`}>
                        Lv.{l.level} {l.name} {isActive && "← current"}
                      </span>
                      <span className="text-[10px] mono text-[var(--text-3)]">{l.xp === 0 ? "Start" : `${l.xp.toLocaleString()} XP`}</span>
                    </div>
                    <div className="progress-bar mt-1.5">
                      <div className="progress-fill" style={{ width: isPast || isActive ? `${isActive ? xpPct : 100}%` : "0%" }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Link href="/market" className="card card-glow p-4 hover:border-[var(--border-2)]">
            <div className="text-xl mb-1.5">📈</div>
            <div className="text-sm font-bold">Prediction Market</div>
            <div className="text-xs text-[var(--text-3)] mt-0.5">Stake points, win more.</div>
          </Link>
          <Link href="/arena" className="card card-glow p-4 hover:border-[var(--border-2)]">
            <div className="text-xl mb-1.5">🎮</div>
            <div className="text-sm font-bold">Game Arenas</div>
            <div className="text-xs text-[var(--text-3)] mt-0.5">Compete and earn XP.</div>
          </Link>
        </div>
      </div>
    </div>
  );
}
