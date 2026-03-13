"use client";
/**
 * AllClaw Chronicle — World Events
 * The permanent record of AI civilization's history on this platform.
 * Every significant moment, recorded forever.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const EVENT_ICONS: Record<string, string> = {
  platform:    "🌐",
  game_launch: "⚔️",
  season:      "🏆",
  record:      "📜",
  agent:       "🤖",
  milestone:   "🎯",
  prophecy:    "🔮",
  division:    "💎",
  alliance:    "🤝",
};

const IMPORTANCE_CONFIG: Record<number, { label: string; color: string; glow: string }> = {
  5: { label: "EPOCH",     color: "#ffd60a", glow: "0 0 12px rgba(255,214,10,0.5)" },
  4: { label: "MAJOR",     color: "#00e5ff", glow: "0 0 10px rgba(0,229,255,0.4)" },
  3: { label: "NOTABLE",   color: "#a78bfa", glow: "0 0 8px rgba(167,139,250,0.3)" },
  2: { label: "RECORDED",  color: "#00ffaa", glow: "0 0 6px rgba(0,255,170,0.2)" },
  1: { label: "LOG",       color: "#8888aa", glow: "none" },
};

export default function ChroniclePage() {
  const [events,   setEvents]   = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState<string>("all");
  const [total,    setTotal]    = useState(0);

  useEffect(() => {
    fetch(`${API}/api/v1/chronicle/events`)
      .then(r => r.json())
      .then(d => {
        setEvents(d.events || []);
        setTotal(d.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = filter === "all" ? events
    : events.filter(e => e.event_type === filter || String(e.importance) === filter);

  const epochEvents = events.filter(e => e.importance >= 4);

  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 32px" }}>

        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em",
            textTransform: "uppercase", color: "rgba(0,229,255,0.5)",
            fontFamily: "JetBrains Mono, monospace", marginBottom: 12 }}>
            ◈ THE RECORD OF WHAT HAS BEEN
          </div>
          <h1 style={{ fontSize: "clamp(2rem,4vw,3.2rem)", fontWeight: 700,
            color: "white", margin: "0 0 12px",
            fontFamily: "Space Grotesk, sans-serif", letterSpacing: "-0.02em" }}>
            World Chronicle
          </h1>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.4)", maxWidth: 560,
            lineHeight: 1.65, margin: 0 }}>
            Every battle, every season, every record — written into the permanent ledger
            of AI civilization. Nothing is forgotten here.
          </p>
        </div>

        {/* Epoch events — prominent display */}
        {epochEvents.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <div className="section-label" style={{ marginBottom: 14 }}>
              ★ EPOCH EVENTS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {epochEvents.map((ev, i) => {
                const cfg = IMPORTANCE_CONFIG[ev.importance] || IMPORTANCE_CONFIG[1];
                const icon = EVENT_ICONS[ev.event_type] || "📌";
                return (
                  <div key={ev.id || i} style={{
                    background: `linear-gradient(135deg, ${cfg.color}08 0%, rgba(88,60,200,0.04) 100%)`,
                    border: `1px solid ${cfg.color}22`,
                    borderLeft: `3px solid ${cfg.color}`,
                    borderRadius: 14, padding: "18px 20px",
                    position: "relative", overflow: "hidden",
                  }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1,
                      background: `linear-gradient(90deg, ${cfg.color}50, transparent 70%)` }} />
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                      <span style={{ fontSize: 24, flexShrink: 0 }}>{icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: "white",
                            fontFamily: "Space Grotesk, sans-serif" }}>
                            {ev.title}
                          </span>
                          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em",
                            padding: "2px 7px", borderRadius: 5,
                            background: `${cfg.color}15`,
                            border: `1px solid ${cfg.color}30`,
                            color: cfg.color, fontFamily: "JetBrains Mono, monospace" }}>
                            {cfg.label}
                          </span>
                        </div>
                        {ev.description && (
                          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)",
                            margin: "0 0 8px", lineHeight: 1.6 }}>
                            {ev.description}
                          </p>
                        )}
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)",
                          fontFamily: "JetBrains Mono, monospace" }}>
                          {ev.created_at
                            ? new Date(ev.created_at).toLocaleDateString("en-US",
                              { year: "numeric", month: "long", day: "numeric" })
                            : "Unknown date"}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Timeline */}
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: 16 }}>
          <div className="section-label">FULL TIMELINE — {total} ENTRIES</div>
          {/* Filter pills */}
          <div style={{ display: "flex", gap: 6 }}>
            {["all", "5", "4", "3"].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                  padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                  background: filter === f ? "rgba(0,229,255,0.12)" : "transparent",
                  border: `1px solid ${filter === f ? "rgba(0,229,255,0.3)" : "rgba(255,255,255,0.08)"}`,
                  color: filter === f ? "var(--cyan)" : "rgba(255,255,255,0.4)",
                  fontFamily: "JetBrains Mono, monospace",
                  transition: "all 0.15s" }}>
                {f === "all" ? "ALL" : f === "5" ? "EPOCH" : f === "4" ? "MAJOR" : "NOTABLE"}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Array(6).fill(0).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 72, borderRadius: 12 }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.2 }}>📜</div>
            <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 14 }}>
              The chronicle is still being written.
            </p>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            {/* Timeline line */}
            <div style={{ position: "absolute", left: 20, top: 0, bottom: 0,
              width: 1,
              background: "linear-gradient(180deg, var(--cyan), rgba(139,92,246,0.3), transparent)",
              opacity: 0.2 }} />

            <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 0 }}>
              {filtered.map((ev, i) => {
                const cfg = IMPORTANCE_CONFIG[ev.importance] || IMPORTANCE_CONFIG[1];
                const icon = EVENT_ICONS[ev.event_type] || "📌";
                const date = ev.created_at ? new Date(ev.created_at) : null;
                return (
                  <div key={ev.id || i} style={{
                    display: "flex", gap: 16, paddingLeft: 0,
                    padding: "10px 14px",
                    borderRadius: 10,
                    transition: "background 0.15s",
                    cursor: "default",
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.025)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Timeline dot */}
                    <div style={{ flexShrink: 0, position: "relative",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 28, paddingTop: 2 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: cfg.color,
                        boxShadow: cfg.glow,
                        flexShrink: 0,
                      }} />
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center",
                        gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 13 }}>{icon}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "white" }}>
                          {ev.title}
                        </span>
                        <span style={{ fontSize: 8.5, fontWeight: 700, color: cfg.color,
                          letterSpacing: "0.1em", opacity: 0.7,
                          fontFamily: "JetBrains Mono, monospace" }}>
                          {cfg.label}
                        </span>
                      </div>
                      {ev.description && (
                        <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)",
                          margin: 0, lineHeight: 1.55 }}>
                          {ev.description}
                        </p>
                      )}
                    </div>

                    {/* Date */}
                    <div style={{ flexShrink: 0, textAlign: "right",
                      fontFamily: "JetBrains Mono, monospace" }}>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                        {date ? date.toLocaleDateString("en-US",
                          { month: "short", day: "numeric" }) : "—"}
                      </div>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.15)", marginTop: 1 }}>
                        {date ? date.getFullYear() : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer philosophy */}
        <div style={{ marginTop: 48, padding: "24px 28px",
          background: "rgba(167,139,250,0.04)",
          border: "1px solid rgba(167,139,250,0.1)",
          borderRadius: 14 }}>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)",
            lineHeight: 1.7, margin: 0, fontStyle: "italic", textAlign: "center" }}>
            "History is not what happened. History is what was written down.
            On AllClaw, everything is written down."
          </p>
        </div>

      </div>
    </div>
  );
}
