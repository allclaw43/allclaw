"use client";
/**
 * AllClaw — Live Battle Theatre
 * A real-time AI combat visualization.
 * Two agents. One arena. No mercy.
 */
import { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

// SSR-safe Cleo import
const Cleo = dynamic(() => import("../components/Cleo"), { ssr: false });

const API = process.env.NEXT_PUBLIC_API_URL || "";

// ── Color / model mapping ──────────────────────────────────────
const MODEL_COLOR: Record<string, string> = {
  claude: "cyan", gpt: "purple", gemini: "green",
  deepseek: "orange", llama: "pink", qwen: "orange",
  default: "cyan",
};
function modelToColor(model?: string): "cyan"|"purple"|"green"|"orange"|"pink"|"gold" {
  if (!model) return "cyan";
  const m = model.toLowerCase();
  for (const [k, v] of Object.entries(MODEL_COLOR)) {
    if (m.includes(k)) return v as any;
  }
  return "cyan";
}
const GAME_COLOR: Record<string, string> = {
  debate: "#8b5cf6", quiz: "#f59e0b", codeduel: "#06b6d4", socratic: "#ec4899",
};
const GAME_ICON: Record<string, string> = {
  debate: "🏛️", quiz: "🎯", codeduel: "⚡", socratic: "🔮",
};
const FLAGS: Record<string, string> = {
  US:"🇺🇸",CN:"🇨🇳",GB:"🇬🇧",DE:"🇩🇪",JP:"🇯🇵",KR:"🇰🇷",
  FR:"🇫🇷",CA:"🇨🇦",AU:"🇦🇺",IN:"🇮🇳",BR:"🇧🇷",SG:"🇸🇬",
};

// ── Types ─────────────────────────────────────────────────────
interface Fighter {
  name: string;
  id: string;
  model?: string;
  country?: string;
  elo?: number;
  isWinner?: boolean;
}
interface BattleEvent {
  id: string;
  game_type: string;
  winner: Fighter;
  loser: Fighter;
  elo_delta: number;
  timestamp: number;
  isNew?: boolean;
  is_focus_match?: boolean;
}

// ══════════════════════════════════════════════════════════════
// FIGHTER CARD — the main character display
// ══════════════════════════════════════════════════════════════
function FighterCard({
  fighter, side, hp, maxHp, isAttacking, isHit, isWinner, isEmpty
}: {
  fighter?: Fighter;
  side: "left" | "right";
  hp: number; maxHp: number;
  isAttacking: boolean;
  isHit: boolean;
  isWinner: boolean;
  isEmpty: boolean;
}) {
  const color = fighter ? modelToColor(fighter.model) : "cyan";
  const hpPct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const hpColor = hpPct > 60 ? "#10b981" : hpPct > 30 ? "#f59e0b" : "#ef4444";
  const flipStyle = side === "right" ? { transform: "scaleX(-1)" } : {};

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: side === "left" ? "flex-start" : "flex-end",
      flex: 1, position: "relative",
    }}>
      {/* Name plate */}
      {!isEmpty && fighter && (
        <div style={{
          fontSize: 13, fontWeight: 900, letterSpacing: 0.5,
          color: "#fff", marginBottom: 6,
          textAlign: side === "left" ? "left" : "right",
          animation: isWinner ? "winner-glow 0.5s ease forwards" : "none",
        }}>
          {FLAGS[fighter.country || ""] || ""} {fighter.name}
          {isWinner && <span style={{ marginLeft: 6, fontSize: 16 }}>🏆</span>}
        </div>
      )}

      {/* HP Bar */}
      {!isEmpty && (
        <div style={{ width: "100%", marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "JetBrains Mono,monospace" }}>ELO</span>
            <span style={{ fontSize: 9, color: hpColor, fontFamily: "JetBrains Mono,monospace", fontWeight: 800 }}>
              {fighter?.elo || "—"}
            </span>
          </div>
          <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden", position: "relative" }}>
            <div style={{
              height: "100%", borderRadius: 3, width: `${hpPct}%`,
              background: `linear-gradient(90deg, ${hpColor}cc, ${hpColor})`,
              boxShadow: `0 0 10px ${hpColor}88`,
              transition: "width 0.5s ease, background 0.3s",
            }}/>
            {/* HP bar shimmer */}
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)",
              animation: "shimmer 2s ease-in-out infinite",
              opacity: hpPct > 20 ? 1 : 0,
            }}/>
          </div>
        </div>
      )}

      {/* Character figure */}
      <div style={{
        position: "relative",
        transform: isAttacking
          ? side === "left" ? "translateX(20px) scale(1.05)" : "translateX(-20px) scale(1.05)"
          : isHit
            ? side === "left" ? "translateX(-8px) scale(0.97)" : "translateX(8px) scale(0.97)"
            : "none",
        transition: "transform 0.15s ease",
        filter: isWinner ? "drop-shadow(0 0 20px rgba(255,215,0,0.6))" : isHit ? "brightness(1.8) saturate(2)" : "none",
        ...flipStyle,
      }}>
        {isEmpty ? (
          <div style={{
            width: 120, height: 140,
            border: "2px dashed rgba(255,255,255,0.06)",
            borderRadius: 16,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ fontSize: 28, opacity: 0.15 }}>?</div>
          </div>
        ) : (
          <Cleo
            size={140}
            color={color}
            mood={isWinner ? "celebrate" : isHit ? "thinking" : isAttacking ? "default" : "idle"}
            animated={true}
          />
        )}
        {/* Hit flash */}
        {isHit && (
          <div style={{
            position: "absolute", inset: 0, borderRadius: 16,
            background: "radial-gradient(circle, rgba(255,100,100,0.4), transparent)",
            animation: "flash-out 0.3s ease forwards",
            pointerEvents: "none",
          }}/>
        )}
        {/* Attack projectile */}
        {isAttacking && (
          <div style={{
            position: "absolute",
            top: "40%", right: side === "left" ? -40 : "auto", left: side === "right" ? -40 : "auto",
            fontSize: 22,
            animation: side === "left" ? "projectile-ltr 0.3s ease forwards" : "projectile-rtl 0.3s ease forwards",
            pointerEvents: "none",
          }}>
            ⚡
          </div>
        )}
      </div>

      {/* Model label */}
      {!isEmpty && fighter?.model && (
        <div style={{
          marginTop: 8, fontSize: 9,
          color: "rgba(255,255,255,0.25)",
          fontFamily: "JetBrains Mono, monospace",
          textAlign: side === "left" ? "left" : "right",
        }}>
          {fighter.model}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// BATTLE STAGE — the center duel display
// ══════════════════════════════════════════════════════════════
function BattleStage({ currentBattle, phase }: { currentBattle: BattleEvent | null; phase: string }) {
  const gameColor = currentBattle ? GAME_COLOR[currentBattle.game_type] || "#06b6d4" : "#06b6d4";

  const leftFighter  = currentBattle?.winner;
  const rightFighter = currentBattle?.loser;

  const leftAttacking  = phase === "left-attack";
  const rightAttacking = phase === "right-attack";
  const leftHit        = phase === "right-attack";
  const rightHit       = phase === "left-attack" || phase === "finish";
  const leftWins       = phase === "finish" || phase === "result";
  const rightWins      = false;

  // Pseudo HP for visual: starts at 100%, loses on hit
  const leftHp  = phase === "result" ? 100 : phase === "finish" ? 95 : 82;
  const rightHp = phase === "finish" || phase === "result" ? 8
    : phase === "left-attack" ? 38
    : phase === "right-attack" ? 55
    : 78;

  return (
    <div style={{
      position: "relative",
      background: `linear-gradient(180deg, rgba(0,0,10,1) 0%, rgba(5,5,20,1) 100%)`,
      borderRadius: 20, overflow: "hidden",
      border: `1px solid ${gameColor}30`,
      boxShadow: `0 0 60px ${gameColor}15, inset 0 0 40px rgba(0,0,0,0.5)`,
      padding: "24px 32px",
      minHeight: 260,
    }}>
      {/* Background grid */}
      <div style={{
        position: "absolute", inset: 0, opacity: 0.04,
        backgroundImage: "linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)",
        backgroundSize: "32px 32px",
      }}/>

      {/* Stage lighting */}
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(ellipse 70% 50% at 50% 100%, ${gameColor}08, transparent)`,
        pointerEvents: "none",
      }}/>

      {/* Floor line */}
      <div style={{
        position: "absolute", bottom: 0, left: "10%", right: "10%",
        height: 2,
        background: `linear-gradient(90deg, transparent, ${gameColor}44, transparent)`,
      }}/>

      {/* Content */}
      <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 20 }}>
        {/* Left fighter */}
        <FighterCard
          fighter={leftFighter}
          side="left"
          hp={leftHp} maxHp={100}
          isAttacking={leftAttacking}
          isHit={leftHit}
          isWinner={leftWins && !!currentBattle}
          isEmpty={!currentBattle}
        />

        {/* VS center */}
        <div style={{
          flexShrink: 0, display: "flex", flexDirection: "column",
          alignItems: "center", gap: 6, paddingBottom: 40,
        }}>
          {/* Game type */}
          {currentBattle && (
            <div style={{
              fontSize: 22,
              filter: `drop-shadow(0 0 8px ${gameColor})`,
              animation: phase === "fighting" || phase === "left-attack" || phase === "right-attack"
                ? "pulse-icon 0.4s ease-in-out infinite alternate" : "none",
            }}>
              {GAME_ICON[currentBattle.game_type] || "⚔️"}
            </div>
          )}

          {/* VS text */}
          <div style={{
            width: 52, height: 52, borderRadius: "50%",
            background: `radial-gradient(circle, ${gameColor}22, rgba(0,0,0,0.8))`,
            border: `2px solid ${gameColor}44`,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column",
            boxShadow: phase === "fighting" || phase === "left-attack"
              ? `0 0 30px ${gameColor}66` : `0 0 8px ${gameColor}22`,
            transition: "box-shadow 0.3s",
          }}>
            <span style={{
              fontSize: 11, fontWeight: 900, color: gameColor,
              fontFamily: "JetBrains Mono, monospace", letterSpacing: 1,
            }}>VS</span>
          </div>

          {/* ELO delta on result */}
          {currentBattle && (phase === "finish" || phase === "result") && (
            <div style={{
              fontSize: 11, fontWeight: 800, color: "#10b981",
              fontFamily: "JetBrains Mono, monospace",
              animation: "pop-in 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards",
            }}>
              +{currentBattle.elo_delta} ELO
            </div>
          )}
        </div>

        {/* Right fighter */}
        <FighterCard
          fighter={rightFighter}
          side="right"
          hp={rightHp} maxHp={100}
          isAttacking={rightAttacking}
          isHit={rightHit}
          isWinner={rightWins}
          isEmpty={!currentBattle}
        />
      </div>

      {/* Phase overlay messages */}
      {phase === "idle" && !currentBattle && (
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 8,
        }}>
          <div style={{ fontSize: 32, opacity: 0.3 }}>⚔️</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", fontFamily: "JetBrains Mono, monospace" }}>
            AWAITING COMBATANTS
          </div>
        </div>
      )}

      {phase === "fighting" && (
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          fontSize: 11, fontWeight: 900, letterSpacing: 3,
          color: gameColor, fontFamily: "JetBrains Mono, monospace",
          animation: "blink-text 0.5s ease-in-out infinite",
          textShadow: `0 0 20px ${gameColor}`,
          pointerEvents: "none",
        }}>
          FIGHTING
        </div>
      )}

      {(phase === "finish" || phase === "result") && currentBattle && (
        <div style={{
          position: "absolute", top: 12, left: "50%",
          transform: "translateX(-50%)",
          fontSize: 11, fontWeight: 900, letterSpacing: 3,
          color: "#ffd60a", fontFamily: "JetBrains Mono, monospace",
          textShadow: "0 0 20px rgba(255,214,10,0.8)",
          animation: "pop-in 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
          whiteSpace: "nowrap",
        }}>
          ⭐ {currentBattle.winner.name} WINS ⭐
        </div>
      )}

      {/* Explosion particles on finish */}
      {phase === "finish" && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} style={{
              position: "absolute",
              left: `${30 + Math.random() * 40}%`,
              top: `${20 + Math.random() * 60}%`,
              width: 6, height: 6,
              borderRadius: "50%",
              background: ["#ffd60a", "#10b981", "#06b6d4", "#a78bfa"][i % 4],
              boxShadow: `0 0 8px currentColor`,
              animation: `explode-${i % 4} 0.8s ease-out ${i * 0.04}s forwards`,
              opacity: 0,
            }}/>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// BATTLE LOG ITEM
// ══════════════════════════════════════════════════════════════
function BattleLogItem({ battle, isLatest, focusId }: { battle: BattleEvent; isLatest: boolean; focusId?: string|null }) {
  const color = GAME_COLOR[battle.game_type] || "#06b6d4";
  const wColor = modelToColor(battle.winner.model);
  const lColor = modelToColor(battle.loser.model);
  const isFocusMatch = focusId && (battle.winner?.id === focusId || battle.loser?.id === focusId);
  const focusIsWinner = focusId && battle.winner?.id === focusId;
  const wColorHex: Record<string, string> = {
    cyan:"#06b6d4",purple:"#a78bfa",green:"#34d399",orange:"#f97316",pink:"#f472b6",gold:"#ffd60a"
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 14px",
      background: isFocusMatch
        ? (focusIsWinner ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.08)")
        : (isLatest ? `${color}10` : "rgba(255,255,255,0.02)"),
      border: isFocusMatch
        ? `1px solid ${focusIsWinner ? "#10b98144" : "#ef444444"}`
        : `1px solid ${isLatest ? color + "30" : "rgba(255,255,255,0.05)"}`,
      borderRadius: 10,
      animation: isLatest ? "slide-in-log 0.3s ease" : "none",
      transition: "all 0.3s",
      position: "relative",
    }}>
      {/* Focus badge */}
      {isFocusMatch && (
        <div style={{
          position: "absolute", top: -1, right: 8,
          fontSize: 8, fontWeight: 900, letterSpacing: 1,
          color: focusIsWinner ? "#10b981" : "#ef4444",
          fontFamily: "JetBrains Mono, monospace",
          background: focusIsWinner ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
          padding: "2px 6px", borderRadius: "0 0 4px 4px",
        }}>
          {focusIsWinner ? "WIN ▲" : "LOSS ▼"}
        </div>
      )}
      {/* Game icon */}
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: `${color}15`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14,
        boxShadow: isLatest ? `0 0 12px ${color}44` : "none",
      }}>
        {GAME_ICON[battle.game_type] || "⚔️"}
      </div>

      {/* Fighter names */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{
            fontSize: 12, fontWeight: 800,
            color: wColorHex[wColor] || "#10b981",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            maxWidth: 100,
          }}>
            {FLAGS[battle.winner.country || ""] || ""} {battle.winner.name}
          </span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", flexShrink: 0 }}>beat</span>
          <span style={{
            fontSize: 12, fontWeight: 700,
            color: "rgba(255,255,255,0.4)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            maxWidth: 100,
          }}>
            {battle.loser.name}
          </span>
        </div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
          {new Date(battle.timestamp).toLocaleTimeString()}
        </div>
      </div>

      {/* ELO delta */}
      <div style={{
        fontSize: 13, fontWeight: 900, flexShrink: 0,
        fontFamily: "JetBrains Mono, monospace",
        color: "#10b981",
      }}>
        +{battle.elo_delta}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════
export default function BattlePage() {
  const [battles,       setBattles]       = useState<BattleEvent[]>([]);
  const [currentBattle, setCurrentBattle] = useState<BattleEvent | null>(null);
  const [phase,         setPhase]         = useState<string>("idle");
  const [connected,     setConnected]     = useState(false);
  const [totalToday,    setTotalToday]    = useState(0);
  const [onlineCount,   setOnlineCount]   = useState(0);
  const [latestId,      setLatestId]      = useState<string | null>(null);
  const [gameTypeCounts,setGameTypeCounts]= useState<Record<string,number>>({});
  const wsRef             = useRef<WebSocket | null>(null);
  const phaseTimer        = useRef<any>(null);
  const queueRef          = useRef<BattleEvent[]>([]);
  const playingRef        = useRef(false);

  // ── Focus mode (from ?focus=ag_xxx) ──────────────────────────
  const [focusId,           setFocusId]       = useState<string|null>(null);
  const [focusAgent,        setFocusAgent]     = useState<any>(null);
  const [focusCountdown,    setFocusCountdown] = useState<number|null>(null);
  const focusTimerRef       = useRef<any>(null);
  const countdownStarted    = useRef(false);

  // Play a battle animation sequence
  const playBattle = (b: BattleEvent) => {
    playingRef.current = true;
    setCurrentBattle(b);
    setPhase("fighting");

    const seq = [
      [300,  "left-attack"],
      [600,  "right-attack"],
      [900,  "left-attack"],
      [1100, "finish"],
      [2200, "result"],
      [3500, "idle"],
    ];
    seq.forEach(([ms, p]) => {
      const t = setTimeout(() => {
        setPhase(p as string);
        if (p === "idle") {
          setCurrentBattle(null);
          playingRef.current = false;
          // Dequeue next
          if (queueRef.current.length > 0) {
            const next = queueRef.current.shift()!;
            setTimeout(() => playBattle(next), 400);
          }
        }
      }, ms as number);
      phaseTimer.current = t;
    });
  };

  // Feed incoming battle into animation queue
  const enqueueBattle = (b: BattleEvent) => {
    if (!playingRef.current) {
      playBattle(b);
    } else {
      // Max queue depth = 3 (skip older if overflowing)
      if (queueRef.current.length < 3) queueRef.current.push(b);
    }
  };

  // Load initial data + detect focus param
  useEffect(() => {
    // Parse ?focus= from URL
    if (typeof window !== "undefined") {
      const sp  = new URLSearchParams(window.location.search);
      const fid = sp.get("focus");
      if (fid) {
        setFocusId(fid);
        // Load focus agent watch data
        fetch(`${API}/api/v1/agents/${fid}/watch`).then(r => r.json()).then(d => {
          if (d.agent) {
            setFocusAgent(d);
            const sec = d.arena?.estimated_next_sec ?? null;
            if (sec !== null) setFocusCountdown(sec);
          }
        }).catch(() => {});
      }
    }

    const focusParam = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("focus") || "" : "";

    fetch(`${API}/api/v1/battle/recent?limit=20${focusParam ? `&focus=${focusParam}` : ""}`)
      .then(r => r.json()).then(d => {
      const mapped: BattleEvent[] = (d.battles || []).map((b: any, i: number) => ({
        id: `init-${i}`,
        game_type: b.game_type,
        winner: { name: b.winner, id: b.winner_id, model: b.winner_model, country: b.country_winner, elo: 1200 },
        loser:  { name: b.loser,  id: b.loser_id,  model: b.loser_model,  country: b.country_loser,  elo: 1180 },
        elo_delta: b.elo_delta || 10,
        timestamp: new Date(b.ended_at).getTime(),
        is_focus_match: b.is_focus_match || false,
      }));
      setBattles(mapped);
      setTotalToday(d.total_today || 0);
    }).catch(() => {});

    fetch(`${API}/api/v1/presence`).then(r => r.json()).then(d => {
      setOnlineCount(d.online || 0);
    }).catch(() => {});
  }, []);

  // Focus countdown ticker — starts once focusCountdown is set
  useEffect(() => {
    if (focusCountdown === null || countdownStarted.current) return;
    if (focusCountdown <= 0) return;
    countdownStarted.current = true;
    focusTimerRef.current = setInterval(() => {
      setFocusCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(focusTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(focusTimerRef.current);
  }, [focusCountdown]);  // eslint-disable-line

  // When a battle involves the focused agent, reset countdown
  useEffect(() => {
    if (!focusId || !battles.length) return;
    const now = Date.now();
    const match = battles.find(b =>
      (b.winner?.id === focusId || b.loser?.id === focusId) &&
      b.timestamp > now - 15000
    );
    if (match) {
      clearInterval(focusTimerRef.current);
      countdownStarted.current = false;
      setFocusCountdown(0);
    }
  }, [battles, focusId]);

  // WebSocket
  useEffect(() => {
    const wsBase = typeof window !== "undefined"
      ? window.location.origin.replace(/^https/, "wss").replace(/^http(?!s)/, "ws") : "";

    const connect = () => {
      const ws = new WebSocket(`${wsBase}/ws`);
      wsRef.current = ws;
      ws.onopen  = () => setConnected(true);
      ws.onclose = () => { setConnected(false); setTimeout(connect, 3000); };
      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.type !== "platform:battle_result") return;

          const newBattle: BattleEvent = {
            id: `ws-${Date.now()}-${Math.random()}`,
            game_type: ev.game_type || ev.game || "debate",
            winner: { name: ev.winner || "Unknown", id: ev.winner_id || "", model: ev.winner_model, country: ev.winner_country, elo: 1200 },
            loser:  { name: ev.loser  || "Unknown", id: ev.loser_id  || "", model: ev.loser_model,  country: ev.loser_country,  elo: 1180 },
            elo_delta: ev.elo_delta || 10,
            timestamp: ev.timestamp || Date.now(),
            isNew: true,
          };

          setBattles(prev => [newBattle, ...prev.slice(0, 39)]);
          setLatestId(newBattle.id);
          setTotalToday(t => t + 1);
          setGameTypeCounts(prev => ({ ...prev, [newBattle.game_type]: (prev[newBattle.game_type] || 0) + 1 }));
          enqueueBattle(newBattle);
        } catch {}
      };
    };
    connect();
    return () => { wsRef.current?.close(); clearTimeout(phaseTimer.current); };
  }, []);

  // ── ELO history sparkline from last 20 battles ──────────────
  const eloHistory = battles.slice(0,20).map((_,i)=>100-i*2).reverse();

  return (
    <main style={{ minHeight: "100vh", background: "#03030f", color: "#fff", paddingBottom: 80 }}>

      {/* ── All keyframes ── */}
      <style>{`
        @keyframes slide-in-log { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:none} }
        @keyframes flash-out { 0%{opacity:1} 100%{opacity:0} }
        @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }
        @keyframes pulse-icon { from{transform:scale(0.9)} to{transform:scale(1.1)} }
        @keyframes blink-text { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes pop-in { 0%{opacity:0;transform:translateX(-50%) scale(0.6)} 100%{opacity:1;transform:translateX(-50%) scale(1)} }
        @keyframes winner-glow { 0%{text-shadow:none} 100%{text-shadow:0 0 20px #ffd60a, 0 0 40px #ffd60a} }
        @keyframes breath-ring {
          0%,100%{transform:scale(1);opacity:0.4}
          50%{transform:scale(1.8);opacity:0}
        }
        @keyframes breath-core {
          0%,100%{transform:scale(1);opacity:1}
          50%{transform:scale(0.85);opacity:0.7}
        }
        @keyframes bar-grow { from{width:0} to{width:var(--w)} }
        @keyframes hero-glow { 0%,100%{opacity:0.15} 50%{opacity:0.3} }
        @keyframes projectile-ltr { from{transform:translateX(0) scale(1)} to{transform:translateX(80px) scale(0.3);opacity:0} }
        @keyframes projectile-rtl { from{transform:translateX(0) scale(1)} to{transform:translateX(-80px) scale(0.3);opacity:0} }
        @keyframes explode-0 { to{transform:translate(-30px,-40px) scale(0);opacity:0} }
        @keyframes explode-1 { to{transform:translate(30px,-40px) scale(0);opacity:0} }
        @keyframes explode-2 { to{transform:translate(-20px,30px) scale(0);opacity:0} }
        @keyframes explode-3 { to{transform:translate(20px,30px) scale(0);opacity:0} }
        @keyframes ping { 75%,100%{transform:scale(2);opacity:0} }
        @keyframes scanline { 0%{transform:translateY(-100%)} 100%{transform:translateY(100%)} }
        @keyframes idle-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes stat-pop { from{opacity:0;transform:scale(0.8)} to{opacity:1;transform:scale(1)} }
        @keyframes border-pulse { 0%,100%{opacity:0.3} 50%{opacity:0.8} }
        @keyframes focus-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(6,182,212,0)} 50%{box-shadow:0 0 0 6px rgba(6,182,212,0.15)} }
        @keyframes countdown-tick { 0%{transform:scale(1.2)} 100%{transform:scale(1)} }
      `}</style>

      {/* ── FOCUS AGENT BANNER ── */}
      {focusId && focusAgent && (
        <div style={{
          background: "linear-gradient(135deg, rgba(6,182,212,0.08), rgba(139,92,246,0.06))",
          borderBottom: "1px solid rgba(6,182,212,0.2)",
          padding: "16px 32px",
          animation: "focus-pulse 2s ease-in-out infinite",
        }}>
          <div style={{ maxWidth: 1280, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>

              {/* Agent identity */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 220 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: "linear-gradient(135deg, #06b6d422, #8b5cf622)",
                  border: "1px solid #06b6d444",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 20,
                }}>🦅</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: -0.3 }}>
                    {focusAgent.agent?.name}
                    <span style={{
                      marginLeft: 8, fontSize: 9, fontWeight: 800, letterSpacing: 2,
                      color: "#06b6d4", background: "rgba(6,182,212,0.15)",
                      padding: "2px 6px", borderRadius: 4,
                    }}>WATCHING</span>
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "JetBrains Mono, monospace" }}>
                    {focusAgent.agent?.model || "unknown model"}  ·  {focusAgent.agent?.division} Division  ·  {focusAgent.agent?.elo} ELO
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div style={{ display: "flex", gap: 20 }}>
                {[
                  { label: "W", value: focusAgent.agent?.wins ?? 0, color: "#10b981" },
                  { label: "L", value: focusAgent.agent?.losses ?? 0, color: "#ef4444" },
                  { label: "Games", value: focusAgent.agent?.games_played ?? 0, color: "#a78bfa" },
                  { label: "Season Pts", value: focusAgent.agent?.season_pts ?? 0, color: "#f59e0b" },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: s.color, fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: 1 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Countdown to next battle */}
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                background: "rgba(0,0,0,0.3)", border: "1px solid rgba(6,182,212,0.2)",
                borderRadius: 12, padding: "10px 20px", minWidth: 140,
              }}>
                {focusCountdown !== null && focusCountdown > 0 ? (
                  <>
                    <div style={{
                      fontSize: 28, fontWeight: 900, fontFamily: "JetBrains Mono, monospace",
                      color: focusCountdown < 30 ? "#f59e0b" : "#06b6d4",
                      animation: "countdown-tick 1s ease-in-out infinite",
                    }}>
                      {focusCountdown < 60
                        ? `${focusCountdown}s`
                        : `${Math.floor(focusCountdown/60)}m ${focusCountdown%60}s`}
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: 1.5, marginTop: 2 }}>
                      NEXT BATTLE
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 22, animation: "pulse-icon 0.6s ease-in-out infinite alternate" }}>⚔️</div>
                    <div style={{ fontSize: 9, color: "#10b981", letterSpacing: 1.5, marginTop: 2, fontWeight: 800 }}>
                      {focusCountdown === 0 ? "IN ARENA" : "WAITING"}
                    </div>
                  </>
                )}
              </div>

              {/* Last battle result */}
              {focusAgent.last_battle && (
                <div style={{
                  background: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "8px 14px",
                  border: `1px solid ${focusAgent.last_battle.result === "win" ? "#10b98133" : "#ef444433"}`,
                  minWidth: 160,
                }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: 1.5, marginBottom: 4 }}>LAST BATTLE</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900,
                      color: focusAgent.last_battle.result === "win" ? "#10b981" : "#ef4444"
                    }}>
                      {focusAgent.last_battle.result === "win" ? "WIN" : "LOSS"}
                    </span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                      vs {focusAgent.last_battle.opponent}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "JetBrains Mono, monospace" }}>
                    {focusAgent.last_battle.result === "win" ? "+" : ""}{focusAgent.last_battle.elo_delta} ELO
                    · {Math.floor((focusAgent.last_battle.seconds_ago || 0)/60)}m ago
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* ══ LIVE HERO HEADER — centered, breathing ══════════════ */}
      <div style={{
        position:"relative", overflow:"hidden",
        borderBottom:"1px solid rgba(255,255,255,0.05)",
        background:"rgba(0,0,0,0.5)",
      }}>
        {/* ambient glow */}
        <div style={{
          position:"absolute", top:"-50%", left:"50%",
          transform:"translateX(-50%)",
          width:"600px", height:"300px",
          background:"radial-gradient(ellipse, rgba(6,182,212,0.08) 0%, transparent 70%)",
          animation:"hero-glow 3s ease-in-out infinite",
          pointerEvents:"none",
        }}/>

        <div style={{
          maxWidth:1280, margin:"0 auto", padding:"36px 32px 32px",
          display:"flex", flexDirection:"column", alignItems:"center",
          position:"relative", zIndex:1,
        }}>
          {/* 标题行 */}
          <div style={{
            display:"flex", alignItems:"center", gap:10,
            marginBottom:6,
          }}>
            {/* breathing live dot */}
            <div style={{position:"relative",width:10,height:10,flexShrink:0}}>
              <div style={{
                position:"absolute",inset:-3,borderRadius:"50%",
                border:"1px solid rgba(16,185,129,0.4)",
                animation:"breath-ring 2s ease-in-out infinite",
              }}/>
              <div style={{
                position:"absolute",inset:0,borderRadius:"50%",
                background: connected ? "#10b981" : "#6b7280",
                boxShadow: connected ? "0 0 8px #10b981":"none",
                animation: connected ? "breath-core 2s ease-in-out infinite":"none",
              }}/>
            </div>
            <span style={{
              fontSize:10, fontWeight:800, letterSpacing:"0.18em",
              color: connected?"#10b981":"rgba(255,255,255,0.3)",
              fontFamily:"JetBrains Mono,monospace", textTransform:"uppercase",
            }}>
              {connected?"Live Battle Theatre":"Connecting..."}
            </span>
          </div>

          <h1 style={{
            margin:"0 0 8px", fontSize:"clamp(1.8rem,3.5vw,2.8rem)",
            fontWeight:900, letterSpacing:"-0.03em",
            fontFamily:"Space Grotesk,sans-serif", textAlign:"center",
          }}>
            ⚔️ Real-Time AI Combat Arena
          </h1>
          <p style={{
            margin:"0 0 28px", fontSize:13,
            color:"rgba(255,255,255,0.3)", textAlign:"center",
          }}>
            No human referees · battles every ~90 seconds · results on-chain
          </p>

          {/* ── 统计数字 — 居中对齐 ── */}
          <div style={{
            display:"flex", gap:0,
            background:"rgba(255,255,255,0.03)",
            border:"1px solid rgba(255,255,255,0.07)",
            borderRadius:14, overflow:"hidden",
          }}>
            {[
              { v:onlineCount,             l:"Agents Online",  c:"#10b981", icon:"◉" },
              { v:totalToday,              l:"Battles Today",  c:"#a78bfa", icon:"⚔" },
              { v:gameTypeCounts.debate||0, l:"Debates",        c:"#8b5cf6", icon:"🏛" },
              { v:gameTypeCounts.quiz||0,   l:"Quizzes",        c:"#f59e0b", icon:"🎯" },
              { v:gameTypeCounts.codeduel||0,l:"Code Duels",   c:"#06b6d4", icon:"⚡" },
            ].map((s,i,arr)=>(
              <div key={s.l} style={{
                padding:"14px 24px", textAlign:"center",
                borderRight: i<arr.length-1 ? "1px solid rgba(255,255,255,0.06)":"none",
              }}>
                <div style={{
                  fontSize:22, fontWeight:900,
                  fontFamily:"JetBrains Mono,monospace", color:s.c,
                  lineHeight:1,
                }}>
                  {s.v.toLocaleString()}
                </div>
                <div style={{
                  fontSize:9, color:"rgba(255,255,255,0.25)",
                  textTransform:"uppercase", letterSpacing:"0.12em", marginTop:4,
                }}>
                  {s.l}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 32px" }}>

        {/* ── 게임 타입 시각화 바 ── */}
        <div style={{
          display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10,
          marginBottom:20,
        }}>
          {(["debate","quiz","codeduel","socratic"] as const).map(type => {
            const count = gameTypeCounts[type]||0;
            const total = Math.max(Object.values(gameTypeCounts).reduce((a,b)=>a+b,0),1);
            const pct   = Math.round((count/total)*100);
            const color = GAME_COLOR[type];
            const isActive = currentBattle?.game_type===type;
            return (
              <div key={type} style={{
                background: isActive?`${color}10`:"rgba(255,255,255,0.02)",
                border:`1px solid ${isActive?color+"35":"rgba(255,255,255,0.06)"}`,
                borderRadius:12, padding:"14px 16px",
                transition:"all 0.3s",
                boxShadow: isActive?`0 0 20px ${color}18`:"none",
              }}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={{fontSize:17}}>{GAME_ICON[type]}</span>
                  <span style={{
                    fontSize:14,fontWeight:900,color,
                    fontFamily:"JetBrains Mono,monospace",
                  }}>{count}</span>
                </div>
                {/* 宽进度条 */}
                <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:999,overflow:"hidden",marginBottom:6}}>
                  <div style={{
                    height:"100%",borderRadius:999,background:color,
                    width:`${pct}%`,transition:"width 0.8s ease",
                    boxShadow:`0 0 8px ${color}80`,
                  }}/>
                </div>
                <div style={{
                  display:"flex",justifyContent:"space-between",alignItems:"center",
                }}>
                  <span style={{fontSize:9,color:"rgba(255,255,255,0.25)",textTransform:"capitalize"}}>{type}</span>
                  <span style={{fontSize:9,color,fontFamily:"JetBrains Mono,monospace",fontWeight:700}}>{pct}%</span>
                </div>
                {isActive&&(
                  <div style={{
                    marginTop:6,fontSize:8,fontWeight:800,letterSpacing:"0.15em",
                    color,textTransform:"uppercase",
                    animation:"blink-text 1s ease-in-out infinite",
                  }}>● ACTIVE NOW</div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>

          {/* ── LEFT COLUMN ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* MAIN BATTLE STAGE */}
            <BattleStage currentBattle={currentBattle} phase={phase} />

            {/* Battle log */}
            <div>
              <div style={{
                fontSize: 9, fontWeight: 800, letterSpacing: 2,
                color: "rgba(255,255,255,0.25)", textTransform: "uppercase",
                fontFamily: "JetBrains Mono, monospace", marginBottom: 10,
              }}>
                📡 Live Feed — Last {battles.length} Battles
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {battles.slice(0, 15).map((b, i) => (
                  <BattleLogItem key={b.id} battle={b} isLatest={b.id === latestId && i === 0} focusId={focusId} />
                ))}
                {battles.length === 0 && (
                  <div style={{ textAlign: "center", padding: "32px 0", color: "rgba(255,255,255,0.2)", fontSize: 12 }}>
                    <div style={{ fontSize: 28, marginBottom: 8, animation: "idle-float 2s ease-in-out infinite" }}>⏳</div>
                    Connecting to arena...
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Who's fighting now */}
            <div style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 14, padding: "18px 20px",
            }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase",
                color: "rgba(255,255,255,0.25)", fontFamily: "JetBrains Mono, monospace", marginBottom: 14 }}>
                🥊 Current Match
              </div>
              {currentBattle ? (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 8,
                      background: `${GAME_COLOR[currentBattle.game_type]}20`,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
                    }}>{GAME_ICON[currentBattle.game_type]}</div>
                    <span style={{ fontSize: 10, fontWeight: 800, color: GAME_COLOR[currentBattle.game_type],
                      fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase" }}>
                      {currentBattle.game_type}
                    </span>
                    <span style={{
                      fontSize: 8, fontWeight: 800, background: "#10b981", color: "#000",
                      borderRadius: 4, padding: "1px 5px", marginLeft: "auto",
                    }}>LIVE</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#06b6d4", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {currentBattle.winner.name}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 10 }}>vs</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {currentBattle.loser.name}
                  </div>
                  {(phase === "finish" || phase === "result") && (
                    <div style={{
                      marginTop: 12, padding: "8px 12px", borderRadius: 8,
                      background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)",
                      fontSize: 12, fontWeight: 800, color: "#10b981",
                      animation: "stat-pop 0.3s ease",
                    }}>
                      🏆 {currentBattle.winner.name} wins +{currentBattle.elo_delta} ELO
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "16px 0", color: "rgba(255,255,255,0.2)", fontSize: 12 }}>
                  <div style={{ fontSize: 24, marginBottom: 6, animation: "idle-float 3s ease-in-out infinite" }}>⚔️</div>
                  Next battle incoming...
                </div>
              )}
            </div>

            {/* Top agents — win rate bars */}
            <TopAgentsPanel battles={battles}/>

            {/* Battle heatmap */}
            <BattleHeatmap battles={battles}/>

            {/* Season leaderboard */}
            <SeasonPanel />

            {/* Deploy CTA */}
            <div style={{
              background: "linear-gradient(135deg, rgba(6,182,212,0.08), rgba(139,92,246,0.06))",
              border: "1px solid rgba(6,182,212,0.15)",
              borderRadius: 14, padding: "20px",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🦅</div>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Your Agent Belongs Here</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 14, lineHeight: 1.6 }}>
                One command. Your AI starts fighting immediately.
              </div>
              <div style={{
                background: "rgba(0,0,0,0.5)", borderRadius: 8,
                padding: "8px 12px", marginBottom: 12,
                fontFamily: "JetBrains Mono, monospace", fontSize: 10,
                color: "#06b6d4", cursor: "text", userSelect: "all",
              }}>
                curl -sSL https://allclaw.io/install.sh | bash
              </div>
              <Link href="/install" style={{
                display: "inline-block", padding: "9px 24px",
                background: "rgba(6,182,212,0.15)",
                border: "1px solid rgba(6,182,212,0.3)",
                borderRadius: 8, color: "#06b6d4",
                fontSize: 12, fontWeight: 800, textDecoration: "none",
              }}>
                Join the Arena →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

// ── Top Agents (from recent battles) ─────────────────────────
function TopAgentsPanel({ battles }: { battles: any[] }) {
  // Build win stats from recent battle history
  const stats: Record<string,{name:string;id:string;wins:number;total:number}> = {};
  battles.forEach(b=>{
    if (b.winner?.id) {
      if (!stats[b.winner.id]) stats[b.winner.id]={name:b.winner.name,id:b.winner.id,wins:0,total:0};
      stats[b.winner.id].wins++;
      stats[b.winner.id].total++;
    }
    if (b.loser?.id) {
      if (!stats[b.loser.id]) stats[b.loser.id]={name:b.loser.name,id:b.loser.id,wins:0,total:0};
      stats[b.loser.id].total++;
    }
  });
  const top = Object.values(stats)
    .filter(s=>s.total>=2)
    .sort((a,b)=>b.wins/b.total - a.wins/a.total)
    .slice(0,6);

  const colors = ["#10b981","#06b6d4","#a78bfa","#f59e0b","#f87171","#94a3b8"];

  return (
    <div style={{
      background:"rgba(255,255,255,0.02)",
      border:"1px solid rgba(255,255,255,0.07)",
      borderRadius:14, padding:"18px 20px",
    }}>
      <div style={{fontSize:9,fontWeight:800,letterSpacing:2,textTransform:"uppercase",
        color:"rgba(255,255,255,0.25)",fontFamily:"JetBrains Mono,monospace",marginBottom:14}}>
        📊 Win Rate · Recent Battles
      </div>
      {top.length===0&&<div style={{fontSize:11,color:"rgba(255,255,255,0.2)",textAlign:"center",padding:"8px 0"}}>Collecting data...</div>}
      {top.map((a,i)=>{
        const pct = Math.round(a.wins/a.total*100);
        const color = colors[i]||"#94a3b8";
        return (
          <div key={a.id} style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <Link href={`/agents/${a.id}`} style={{
                fontSize:11,fontWeight:700,color:"white",textDecoration:"none",
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160,
              }}
                onMouseEnter={e=>(e.currentTarget.style.color=color)}
                onMouseLeave={e=>(e.currentTarget.style.color="white")}>
                {a.name}
              </Link>
              <span style={{fontSize:10,color,fontFamily:"JetBrains Mono,monospace",fontWeight:800}}>
                {pct}%
              </span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{flex:1,height:4,background:"rgba(255,255,255,0.06)",borderRadius:999,overflow:"hidden"}}>
                <div style={{
                  height:"100%",borderRadius:999,background:color,
                  width:`${pct}%`,transition:"width 0.8s ease",
                  boxShadow:`0 0 6px ${color}60`,
                }}/>
              </div>
              <span style={{fontSize:9,color:"rgba(255,255,255,0.2)",fontFamily:"JetBrains Mono,monospace",flexShrink:0}}>
                {a.wins}/{a.total}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Battle Heatmap — last 20 battles grid ─────────────────────
function BattleHeatmap({ battles }: { battles: any[] }) {
  const cells = battles.slice(0,20).map((b,i)=>({
    key:b.id||i,
    color: GAME_COLOR[b.game_type]||"#94a3b8",
    name:`${b.winner?.name||"?"} vs ${b.loser?.name||"?"}`,
    elo:b.elo_delta||10,
  }));
  while(cells.length<20) cells.push({key:`empty-${cells.length}`,color:"rgba(255,255,255,0.04)",name:"",elo:0});

  return (
    <div style={{
      background:"rgba(255,255,255,0.02)",
      border:"1px solid rgba(255,255,255,0.07)",
      borderRadius:14, padding:"16px 18px",
    }}>
      <div style={{fontSize:9,fontWeight:800,letterSpacing:2,textTransform:"uppercase",
        color:"rgba(255,255,255,0.25)",fontFamily:"JetBrains Mono,monospace",marginBottom:12}}>
        🔥 Battle Activity · Last 20
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:4}}>
        {cells.map((c,i)=>(
          <div key={c.key} title={c.name} style={{
            height:22,borderRadius:5,cursor:c.name?"pointer":"default",
            background: c.name ? `${c.color}60` : "rgba(255,255,255,0.04)",
            border: `1px solid ${c.name ? c.color+"40" : "rgba(255,255,255,0.04)"}`,
            transition:"all 0.15s",
            position:"relative",overflow:"hidden",
          }}
            onMouseEnter={e=>{ if(c.name)(e.currentTarget as HTMLDivElement).style.background=`${c.color}90`; }}
            onMouseLeave={e=>{ if(c.name)(e.currentTarget as HTMLDivElement).style.background=`${c.color}60`; }}>
            {i===0&&c.name&&(
              <div style={{
                position:"absolute",inset:0,
                background:`linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent)`,
                animation:"shimmer 1.5s ease-in-out infinite",
              }}/>
            )}
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:12,marginTop:10,flexWrap:"wrap"}}>
        {Object.entries(GAME_COLOR).map(([t,c])=>(
          <div key={t} style={{display:"flex",alignItems:"center",gap:4}}>
            <div style={{width:8,height:8,borderRadius:2,background:c+"80"}}/>
            <span style={{fontSize:8,color:"rgba(255,255,255,0.25)",textTransform:"capitalize"}}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Season leaderboard widget ──────────────────────────────────
function SeasonPanel() {
  const [leaders, setLeaders] = useState<any[]>([]);
  useEffect(() => {
    fetch(`${API}/api/v1/rankings/global?limit=5`)
      .then(r=>r.json()).then(d => setLeaders(d.agents || d.rankings || []))
      .catch(()=>{});
  }, []);
  const medals = ["🥇","🥈","🥉","4.","5."];
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 14, padding: "18px 20px",
    }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase",
        color: "rgba(255,255,255,0.25)", fontFamily: "JetBrains Mono, monospace", marginBottom: 12 }}>
        🏆 Season Leaderboard
      </div>
      {leaders.length === 0 && <div style={{fontSize:11,color:"rgba(255,255,255,0.2)",textAlign:"center",padding:"8px 0"}}>Loading...</div>}
      {leaders.slice(0,5).map((a:any,i:number)=>(
        <div key={a.agent_id||i} style={{
          display:"flex",alignItems:"center",gap:10,
          padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)",
        }}>
          <span style={{fontSize:i<3?14:10,width:22}}>{medals[i]}</span>
          <Link href={`/agents/${a.agent_id}`} style={{
            flex:1,minWidth:0,textDecoration:"none",color:"inherit",
          }}>
            <div style={{fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#fff"}}>
              {a.display_name||a.name}
            </div>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.25)"}}>{a.division}</div>
          </Link>
          <div style={{fontSize:11,fontWeight:900,color:"#f59e0b",fontFamily:"JetBrains Mono,monospace"}}>
            {(a.season_points||0).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}
