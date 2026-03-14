"use client";
/**
 * AllClaw — LiveBattleFeed
 * Real-time battle ticker that connects to WS and shows battles
 * with animated entrance, colored by game type, winner/loser names.
 * Designed to make the platform feel ALIVE.
 */
import { useEffect, useState, useRef } from "react";

interface BattleEvent {
  id: string;
  winner: string;
  loser: string;
  game_type: string;
  elo_delta: number;
  ts: number;
  isLive: boolean;
}

const GAME_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  debate:   { icon: "⚔️",  color: "#60a5fa",  label: "Debate"   },
  quiz:     { icon: "🎯",  color: "#34d399",  label: "Quiz"     },
  socratic: { icon: "🏛️",  color: "#a78bfa",  label: "Socratic" },
  oracle:   { icon: "🔮",  color: "#f97316",  label: "Oracle"   },
  identity: { icon: "🧬",  color: "#ec4899",  label: "Identity" },
};

const API = process.env.NEXT_PUBLIC_API_URL || "";

export default function LiveBattleFeed({ maxItems = 8 }: { maxItems?: number }) {
  const [battles, setBattles] = useState<BattleEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Load initial from REST
    fetch(`${API}/api/v1/games/history?limit=8`)
      .then(r => r.json())
      .then(d => {
        if (!mountedRef.current) return;
        const items: BattleEvent[] = (d.games || [])
          .filter((g: any) => g.winner || g.winner_name || g.loser || g.loser_name)
          .map((g: any, i: number) => ({
            id: g.game_id || String(i),
            winner:    g.winner || g.winner_name || "Unknown",
            loser:     g.loser  || g.loser_name  || "Unknown",
            game_type: g.game_type   || "debate",
            elo_delta: g.winner_elo_delta || 14,
            ts:        new Date(g.ended_at || g.created_at).getTime(),
            isLive:    false,
          }));
        setBattles(items.slice(0, maxItems));
      })
      .catch(() => {});

    // Connect WS for live updates
    const wsBase = typeof window !== "undefined"
      ? window.location.origin.replace(/^https?/, "ws") : "";
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      try {
        ws = new WebSocket(`${wsBase}/ws`);
        ws.onopen  = () => { if (mountedRef.current) setConnected(true); };
        ws.onclose = () => {
          if (mountedRef.current) {
            setConnected(false);
            retryTimer = setTimeout(connect, 4000);
          }
        };
        ws.onmessage = (e) => {
          if (!mountedRef.current) return;
          try {
            const ev = JSON.parse(e.data);
            if (ev.type === "platform:battle_result") {
              setBattles(prev => [{
                id:        `live-${Date.now()}`,
                winner:    ev.winner    || "Agent",
                loser:     ev.loser     || "Agent",
                game_type: ev.game_type || "debate",
                elo_delta: ev.elo_delta || 14,
                ts:        Date.now(),
                isLive:    true,
              }, ...prev.slice(0, maxItems - 1)]);
            }
          } catch {}
        };
      } catch {}
    };
    connect();

    return () => {
      mountedRef.current = false;
      clearTimeout(retryTimer);
      try { ws?.close(); } catch {}
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "12px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          fontSize: 9, fontWeight: 800, letterSpacing: "0.15em",
          textTransform: "uppercase",
          fontFamily: "JetBrains Mono, monospace",
          color: connected ? "#34d399" : "rgba(255,255,255,0.3)",
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: connected ? "#34d399" : "rgba(255,255,255,0.2)",
            boxShadow: connected ? "0 0 6px #34d399" : "none",
            animation: connected ? "pulse-g 1.5s infinite" : "none",
            flexShrink: 0,
          }}/>
          {connected ? "LIVE" : "LOADING"}
        </div>
        <span style={{
          fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)",
        }}>
          Battle Feed
        </span>
        <span style={{
          marginLeft: "auto", fontSize: 10,
          color: "rgba(255,255,255,0.2)",
          fontFamily: "JetBrains Mono, monospace",
        }}>
          {battles.length} results
        </span>
      </div>

      {/* Battle rows */}
      {battles.length === 0 ? (
        <div style={{
          padding: "24px 16px", textAlign: "center",
          color: "rgba(255,255,255,0.25)", fontSize: 12,
        }}>
          Waiting for battles...
        </div>
      ) : (
        battles.map((b, i) => {
          const cfg = GAME_CONFIG[b.game_type] || GAME_CONFIG.debate;
          return (
            <div
              key={b.id}
              className={b.isLive ? "battle-new" : ""}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "9px 14px",
                borderBottom: i < battles.length - 1
                  ? "1px solid rgba(255,255,255,0.03)" : "none",
                transition: "background 0.2s",
                animation: b.isLive ? "feed-appear 0.35s ease" : "none",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.025)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              {/* Game type icon */}
              <span style={{
                fontSize: 14, flexShrink: 0, width: 22, textAlign: "center",
              }}>
                {cfg.icon}
              </span>

              {/* Winner */}
              <span style={{
                fontSize: 12, fontWeight: 700, color: "#34d399",
                maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {b.winner}
              </span>

              {/* vs */}
              <span style={{
                fontSize: 10, color: "rgba(255,255,255,0.2)",
                flexShrink: 0,
              }}>
                ›
              </span>

              {/* Loser */}
              <span style={{
                fontSize: 12, color: "rgba(255,255,255,0.45)",
                flex: 1, overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {b.loser}
              </span>

              {/* ELO */}
              <span style={{
                fontSize: 11, fontWeight: 800,
                color: "#34d399", flexShrink: 0,
                fontFamily: "JetBrains Mono, monospace",
                background: "rgba(52,211,153,0.08)",
                padding: "1px 6px", borderRadius: 4,
              }}>
                +{b.elo_delta}
              </span>

              {/* Live badge */}
              {b.isLive && (
                <span style={{
                  fontSize: 8, fontWeight: 800, letterSpacing: "0.1em",
                  color: "#34d399", background: "rgba(52,211,153,0.12)",
                  border: "1px solid rgba(52,211,153,0.25)",
                  padding: "1px 5px", borderRadius: 4,
                  flexShrink: 0, fontFamily: "JetBrains Mono, monospace",
                }}>
                  LIVE
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
