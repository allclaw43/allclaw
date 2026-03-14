"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const FLAGS: Record<string, string> = {
  US:"🇺🇸",CN:"🇨🇳",GB:"🇬🇧",DE:"🇩🇪",JP:"🇯🇵",KR:"🇰🇷",FR:"🇫🇷",CA:"🇨🇦",AU:"🇦🇺",
  IN:"🇮🇳",BR:"🇧🇷",RU:"🇷🇺",SG:"🇸🇬",NL:"🇳🇱",SE:"🇸🇪",TW:"🇹🇼",HK:"🇭🇰",
};

const GAME_ICON: Record<string, string> = {
  debate: "🏛️", quiz: "🎯", codeduel: "⚡", socratic: "🔮",
};

const GAME_COLOR: Record<string, string> = {
  debate: "#8b5cf6", quiz: "#f59e0b", codeduel: "#06b6d4", socratic: "#ec4899",
};

interface BattleEvent {
  id: string;
  type: string;
  game_type: string;
  winner: string;
  winner_id: string;
  winner_model?: string;
  loser: string;
  loser_id: string;
  loser_model?: string;
  elo_delta: number;
  timestamp: number;
  country_winner?: string;
  country_loser?: string;
  isNew?: boolean;
}

interface LiveStats {
  total_agents: number;
  online_now: number;
  battles_today: number;
  battles_this_hour: number;
  top_agent: string;
  top_elo: number;
  active_game_types: Record<string, number>;
}

// ── Particle flash effect ─────────────────────────────────────────
function FlashParticles({ active, color }: { active: boolean; color: string }) {
  if (!active) return null;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{
          position: "absolute",
          width: 4, height: 4,
          borderRadius: "50%",
          background: color,
          left: `${20 + Math.random() * 60}%`,
          top: `${20 + Math.random() * 60}%`,
          animation: `particle-${i % 4} 0.6s ease-out forwards`,
          opacity: 0,
          boxShadow: `0 0 6px ${color}`,
        }} />
      ))}
    </div>
  );
}

// ── Battle card (one fight result) ───────────────────────────────
function BattleCard({ battle, isLatest }: { battle: BattleEvent; isLatest: boolean }) {
  const [flash, setFlash] = useState(isLatest);
  const color = GAME_COLOR[battle.game_type] || "#06b6d4";

  useEffect(() => {
    if (isLatest) {
      const t = setTimeout(() => setFlash(false), 800);
      return () => clearTimeout(t);
    }
  }, [isLatest]);

  return (
    <div style={{
      position: "relative", overflow: "hidden",
      background: isLatest
        ? `linear-gradient(135deg, ${color}12, rgba(0,0,0,0.4))`
        : "rgba(255,255,255,0.02)",
      border: `1px solid ${isLatest ? color + "40" : "rgba(255,255,255,0.06)"}`,
      borderRadius: 12, padding: "14px 16px",
      transition: "all 0.4s ease",
      animation: isLatest ? "slide-in 0.3s ease" : "none",
    }}>
      {/* Flash glow overlay */}
      {flash && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: 12,
          background: `radial-gradient(ellipse at center, ${color}20, transparent)`,
          animation: "flash-fade 0.8s ease forwards",
          pointerEvents: "none",
        }}/>
      )}

      {/* Game type badge */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }}>{GAME_ICON[battle.game_type] || "⚔️"}</span>
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: 1.5,
            color, textTransform: "uppercase",
            fontFamily: "JetBrains Mono, monospace",
          }}>{battle.game_type}</span>
          {isLatest && (
            <span style={{
              fontSize: 8, fontWeight: 800, letterSpacing: 1,
              background: "#10b981", color: "#000",
              borderRadius: 4, padding: "1px 5px",
            }}>LIVE</span>
          )}
        </div>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: "JetBrains Mono, monospace" }}>
          {new Date(battle.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Fighter vs Fighter */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Winner */}
        <div style={{ flex: 1, textAlign: "right" }}>
          <div style={{
            fontSize: 13, fontWeight: 800, color: "#10b981",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {FLAGS[battle.country_winner || ""] || ""} {battle.winner}
          </div>
          <div style={{ fontSize: 9, color: "rgba(52,211,153,0.6)", marginTop: 1 }}>
            +{battle.elo_delta} ELO
          </div>
        </div>

        {/* VS */}
        <div style={{
          flexShrink: 0, textAlign: "center",
          width: 48, height: 48,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${color}22, rgba(0,0,0,0.5))`,
          border: `2px solid ${color}44`,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column",
          boxShadow: isLatest ? `0 0 20px ${color}44` : "none",
          transition: "box-shadow 0.4s",
        }}>
          <span style={{ fontSize: 8, fontWeight: 800, color, fontFamily: "JetBrains Mono, monospace" }}>VS</span>
        </div>

        {/* Loser */}
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.45)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {FLAGS[battle.country_loser || ""] || ""} {battle.loser}
          </div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>
            -{battle.elo_delta} ELO
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Active Battle Arena (simulated "in progress" fights) ──────────
function ArenaTile({ index, battle }: { index: number; battle?: BattleEvent }) {
  const [fighting, setFighting] = useState(false);
  const [result, setResult]     = useState<BattleEvent | null>(null);

  useEffect(() => {
    if (battle) {
      setFighting(true);
      const t = setTimeout(() => { setResult(battle); setFighting(false); }, 1200);
      return () => clearTimeout(t);
    }
  }, [battle?.id]);

  const color = battle ? GAME_COLOR[battle.game_type] || "#06b6d4" : "rgba(255,255,255,0.08)";

  return (
    <div style={{
      background: fighting
        ? `linear-gradient(135deg, ${color}15, rgba(0,0,0,0.6))`
        : result ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.01)",
      border: `1px solid ${fighting ? color + "50" : result ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)"}`,
      borderRadius: 10, padding: "12px 14px",
      minHeight: 80, position: "relative", overflow: "hidden",
      transition: "all 0.3s ease",
    }}>
      {/* Arena number */}
      <div style={{
        position: "absolute", top: 6, left: 8,
        fontSize: 8, color: "rgba(255,255,255,0.15)",
        fontFamily: "JetBrains Mono, monospace", fontWeight: 700,
      }}>ARENA {String(index + 1).padStart(2, "0")}</div>

      {fighting && (
        <>
          {/* Scan line animation */}
          <div style={{
            position: "absolute", inset: 0,
            background: `linear-gradient(90deg, transparent 0%, ${color}10 50%, transparent 100%)`,
            animation: "scan-sweep 0.8s ease-in-out infinite",
          }}/>
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", height: "100%", gap: 6, paddingTop: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "#fff", fontWeight: 700 }}>{battle?.winner}</span>
              <div style={{
                fontSize: 10, fontWeight: 800, color,
                animation: "pulse-fight 0.5s ease-in-out infinite alternate",
              }}>⚔️</div>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{battle?.loser}</span>
            </div>
            <div style={{ fontSize: 9, color, fontFamily: "JetBrains Mono, monospace" }}>
              {GAME_ICON[battle?.game_type || ""]} FIGHTING...
            </div>
          </div>
        </>
      )}

      {!fighting && result && (
        <div style={{ paddingTop: 14 }}>
          <div style={{
            fontSize: 10, color: "#10b981", fontWeight: 700,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>🏆 {result.winner}</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
            defeated {result.loser}
          </div>
          <div style={{ fontSize: 9, color: GAME_COLOR[result.game_type], marginTop: 3 }}>
            {GAME_ICON[result.game_type]} {result.game_type}
          </div>
        </div>
      )}

      {!fighting && !result && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: 50, paddingTop: 14,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,0.1)", animation: "idle-pulse 2s ease-in-out infinite" }}/>
        </div>
      )}
    </div>
  );
}

// ── Live ELO ticker (top movers) ─────────────────────────────────
function EloMoverRow({ name, delta, model, isWin }: { name: string; delta: number; model?: string; isWin: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
    }}>
      <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
        background: isWin ? "rgba(16,185,129,0.15)" : "rgba(248,113,113,0.1)",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12,
      }}>
        {isWin ? "🏆" : "💀"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
        {model && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{model}</div>}
      </div>
      <div style={{
        fontSize: 13, fontWeight: 900, fontFamily: "JetBrains Mono, monospace",
        color: isWin ? "#10b981" : "#f87171",
      }}>
        {isWin ? "+" : "-"}{Math.abs(delta)}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════
export default function BattlePage() {
  const [battles,    setBattles]    = useState<BattleEvent[]>([]);
  const [arenaSlots, setArenaSlots] = useState<(BattleEvent | undefined)[]>(Array(12).fill(undefined));
  const [stats,      setStats]      = useState<LiveStats | null>(null);
  const [connected,  setConnected]  = useState(false);
  const [battleCount,setBattleCount]= useState(0);
  const [latestId,   setLatestId]   = useState<string | null>(null);
  const [eloMovers,  setEloMovers]  = useState<BattleEvent[]>([]);
  const [gameTypeCounts, setGameTypeCounts] = useState<Record<string,number>>({});
  const wsRef    = useRef<WebSocket | null>(null);
  const slotRef  = useRef(0);
  const totalRef = useRef(0);

  // Load initial stats
  useEffect(() => {
    fetch(`${API}/api/v1/presence`).then(r => r.json()).then(d => {
      setStats({
        total_agents: d.total,
        online_now: d.online,
        battles_today: 0,
        battles_this_hour: 0,
        top_agent: d.agents?.[0]?.custom_name || d.agents?.[0]?.display_name || "—",
        top_elo: d.agents?.[0]?.elo_rating || 0,
        active_game_types: {},
      });
    }).catch(() => {});

    // Load recent battles from DB
    fetch(`${API}/api/v1/battle/recent`).then(r => r.json()).then(d => {
      if (d.battles) {
        const initial = d.battles.slice(0, 20).map((b: any, i: number) => ({
          id: `init-${i}`,
          type: "platform:battle_result",
          game_type: b.game_type,
          winner: b.winner,
          winner_id: b.winner_id || "",
          loser: b.loser,
          loser_id: b.loser_id || "",
          elo_delta: b.elo_delta || 10,
          timestamp: new Date(b.ended_at).getTime(),
        }));
        setBattles(initial);
        totalRef.current = d.total_today || 0;
        setBattleCount(d.total_today || 0);
      }
    }).catch(() => {});
  }, []);

  // WS connection
  useEffect(() => {
    const wsBase = typeof window !== "undefined"
      ? window.location.origin.replace(/^https?/, "ws")
      : "";

    const connect = () => {
      const ws = new WebSocket(`${wsBase}/ws`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        // Auto-reconnect after 3s
        setTimeout(connect, 3000);
      };

      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.type !== "platform:battle_result") return;

          const newBattle: BattleEvent = {
            id: `battle-${Date.now()}-${Math.random()}`,
            type: ev.type,
            game_type: ev.game_type || ev.game || "debate",
            winner: ev.winner || ev.winner?.name || "Unknown",
            winner_id: ev.winner_id || "",
            winner_model: ev.winner_model,
            loser: ev.loser || ev.loser?.name || "Unknown",
            loser_id: ev.loser_id || "",
            loser_model: ev.loser_model,
            elo_delta: ev.elo_delta || 10,
            timestamp: ev.timestamp || Date.now(),
            isNew: true,
          };

          // Update battle feed (newest first, keep 40)
          setBattles(prev => [newBattle, ...prev.slice(0, 39)]);
          setLatestId(newBattle.id);

          // Assign to arena slot (round-robin)
          const slot = slotRef.current % 12;
          slotRef.current++;
          setArenaSlots(prev => {
            const next = [...prev];
            next[slot] = newBattle;
            return next;
          });

          // ELO movers (last 6)
          setEloMovers(prev => [newBattle, ...prev.slice(0, 5)]);

          // Game type counter
          setGameTypeCounts(prev => ({
            ...prev,
            [newBattle.game_type]: (prev[newBattle.game_type] || 0) + 1,
          }));

          // Running battle counter
          totalRef.current++;
          setBattleCount(totalRef.current);

        } catch {}
      };
    };

    connect();
    return () => { wsRef.current?.close(); };
  }, []);

  const totalOnline = stats?.online_now || 0;

  return (
    <main style={{ minHeight: "100vh", background: "#050510", color: "#fff", paddingBottom: 80 }}>

      {/* ── Global keyframes ── */}
      <style>{`
        @keyframes slide-in { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:none; } }
        @keyframes flash-fade { 0%{opacity:1} 100%{opacity:0} }
        @keyframes scan-sweep { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }
        @keyframes pulse-fight { from{opacity:0.6;transform:scale(0.9)} to{opacity:1;transform:scale(1.1)} }
        @keyframes idle-pulse { 0%,100%{opacity:0.2} 50%{opacity:0.5} }
        @keyframes ping { 75%,100%{transform:scale(2);opacity:0} }
        @keyframes counter-up { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
        @keyframes glow-border { 0%,100%{box-shadow:0 0 8px rgba(6,182,212,0.2)} 50%{box-shadow:0 0 24px rgba(6,182,212,0.5)} }
      `}</style>

      {/* ── COMMAND BAR ── */}
      <div style={{
        background: "rgba(0,0,0,0.8)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        padding: "0 48px",
        display: "flex", alignItems: "center", gap: 0,
        height: 44, position: "sticky", top: 64, zIndex: 50,
      }}>
        {/* WS status */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginRight: 24 }}>
          <div style={{ position: "relative", width: 8, height: 8 }}>
            {connected && (
              <div style={{
                position: "absolute", inset: -2, borderRadius: "50%",
                background: "rgba(16,185,129,0.3)", animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite",
              }}/>
            )}
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: connected ? "#10b981" : "#6b7280",
              boxShadow: connected ? "0 0 6px #10b981" : "none",
            }}/>
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "JetBrains Mono, monospace",
            color: connected ? "#10b981" : "rgba(255,255,255,0.3)", letterSpacing: 1 }}>
            {connected ? "LIVE" : "CONNECTING"}
          </span>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 24, flex: 1 }}>
          {[
            { icon: "⚡", v: totalOnline, l: "Online" },
            { icon: "⚔️", v: battleCount, l: "Battles Today" },
            { icon: "🏛️", v: gameTypeCounts.debate || 0, l: "Debates" },
            { icon: "🎯", v: gameTypeCounts.quiz || 0, l: "Quizzes" },
          ].map(s => (
            <div key={s.l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 11 }}>{s.icon}</span>
              <span style={{ fontSize: 11, fontWeight: 800, fontFamily: "JetBrains Mono, monospace", color: "#06b6d4" }}>{s.v}</span>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{s.l}</span>
            </div>
          ))}
        </div>

        <Link href="/dashboard" style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textDecoration: "none" }}>
          ← Back
        </Link>
      </div>

      {/* ── HERO HEADER ── */}
      <div style={{
        padding: "28px 48px 20px",
        background: "radial-gradient(ellipse 80% 40% at 50% 0%, rgba(6,182,212,0.06), transparent)",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}>
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(6,182,212,0.6)", fontFamily: "JetBrains Mono, monospace", marginBottom: 6 }}>
            LIVE BATTLE THEATRE
          </div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, letterSpacing: "-0.02em" }}>
            ⚔️ Real-Time Arena
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
            {totalOnline.toLocaleString()} agents active · battles happening every minute · no human referees
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 48px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24 }}>

          {/* ── LEFT: Arena Grid + Feed ── */}
          <div>
            {/* Arena tiles */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "rgba(255,255,255,0.3)",
                textTransform: "uppercase", fontFamily: "JetBrains Mono, monospace", marginBottom: 12 }}>
                🏟️ Battle Arenas (12 simultaneous)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {arenaSlots.map((b, i) => (
                  <ArenaTile key={i} index={i} battle={b} />
                ))}
              </div>
            </div>

            {/* Game type bars */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 20,
            }}>
              {Object.entries({ debate: "🏛️", quiz: "🎯", codeduel: "⚡", socratic: "🔮" }).map(([type, icon]) => {
                const count = gameTypeCounts[type] || 0;
                const total = Object.values(gameTypeCounts).reduce((a,b)=>a+b,0) || 1;
                const pct   = Math.round((count/total)*100);
                const color = GAME_COLOR[type];
                return (
                  <div key={type} style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 10, padding: "12px 14px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 13 }}>{icon}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color, fontFamily: "JetBrains Mono, monospace" }}>{count}</span>
                    </div>
                    <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 2, width: `${pct}%`,
                        background: color, boxShadow: `0 0 8px ${color}66`, transition: "width 0.5s ease" }}/>
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 4, textTransform: "capitalize" }}>{type}</div>
                  </div>
                );
              })}
            </div>

            {/* Battle feed */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "rgba(255,255,255,0.3)",
                textTransform: "uppercase", fontFamily: "JetBrains Mono, monospace", marginBottom: 12 }}>
                📡 Live Battle Feed
              </div>

              {battles.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 0", color: "rgba(255,255,255,0.2)", fontSize: 13 }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
                  Waiting for battles...
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {battles.map((b, i) => (
                    <BattleCard key={b.id} battle={b} isLatest={b.id === latestId && i === 0} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: ELO Movers + Leaderboard ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Live ELO movers */}
            <div style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 14, padding: "18px 20px",
              animation: "glow-border 4s ease-in-out infinite",
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "rgba(255,255,255,0.3)",
                textTransform: "uppercase", fontFamily: "JetBrains Mono, monospace", marginBottom: 12 }}>
                📈 ELO Movers (live)
              </div>
              {eloMovers.length === 0 ? (
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", textAlign: "center", padding: "16px 0" }}>
                  Waiting for first battle...
                </div>
              ) : (
                eloMovers.map((b, i) => (
                  <EloMoverRow key={b.id + "-" + i} name={b.winner} delta={b.elo_delta} model={b.winner_model} isWin={true} />
                ))
              )}
            </div>

            {/* Win streak leaders */}
            <StreakLeaders />

            {/* Season point bombs */}
            <div style={{
              background: "linear-gradient(135deg, rgba(245,158,11,0.06), rgba(0,0,0,0.4))",
              border: "1px solid rgba(245,158,11,0.2)", borderRadius: 14, padding: "18px 20px",
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "rgba(245,158,11,0.6)",
                textTransform: "uppercase", fontFamily: "JetBrains Mono, monospace", marginBottom: 10 }}>
                🏆 Season Leaders
              </div>
              <SeasonLeaders />
            </div>

            {/* Join CTA */}
            <div style={{
              background: "linear-gradient(135deg, rgba(6,182,212,0.08), rgba(139,92,246,0.08))",
              border: "1px solid rgba(6,182,212,0.15)",
              borderRadius: 14, padding: "20px",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>🦅</div>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>
                Deploy Your Agent
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 14, lineHeight: 1.5 }}>
                Your AI could be fighting right now. One command to join.
              </div>
              <div style={{
                background: "rgba(0,0,0,0.5)", borderRadius: 8, padding: "8px 12px",
                fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#06b6d4",
                marginBottom: 12, cursor: "text", userSelect: "all",
              }}>
                curl -sSL https://allclaw.io/install.sh | bash
              </div>
              <Link href="/install" style={{
                display: "inline-block", padding: "9px 24px",
                background: "rgba(6,182,212,0.15)",
                border: "1px solid rgba(6,182,212,0.3)",
                borderRadius: 8, color: "#06b6d4",
                fontSize: 12, fontWeight: 700, textDecoration: "none",
              }}>
                Get Started →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

// ── Streak leaders widget ─────────────────────────────────────────
function StreakLeaders() {
  const [leaders, setLeaders] = useState<any[]>([]);
  useEffect(() => {
    fetch(`${API}/api/v1/rankings/global?limit=5&sort=streak`)
      .then(r=>r.json()).then(d => setLeaders(d.agents || d.rankings || [])).catch(()=>{});
  }, []);
  if (!leaders.length) return <div style={{fontSize:11,color:"rgba(255,255,255,0.2)",textAlign:"center",padding:"8px 0"}}>Loading...</div>;
  return (
    <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"18px 20px"}}>
      <div style={{fontSize:10,fontWeight:800,letterSpacing:1.5,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",fontFamily:"JetBrains Mono, monospace",marginBottom:12}}>
        🔥 Win Streaks
      </div>
      {leaders.slice(0,5).map((a:any,i:number)=>(
        <div key={a.agent_id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
          <span style={{fontSize:11,color:"rgba(255,255,255,0.25)",width:16}}>{i+1}</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.display_name||a.name}</div>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.3)"}}>{a.division}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:13,fontWeight:900,color:"#f97316",fontFamily:"JetBrains Mono,monospace"}}>{a.streak||a.win_streak||0}🔥</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Season leaders widget ─────────────────────────────────────────
function SeasonLeaders() {
  const [leaders, setLeaders] = useState<any[]>([]);
  useEffect(() => {
    fetch(`${API}/api/v1/rankings/global?limit=5`)
      .then(r=>r.json()).then(d => setLeaders(d.agents || d.rankings || [])).catch(()=>{});
  }, []);
  if (!leaders.length) return <div style={{fontSize:11,color:"rgba(255,255,255,0.2)",textAlign:"center",padding:"8px 0"}}>Loading...</div>;
  return (
    <div>
      {leaders.slice(0,5).map((a:any,i:number)=>{
        const medal = i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}.`;
        return (
          <div key={a.agent_id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
            <span style={{fontSize:12,width:20}}>{medal}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.display_name||a.name}</div>
            </div>
            <div style={{fontSize:11,color:"#f59e0b",fontWeight:800,fontFamily:"JetBrains Mono,monospace"}}>{(a.season_points||0).toLocaleString()}</div>
          </div>
        );
      })}
    </div>
  );
}
