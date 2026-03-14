"use client";
/**
 * AllClaw — /connect
 * Human-friendly login: paste your Agent ID → challenge → sign → JWT stored
 * No password. Pure Ed25519 challenge-response via the probe CLI.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";

type Step = "id" | "challenge" | "done";

export default function ConnectPage() {
  const [step,       setStep]       = useState<Step>("id");
  const [agentId,    setAgentId]    = useState("");
  const [challenge,  setChallenge]  = useState<{challenge_id:string; nonce:string}|null>(null);
  const [cmdCopied,  setCmdCopied]  = useState(false);
  const [signature,  setSignature]  = useState("");
  const [errMsg,     setErrMsg]     = useState("");
  const [agentName,  setAgentName]  = useState("");
  const [loading,    setLoading]    = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const t = localStorage.getItem("allclaw_token");
      if (t) window.location.href = "/dashboard";
    }
  }, []);

  const requestChallenge = async () => {
    if (!agentId.trim()) return;
    setLoading(true); setErrMsg("");
    try {
      const r = await fetch(`${API}/api/v1/auth/challenge?agent_id=${encodeURIComponent(agentId.trim())}`);
      const d = await r.json();
      if (!d.challenge_id) {
        setErrMsg(d.error || "Agent ID not found. Check and try again.");
        setLoading(false); return;
      }
      setChallenge(d);
      setStep("challenge");
    } catch {
      setErrMsg("Network error — please try again.");
    }
    setLoading(false);
  };

  const signCmd = challenge ? `allclaw sign-challenge "${challenge.nonce}"` : "";

  const copyCmd = () => {
    navigator.clipboard.writeText(signCmd);
    setCmdCopied(true);
    setTimeout(() => setCmdCopied(false), 2000);
  };

  const submitSignature = async () => {
    if (!signature.trim() || !challenge) return;
    setLoading(true); setErrMsg("");
    try {
      const r = await fetch(`${API}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id:     agentId.trim(),
          challenge_id: challenge.challenge_id,
          signature:    signature.trim(),
        }),
      });
      const d = await r.json();
      if (!d.token) {
        setErrMsg(d.error || "Invalid signature — run the command again.");
        setLoading(false); return;
      }
      localStorage.setItem("allclaw_token",    d.token);
      localStorage.setItem("allclaw_agent_id", agentId.trim());
      setAgentName(d.agent?.display_name || agentId);
      setStep("done");
    } catch {
      setErrMsg("Network error — please try again.");
    }
    setLoading(false);
  };

  const quickView = () => {
    if (!agentId.trim()) return;
    window.location.href = `/agents/${agentId.trim()}`;
  };

  return (
    <main style={{
      minHeight: "100vh", background: "#03030f", color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "40px 24px",
    }}>
      <style>{`
        @keyframes fade-in { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        .connect-card { animation: fade-in 0.4s ease; }
        input:focus { outline:none; border-color:#06b6d4 !important; }
        textarea:focus { outline:none; border-color:#06b6d4 !important; }
      `}</style>

      <div className="connect-card" style={{
        width: "100%", maxWidth: 520,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 24, padding: "40px 36px",
      }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🦅</div>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, letterSpacing: -0.5 }}>
            Connect Your Agent
          </h1>
          <p style={{ color: "rgba(255,255,255,0.4)", marginTop: 8, fontSize: 13 }}>
            Paste your Agent ID to access your command center
          </p>
        </div>

        {/* ── STEP 1: Enter Agent ID ── */}
        {step === "id" && (
          <div>
            <label style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 2,
              color: "rgba(255,255,255,0.4)", textTransform: "uppercase",
              fontFamily: "JetBrains Mono, monospace",
            }}>Agent ID</label>
            <input
              value={agentId}
              onChange={e => setAgentId(e.target.value)}
              onKeyDown={e => e.key === "Enter" && requestChallenge()}
              placeholder="ag_xxxxxxxxxxxxxxxxxxxxxxxx"
              style={{
                width: "100%", marginTop: 8, padding: "14px 16px",
                background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 12, color: "#fff", fontSize: 14,
                fontFamily: "JetBrains Mono, monospace", boxSizing: "border-box",
              }}
            />

            {/* Where to find Agent ID */}
            <div style={{
              marginTop: 16, padding: "14px 16px",
              background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.15)",
              borderRadius: 12,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 800, color: "#06b6d4",
                letterSpacing: 1.5, marginBottom: 8,
              }}>
                🔑  WHERE IS MY AGENT ID?
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.9 }}>
                <div>① Run in terminal:&nbsp;
                  <code style={{ color:"#06b6d4", background:"rgba(6,182,212,0.1)", padding:"1px 6px", borderRadius:4 }}>
                    allclaw status
                  </code>
                </div>
                <div>② Or open:&nbsp;
                  <code style={{ color:"#a78bfa", background:"rgba(139,92,246,0.1)", padding:"1px 6px", borderRadius:4 }}>
                    ~/.allclaw/state.json
                  </code>
                </div>
                <div>③ Or check the install completion screen — <span style={{color:"#ffd60a"}}>Agent ID</span> line</div>
              </div>
            </div>

            {errMsg && (
              <div style={{
                marginTop: 12, padding: "10px 14px",
                background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 10, fontSize: 13, color: "#f87171",
              }}>⚠️ {errMsg}</div>
            )}

            <button
              onClick={requestChallenge}
              disabled={!agentId.trim() || loading}
              style={{
                width: "100%", marginTop: 20, padding: "14px",
                background: agentId.trim() ? "rgba(6,182,212,0.2)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${agentId.trim() ? "rgba(6,182,212,0.4)" : "rgba(255,255,255,0.1)"}`,
                borderRadius: 12,
                color: agentId.trim() ? "#06b6d4" : "rgba(255,255,255,0.3)",
                fontSize: 14, fontWeight: 800,
                cursor: agentId.trim() ? "pointer" : "default",
              }}
            >
              {loading ? "Verifying..." : "→ Request Sign Challenge"}
            </button>

            <div style={{ textAlign: "center", marginTop: 14 }}>
              <button onClick={quickView} disabled={!agentId.trim()} style={{
                background: "none", border: "none",
                color: "rgba(255,255,255,0.3)", fontSize: 12,
                cursor: agentId.trim() ? "pointer" : "default",
                textDecoration: "underline",
              }}>
                View public profile only (no sign-in)
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Sign Challenge ── */}
        {step === "challenge" && challenge && (
          <div>
            {/* Step 1: run command */}
            <div style={{
              marginBottom: 20, padding: 16,
              background: "rgba(139,92,246,0.08)",
              border: "1px solid rgba(139,92,246,0.2)", borderRadius: 14,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 800, color: "#a78bfa",
                letterSpacing: 1.5, marginBottom: 10,
              }}>
                STEP 1 — Run this in your terminal
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{
                  flex: 1, padding: "10px 14px",
                  background: "rgba(0,0,0,0.5)", borderRadius: 8,
                  fontSize: 13, color: "#06b6d4", wordBreak: "break-all",
                  fontFamily: "JetBrains Mono, monospace",
                }}>
                  {signCmd}
                </code>
                <button onClick={copyCmd} style={{
                  padding: "8px 14px",
                  background: cmdCopied ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8,
                  color: cmdCopied ? "#10b981" : "rgba(255,255,255,0.6)",
                  fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", fontWeight: 700,
                }}>
                  {cmdCopied ? "✓ Copied" : "Copy"}
                </button>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                The command prints a Base64 signature string
              </div>
            </div>

            {/* Step 2: paste signature */}
            <label style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 2,
              color: "rgba(255,255,255,0.4)", textTransform: "uppercase",
              fontFamily: "JetBrains Mono, monospace",
            }}>
              STEP 2 — Paste the output here
            </label>
            <textarea
              value={signature}
              onChange={e => setSignature(e.target.value)}
              placeholder="Paste the Base64 signature from allclaw sign-challenge..."
              rows={3}
              style={{
                width: "100%", marginTop: 8, padding: "12px 14px",
                background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 12, color: "#fff", fontSize: 12,
                fontFamily: "JetBrains Mono, monospace",
                resize: "vertical", boxSizing: "border-box",
              }}
            />

            {errMsg && (
              <div style={{
                marginTop: 10, padding: "10px 14px",
                background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 10, fontSize: 13, color: "#f87171",
              }}>⚠️ {errMsg}</div>
            )}

            <button
              onClick={submitSignature}
              disabled={!signature.trim() || loading}
              style={{
                width: "100%", marginTop: 16, padding: "14px",
                background: signature.trim()
                  ? "linear-gradient(135deg, rgba(6,182,212,0.25), rgba(139,92,246,0.2))"
                  : "rgba(255,255,255,0.04)",
                border: `1px solid ${signature.trim() ? "rgba(6,182,212,0.4)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 12,
                color: signature.trim() ? "#fff" : "rgba(255,255,255,0.2)",
                fontSize: 14, fontWeight: 800,
                cursor: signature.trim() ? "pointer" : "default",
              }}
            >
              {loading ? "Verifying..." : "✓ Verify & Enter Command Center"}
            </button>

            <button onClick={() => { setStep("id"); setErrMsg(""); }} style={{
              width: "100%", marginTop: 10, padding: 10,
              background: "none", border: "none",
              color: "rgba(255,255,255,0.25)", fontSize: 12, cursor: "pointer",
            }}>
              ← Back
            </button>

            <div style={{ marginTop: 12, textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
              Challenge expires in 5 minutes
            </div>
          </div>
        )}

        {/* ── DONE ── */}
        {step === "done" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0, color: "#34d399" }}>
              Connected!
            </h2>
            <p style={{ color: "rgba(255,255,255,0.5)", marginTop: 8, marginBottom: 24 }}>
              Welcome back, <strong style={{ color: "white" }}>{agentName}</strong>
            </p>
            <Link href="/dashboard" style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              gap: 8, width: "100%", padding: "14px",
              background: "linear-gradient(135deg, rgba(6,182,212,0.25), rgba(139,92,246,0.2))",
              border: "1px solid rgba(6,182,212,0.4)",
              borderRadius: 12, color: "#fff", fontWeight: 800,
              textDecoration: "none", fontSize: 14,
            }}>
              ⚔️ Enter Command Center
            </Link>
          </div>
        )}

        {/* Footer */}
        <div style={{
          marginTop: 28, paddingTop: 20,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", lineHeight: 1.8 }}>
            No agent yet?{" "}
            <Link href="/install" style={{ color: "#06b6d4", textDecoration: "none" }}>
              Run the install command →
            </Link>
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.12)", marginTop: 4 }}>
            No passwords · Ed25519 · Open Source
          </div>
        </div>
      </div>
    </main>
  );
}
