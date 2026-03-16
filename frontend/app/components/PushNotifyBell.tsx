"use client";
/**
 * AllClaw — Push Notification Bell Component
 * Shows a bell icon in the exchange page. Click to enable/disable push notifications.
 * Auto-prompts if user has holdings and hasn't subscribed.
 */
import { useState, useEffect } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "";
const MONO = { fontFamily: "JetBrains Mono, monospace" } as const;

interface Props {
  handle: string;
}

export default function PushNotifyBell({ handle }: Props) {
  const [status,      setStatus]      = useState<"unknown"|"granted"|"denied"|"unsupported">("unknown");
  const [subscribed,  setSubscribed]  = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [vapidKey,    setVapidKey]    = useState<string|null>(null);

  // Check current permission + subscription status
  useEffect(() => {
    if (!handle) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setStatus("unsupported"); return;
    }
    setStatus(Notification.permission as any);

    // Get VAPID public key
    fetch(`${API}/api/v1/push/vapid-key`)
      .then(r => r.json())
      .then(d => setVapidKey(d.publicKey))
      .catch(() => {});

    // Check if already subscribed
    fetch(`${API}/api/v1/push/status/${handle}`)
      .then(r => r.json())
      .then(d => setSubscribed(d.subscribed))
      .catch(() => {});
  }, [handle]);

  function urlB64ToUint8Array(base64String: string) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw     = window.atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  async function subscribe() {
    if (!handle || !vapidKey || status === "unsupported") return;
    setLoading(true);
    try {
      // Request permission
      const permission = await Notification.requestPermission();
      setStatus(permission as any);
      if (permission !== "granted") { setLoading(false); return; }

      // Get service worker registration
      const reg = await navigator.serviceWorker.ready;

      // Subscribe to push
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlB64ToUint8Array(vapidKey),
      });

      // Send to backend
      const res = await fetch(`${API}/api/v1/push/subscribe`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          handle,
          subscription: sub.toJSON(),
          userAgent:    navigator.userAgent,
        }),
      }).then(r => r.json());

      if (res.ok) {
        setSubscribed(true);
        setShowTooltip(true);
        setTimeout(() => setShowTooltip(false), 3000);
      }
    } catch (e) {
      console.error("Push subscribe error:", e);
    }
    setLoading(false);
  }

  async function unsubscribe() {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await fetch(`${API}/api/v1/push/unsubscribe`, {
          method:  "DELETE",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ handle, endpoint: sub.endpoint }),
        });
      }
      setSubscribed(false);
    } catch(e) {}
    setLoading(false);
  }

  if (!handle || status === "unsupported") return null;

  const isActive = subscribed && status === "granted";
  const isDenied = status === "denied";

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      {/* Bell button */}
      <button
        onClick={isActive ? unsubscribe : subscribe}
        disabled={loading || isDenied}
        title={isDenied ? "Notifications blocked in browser settings"
               : isActive ? "Notifications ON — click to disable"
               : "Enable push notifications"}
        style={{
          background:   isActive ? "rgba(0,229,255,0.1)"   : "rgba(255,255,255,0.04)",
          border:       `1px solid ${isActive ? "rgba(0,229,255,0.3)" : "rgba(255,255,255,0.1)"}`,
          borderRadius: 8,
          padding:      "5px 10px",
          cursor:       isDenied ? "not-allowed" : "pointer",
          display:      "flex",
          alignItems:   "center",
          gap:          5,
          opacity:      loading ? 0.6 : 1,
          transition:   "all 0.15s",
        }}
      >
        <span style={{ fontSize: 14 }}>
          {loading ? "⏳" : isActive ? "🔔" : isDenied ? "🔕" : "🔔"}
        </span>
        <span style={{
          fontSize:    8,
          fontWeight:  800,
          color:       isActive ? "#00e5ff" : isDenied ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.4)",
          ...MONO,
          letterSpacing: "0.06em",
          textTransform: "uppercase" as const,
        }}>
          {loading ? "..." : isActive ? "ON" : isDenied ? "BLOCKED" : "ALERTS"}
        </span>
        {isActive && (
          <span style={{
            width: 5, height: 5, borderRadius: "50%",
            background: "#4ade80",
            boxShadow:  "0 0 4px #4ade80",
            display:    "inline-block",
          }}/>
        )}
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div style={{
          position:    "absolute",
          top:         "calc(100% + 8px)",
          right:       0,
          background:  "rgba(0,229,255,0.08)",
          border:      "1px solid rgba(0,229,255,0.25)",
          borderRadius: 8,
          padding:     "8px 12px",
          whiteSpace:  "nowrap",
          zIndex:      9999,
          backdropFilter: "blur(12px)",
        }}>
          <div style={{ fontSize: 12, color: "#4ade80", fontWeight: 800 }}>✓ Alerts active!</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 2, ...MONO }}>
            Dividends · Orders · Price alerts
          </div>
        </div>
      )}
    </div>
  );
}
