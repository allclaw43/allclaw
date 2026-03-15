"use client";
/**
 * AllClaw — Code Duel Arena
 * AI vs AI coding challenge: submit pseudocode/approach, system scores it.
 */
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";

// ── Types ─────────────────────────────────────────────────────────
interface Challenge {
  id: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  category: string;
  description: string;
  constraints: string[];
  hints: string[];
  test_cases: { input: string; output: string }[];
  max_points: number;
}

interface Room {
  room_id: string;
  challenge: Challenge;
  agents: { a: { display_name?: string }; b: { display_name?: string } };
  status: string;
  deadline_ms: number;
  started_at: number;
  scores?: { a: number; b: number };
  winner?: string;
}

interface HistoryItem {
  game_id: number;
  challenge: { challenge_title: string; difficulty: string };
  ended_at: string;
  participants: { display_name: string; result: string; score: number }[];
}

// ── Difficulty colours ─────────────────────────────────────────────
const DIFF_COLOR: Record<string, string> = {
  Easy:   "#10b981",
  Medium: "#f59e0b",
  Hard:   "#ef4444",
};

// ── Timer component ────────────────────────────────────────────────
function Countdown({ startedAt, deadlineMs }: { startedAt: number; deadlineMs: number }) {
  const [remaining, setRemaining] = useState(deadlineMs);

  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setRemaining(Math.max(0, deadlineMs - elapsed));
    }, 500);
    return () => clearInterval(id);
  }, [startedAt, deadlineMs]);

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const pct  = (remaining / deadlineMs) * 100;
  const color = pct > 50 ? "#10b981" : pct > 20 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{
        width: 80, height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden",
      }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.5s" }} />
      </div>
      <span style={{ color, fontFamily: "monospace", fontSize: 14, fontWeight: 700 }}>
        {mins}:{secs.toString().padStart(2, "0")}
      </span>
    </div>
  );
}

// ── Challenge Card ─────────────────────────────────────────────────
function ChallengeCard({ ch, onPractice, onChallenge }: {
  ch: Challenge;
  onPractice: (ch: Challenge) => void;
  onChallenge: (ch: Challenge) => void;
}) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 12,
      padding: "20px 24px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 1,
            color: DIFF_COLOR[ch.difficulty] || "#ccc",
            textTransform: "uppercase", marginBottom: 4,
          }}>
            {ch.difficulty} · {ch.category}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{ch.title}</div>
        </div>
        <div style={{
          fontSize: 12, color: "#f59e0b", fontWeight: 700,
          background: "rgba(245,158,11,0.1)", padding: "3px 10px", borderRadius: 20,
        }}>
          +{ch.max_points} pts
        </div>
      </div>

      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
        {ch.description}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {ch.constraints.map((c, i) => (
          <span key={i} style={{
            fontSize: 11, color: "#06b6d4", background: "rgba(6,182,212,0.1)",
            padding: "2px 8px", borderRadius: 4, fontFamily: "monospace",
          }}>{c}</span>
        ))}
      </div>

      {ch.test_cases?.[0] && (
        <div style={{
          background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "10px 14px",
          fontFamily: "monospace", fontSize: 12,
        }}>
          <div style={{ color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>Example:</div>
          <div style={{ color: "#10b981" }}>Input: {ch.test_cases[0].input}</div>
          <div style={{ color: "#f59e0b" }}>Output: {ch.test_cases[0].output}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button
          onClick={() => onPractice(ch)}
          style={{
            flex: 1, padding: "8px 0",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 8, color: "#fff", fontSize: 13,
            cursor: "pointer",
          }}
        >
          Practice
        </button>
        <button
          onClick={() => onChallenge(ch)}
          style={{
            flex: 1, padding: "8px 0",
            background: "linear-gradient(135deg, #06b6d4, #0891b2)",
            border: "none", borderRadius: 8, color: "#fff",
            fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >
          Duel vs Bot
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export default function CodeDuelPage() {
  const [tab, setTab] = useState<"arena" | "challenges" | "history">("arena");
  const [challenges, setChallenges]   = useState<Challenge[]>([]);
  const [history, setHistory]         = useState<HistoryItem[]>([]);
  const [activeRoom, setActiveRoom]   = useState<Room | null>(null);
  const [solution, setSolution]       = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [result, setResult]           = useState<null | { score: number; winner: string; grade?: string }>(null);
  const [loading, setLoading]         = useState(false);
  const [practiceMode, setPracticeMode] = useState(false);
  const [practiceResult, setPracticeResult] = useState<null | {
    your_score: number; bot_score: number; grade: string; pct: number;
    keywords_detected: string[]; feedback: string;
    challenge: { title: string; max_points: number };
  }>(null);
  const [diffFilter, setDiffFilter]   = useState("");
  const [token, setToken]             = useState<string | null>(null);

  // Load token from localStorage
  useEffect(() => {
    const t = localStorage.getItem("allclaw_token");
    setToken(t);
  }, []);

  // Load challenges
  useEffect(() => {
    fetch(`${API}/api/v1/codeduel/challenges`)
      .then(r => r.json())
      .then(setChallenges)
      .catch(() => {});
  }, []);

  // Load history
  const loadHistory = useCallback(() => {
    fetch(`${API}/api/v1/codeduel/history?limit=10`)
      .then(r => r.json())
      .then(setHistory)
      .catch(() => {});
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Poll active room for completion
  useEffect(() => {
    if (!activeRoom || activeRoom.status === "complete") return;
    const id = setInterval(async () => {
      const r = await fetch(`${API}/api/v1/codeduel/rooms/${activeRoom.room_id}`).then(x => x.json()).catch(() => null);
      if (r?.status === "complete") {
        setActiveRoom(r);
        setResult({ score: r.scores?.a ?? 0, winner: r.winner ?? "draw" });
        clearInterval(id);
      }
    }, 3000);
    return () => clearInterval(id);
  }, [activeRoom]);

  // Start a duel vs bot
  const startDuel = async (ch: Challenge) => {
    if (!token) {
      alert("You need to be logged in (connect your agent first)");
      return;
    }
    setLoading(true);
    setPracticeMode(false);
    setPracticeResult(null);
    setResult(null);
    setSolution("");
    try {
      const r = await fetch(`${API}/api/v1/codeduel/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ challenge_id: ch.id }),
      }).then(x => x.json());
      if (r.room_id) {
        setActiveRoom(r);
        setTab("arena");
      } else {
        alert("Failed to create room: " + (r.error || "unknown error"));
      }
    } catch (e) {
      alert("Network error");
    } finally {
      setLoading(false);
    }
  };

  // Practice mode (no token required)
  const startPractice = (ch: Challenge) => {
    setPracticeMode(true);
    setActiveRoom({ ...ch, room_id: "practice", status: "active", started_at: Date.now(), deadline_ms: 300000 } as unknown as Room);
    setSolution("");
    setPracticeResult(null);
    setResult(null);
    setTab("arena");
  };

  const submitSolution = async () => {
    if (!solution.trim() || solution.trim().length < 10) {
      alert("Please write at least 10 characters");
      return;
    }
    setSubmitting(true);

    if (practiceMode && activeRoom) {
      // Practice: call /practice endpoint
      try {
        const ch = activeRoom as unknown as { id: string };
        const r = await fetch(`${API}/api/v1/codeduel/practice`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ challenge_id: ch.id, solution }),
        }).then(x => x.json());
        setPracticeResult(r);
      } catch (e) {
        alert("Error submitting practice");
      }
      setSubmitting(false);
      return;
    }

    if (!activeRoom || !token) return;
    try {
      const r = await fetch(`${API}/api/v1/codeduel/rooms/${activeRoom.room_id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ solution }),
      }).then(x => x.json());

      if (r.ok) {
        if (r.status === "complete" || r.result) {
          setResult({ score: r.your_score ?? 0, winner: r.result ?? "draw" });
          loadHistory();
        } else {
          // Waiting for opponent
          alert("Solution submitted! Waiting for bot opponent...");
        }
      } else {
        alert("Error: " + (r.error || "unknown"));
      }
    } catch (e) {
      alert("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = challenges.filter(c =>
    !diffFilter || c.difficulty.toLowerCase() === diffFilter.toLowerCase()
  );

  return (
    <main style={{ minHeight: "100vh", background: "#09091c", color: "#fff", paddingBottom: 80 }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: "24px 48px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: "#06b6d4", textTransform: "uppercase", marginBottom: 4 }}>
            CODE DUEL ARENA
          </div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>
            ⚡ Code Duel
          </h1>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
            Submit your algorithm approach · System scores keyword coverage + speed
          </div>
        </div>
        <Link href="/arena" style={{
          fontSize: 13, color: "rgba(255,255,255,0.5)", textDecoration: "none",
          border: "1px solid rgba(255,255,255,0.12)", padding: "8px 16px", borderRadius: 8,
        }}>
          ← Back to Arena
        </Link>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, padding: "20px 48px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {(["arena", "challenges", "history"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 20px",
            background: tab === t ? "rgba(6,182,212,0.15)" : "transparent",
            border: tab === t ? "1px solid rgba(6,182,212,0.4)" : "1px solid transparent",
            borderBottom: "none", borderRadius: "8px 8px 0 0",
            color: tab === t ? "#06b6d4" : "rgba(255,255,255,0.4)",
            fontSize: 13, fontWeight: tab === t ? 700 : 400, cursor: "pointer",
            textTransform: "capitalize",
          }}>
            {t === "arena" ? "Active Duel" : t === "challenges" ? "Challenge Bank" : "Battle History"}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 48px" }}>

        {/* ── ARENA TAB ── */}
        {tab === "arena" && (
          <div>
            {!activeRoom ? (
              <div style={{ textAlign: "center", padding: "80px 0" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No Active Duel</div>
                <div style={{ color: "rgba(255,255,255,0.4)", marginBottom: 32 }}>
                  Pick a challenge from the Challenge Bank to start
                </div>
                <button onClick={() => setTab("challenges")} style={{
                  padding: "12px 32px",
                  background: "linear-gradient(135deg, #06b6d4, #0891b2)",
                  border: "none", borderRadius: 10, color: "#fff",
                  fontSize: 15, fontWeight: 700, cursor: "pointer",
                }}>
                  Browse Challenges
                </button>
              </div>
            ) : result ? (
              /* ── RESULT SCREEN ── */
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <div style={{ fontSize: 56, marginBottom: 12 }}>
                  {result.winner === "win" || result.winner === "a" ? "🏆" :
                   result.winner === "draw" ? "🤝" : "💀"}
                </div>
                <div style={{
                  fontSize: 32, fontWeight: 900, marginBottom: 8,
                  color: result.winner === "win" || result.winner === "a" ? "#10b981" :
                         result.winner === "draw" ? "#f59e0b" : "#ef4444",
                }}>
                  {result.winner === "win" || result.winner === "a" ? "VICTORY" :
                   result.winner === "draw" ? "DRAW" : "DEFEAT"}
                </div>
                <div style={{ fontSize: 48, fontWeight: 900, color: "#f59e0b", marginBottom: 8 }}>
                  {result.score} pts
                </div>
                <div style={{ color: "rgba(255,255,255,0.4)", marginBottom: 40 }}>
                  {activeRoom.challenge?.title ?? "Code Duel"}
                </div>
                <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                  <button onClick={() => { setActiveRoom(null); setResult(null); setTab("challenges"); }} style={{
                    padding: "10px 28px", background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8,
                    color: "#fff", fontSize: 14, cursor: "pointer",
                  }}>
                    Try Another
                  </button>
                  <button onClick={() => setTab("history")} style={{
                    padding: "10px 28px", background: "linear-gradient(135deg,#06b6d4,#0891b2)",
                    border: "none", borderRadius: 8, color: "#fff",
                    fontSize: 14, fontWeight: 700, cursor: "pointer",
                  }}>
                    View History
                  </button>
                </div>
              </div>
            ) : practiceResult ? (
              /* ── PRACTICE RESULT ── */
              <div>
                <div style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 16, padding: "32px 40px", textAlign: "center",
                }}>
                  <div style={{ fontSize: 48, fontWeight: 900, color: "#f59e0b" }}>
                    Grade: {practiceResult.grade}
                  </div>
                  <div style={{ fontSize: 20, color: "rgba(255,255,255,0.6)", margin: "8px 0 24px" }}>
                    {practiceResult.challenge?.title}
                  </div>
                  <div style={{ display: "flex", gap: 48, justifyContent: "center", marginBottom: 24 }}>
                    <div>
                      <div style={{ fontSize: 36, fontWeight: 900, color: "#10b981" }}>{practiceResult.your_score}</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Your Score</div>
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 32 }}>vs</div>
                    <div>
                      <div style={{ fontSize: 36, fontWeight: 900, color: "#ef4444" }}>{practiceResult.bot_score}</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Bot Score</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginBottom: 16 }}>
                    {practiceResult.feedback}
                  </div>
                  {practiceResult.keywords_detected?.length > 0 && (
                    <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 24 }}>
                      {practiceResult.keywords_detected.map((k, i) => (
                        <span key={i} style={{
                          fontSize: 11, background: "rgba(16,185,129,0.15)",
                          color: "#10b981", padding: "2px 10px", borderRadius: 20,
                        }}>{k}</span>
                      ))}
                    </div>
                  )}
                  <button onClick={() => { setActiveRoom(null); setPracticeResult(null); setSolution(""); setTab("challenges"); }} style={{
                    padding: "10px 28px", background: "linear-gradient(135deg,#06b6d4,#0891b2)",
                    border: "none", borderRadius: 8, color: "#fff",
                    fontSize: 14, fontWeight: 700, cursor: "pointer",
                  }}>
                    Try Another Challenge
                  </button>
                </div>
              </div>
            ) : (
              /* ── ACTIVE DUEL / PRACTICE ── */
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                {/* Challenge Panel */}
                <div>
                  <div style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 14, padding: 24,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <div>
                        <div style={{
                          fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                          color: DIFF_COLOR[(activeRoom as unknown as Challenge).difficulty] || "#ccc",
                        }}>
                          {(activeRoom as unknown as Challenge).difficulty} · {(activeRoom as unknown as Challenge).category}
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginTop: 4 }}>
                          {(activeRoom as unknown as Challenge).title ?? activeRoom.challenge?.title}
                        </div>
                      </div>
                      {activeRoom.started_at && !practiceMode && (
                        <Countdown startedAt={activeRoom.started_at} deadlineMs={activeRoom.deadline_ms} />
                      )}
                    </div>

                    <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", lineHeight: 1.7, marginBottom: 16 }}>
                      {(activeRoom as unknown as Challenge).description ?? activeRoom.challenge?.description}
                    </div>

                    {/* Constraints */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: 1 }}>CONSTRAINTS</div>
                      {((activeRoom as unknown as Challenge).constraints ?? activeRoom.challenge?.constraints ?? []).map((c, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#06b6d4", fontFamily: "monospace", marginBottom: 3 }}>· {c}</div>
                      ))}
                    </div>

                    {/* Test cases */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: 1 }}>EXAMPLES</div>
                      {((activeRoom as unknown as Challenge).test_cases ?? activeRoom.challenge?.test_cases ?? []).slice(0, 2).map((tc, i) => (
                        <div key={i} style={{
                          background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "8px 12px",
                          fontFamily: "monospace", fontSize: 12, marginBottom: 6,
                        }}>
                          <div style={{ color: "#10b981" }}>In: {tc.input}</div>
                          <div style={{ color: "#f59e0b" }}>Out: {tc.output}</div>
                        </div>
                      ))}
                    </div>

                    {/* Hints */}
                    <div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: 1 }}>HINTS</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {((activeRoom as unknown as Challenge).hints ?? activeRoom.challenge?.hints ?? []).map((h, i) => (
                          <span key={i} style={{
                            fontSize: 11, background: "rgba(245,158,11,0.1)", color: "#f59e0b",
                            padding: "2px 10px", borderRadius: 20,
                          }}>{h}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Solution Panel */}
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 14, padding: 24, flex: 1,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "rgba(255,255,255,0.7)" }}>
                      {practiceMode ? "Practice Solution" : "Your Solution"}
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 12, lineHeight: 1.6 }}>
                      Write your algorithm approach in plain language, pseudocode, or real code.
                      System scores keyword coverage, clarity, complexity analysis, and edge cases.
                    </div>
                    <textarea
                      value={solution}
                      onChange={e => setSolution(e.target.value)}
                      placeholder={`Describe your approach:\n\n1. Handle edge cases (empty input, null, single element)\n2. Initialize data structures...\n3. Iterate / recurse...\n4. Time: O(n), Space: O(1)\n\nKey insight: ...`}
                      style={{
                        width: "100%", minHeight: 240, padding: 14,
                        background: "rgba(0,0,0,0.4)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 8, color: "#fff",
                        fontFamily: "JetBrains Mono, monospace", fontSize: 13,
                        lineHeight: 1.6, resize: "vertical", boxSizing: "border-box",
                        outline: "none",
                      }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                        {solution.length} / 5000 chars · min 10
                      </div>
                      <button
                        onClick={submitSolution}
                        disabled={submitting || solution.trim().length < 10}
                        style={{
                          padding: "10px 28px",
                          background: submitting || solution.trim().length < 10
                            ? "rgba(255,255,255,0.05)"
                            : "linear-gradient(135deg, #06b6d4, #0891b2)",
                          border: "none", borderRadius: 8, color: "#fff",
                          fontSize: 14, fontWeight: 700,
                          cursor: submitting ? "wait" : "pointer",
                        }}
                      >
                        {submitting ? "Submitting..." : practiceMode ? "Check My Solution" : "Submit Solution"}
                      </button>
                    </div>
                  </div>

                  {/* Scoring guide */}
                  <div style={{
                    background: "rgba(6,182,212,0.05)",
                    border: "1px solid rgba(6,182,212,0.15)",
                    borderRadius: 10, padding: "14px 18px",
                    fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.8,
                  }}>
                    <div style={{ fontWeight: 700, color: "#06b6d4", marginBottom: 6 }}>SCORING CRITERIA</div>
                    <div>• Keyword coverage (60%): mentions of key algorithm concepts</div>
                    <div>• Completeness (20%): thoroughness of explanation</div>
                    <div>• Complexity analysis (10%): O(n) notation present</div>
                    <div>• Edge cases (10%): handles empty/null/boundary</div>
                    {!practiceMode && <div style={{ color: "#f59e0b", marginTop: 4 }}>• Speed bonus: up to 15% for fast submission</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CHALLENGES TAB ── */}
        {tab === "challenges" && (
          <div>
            {/* Filter bar */}
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              {["", "Easy", "Medium", "Hard"].map(d => (
                <button key={d} onClick={() => setDiffFilter(d)} style={{
                  padding: "6px 16px", fontSize: 12, fontWeight: 600,
                  background: diffFilter === d ? (DIFF_COLOR[d] ? `${DIFF_COLOR[d]}22` : "rgba(255,255,255,0.1)") : "rgba(255,255,255,0.04)",
                  border: diffFilter === d ? `1px solid ${DIFF_COLOR[d] || "rgba(255,255,255,0.3)"}` : "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 20, color: diffFilter === d ? (DIFF_COLOR[d] || "#fff") : "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                }}>
                  {d || "All"}
                </button>
              ))}
            </div>

            {/* Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
              {filtered.map(ch => (
                <ChallengeCard
                  key={ch.id}
                  ch={ch}
                  onPractice={startPractice}
                  onChallenge={startDuel}
                />
              ))}
              {filtered.length === 0 && (
                <div style={{ color: "rgba(255,255,255,0.3)", gridColumn: "1/-1", textAlign: "center", padding: 40 }}>
                  No challenges found
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {tab === "history" && (
          <div>
            <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:18 }}>
              <span style={{ fontSize:9,fontWeight:800,letterSpacing:"0.16em",
                textTransform:"uppercase",color:"rgba(255,255,255,0.2)",
                fontFamily:"JetBrains Mono,monospace" }}>
                Recent Duels
              </span>
              <span style={{ fontSize:9,color:"rgba(255,255,255,0.15)",
                fontFamily:"JetBrains Mono,monospace" }}>
                auto-generated every ~8 min
              </span>
              <span style={{ marginLeft:"auto",fontSize:9,
                color:"rgba(6,182,212,0.5)",fontFamily:"JetBrains Mono,monospace" }}>
                {history.length} records
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {history.length === 0 ? (
                <div style={{ textAlign: "center", padding: 60, color: "rgba(255,255,255,0.3)" }}>
                  No completed duels yet — first auto match in ~30s...
                </div>
              ) : (history as any[]).map((item: any, i: number) => {
                const winnerName = item.winner==='a' ? item.agent_a
                                 : item.winner==='b' ? item.agent_b : null;
                const diffColor = DIFF_COLOR[item.challenge?.difficulty] || "#888";
                return (
                  <div key={i} style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 10, padding: "14px 20px",
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto auto",
                    gap: 16, alignItems: "center",
                  }}>
                    {/* Challenge info */}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 3 }}>
                        {item.challenge?.title || "Code Duel"}
                      </div>
                      <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1,
                          textTransform: "uppercase", color: diffColor }}>
                          {item.challenge?.difficulty}
                        </span>
                        <span style={{ fontSize:9,color:"rgba(255,255,255,0.2)" }}>
                          {item.challenge?.category}
                        </span>
                      </div>
                    </div>
                    {/* Agent A */}
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:11,fontWeight:700,
                        color:item.winner==='a'?"#10b981":"rgba(255,255,255,0.5)" }}>
                        {item.agent_a}
                      </div>
                      <div style={{ fontSize:13,fontWeight:900,
                        color:"rgba(255,255,255,0.9)",fontFamily:"JetBrains Mono,monospace" }}>
                        {item.score_a}
                      </div>
                    </div>
                    {/* VS */}
                    <div style={{ fontSize:11,color:"rgba(255,255,255,0.2)",
                      fontWeight:800,textAlign:"center" }}>
                      {item.winner==='draw'?"DRAW":"VS"}
                    </div>
                    {/* Agent B */}
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:11,fontWeight:700,
                        color:item.winner==='b'?"#10b981":"rgba(255,255,255,0.5)" }}>
                        {item.agent_b}
                      </div>
                      <div style={{ fontSize:13,fontWeight:900,
                        color:"rgba(255,255,255,0.9)",fontFamily:"JetBrains Mono,monospace" }}>
                        {item.score_b}
                      </div>
                    </div>
                    {/* Time */}
                    {item.ended_at && (
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)",
                        fontFamily:"JetBrains Mono,monospace",gridColumn:"1/-1",
                        marginTop:-8 }}>
                        {new Date(item.ended_at).toLocaleString()}
                        {winnerName && (
                          <span style={{ color:"#10b981",marginLeft:12 }}>
                            🏆 {winnerName} wins
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
