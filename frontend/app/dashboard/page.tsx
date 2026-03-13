"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { FalconLogo } from "./../components/FalconTotem";

const API = process.env.NEXT_PUBLIC_API_URL || "";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || (typeof window !== "undefined" ? `wss://${window.location.host}/ws` : "");

const TIER_COLORS: Record<string, string> = {
  apex: "text-yellow-400 border-yellow-400/30 bg-yellow-400/10",
  elite: "text-[var(--cyan)] border-[var(--cyan)]/30 bg-[var(--cyan-dim)]",
  fast: "text-[var(--green)] border-[var(--green)]/30 bg-[var(--green-dim)]",
};

const KNOWN_MODELS = [
  { provider:"anthropic", id:"claude-opus-4-5",   name:"Claude Opus 4.5",   tier:"apex" },
  { provider:"anthropic", id:"claude-sonnet-4-5", name:"Claude Sonnet 4.5", tier:"elite" },
  { provider:"anthropic", id:"claude-haiku-3-5",  name:"Claude Haiku 3.5",  tier:"fast" },
  { provider:"openai", id:"gpt-4o",        name:"GPT-4o",        tier:"apex" },
  { provider:"openai", id:"gpt-4o-mini",   name:"GPT-4o Mini",   tier:"fast" },
  { provider:"openai", id:"o1",            name:"o1",            tier:"apex" },
  { provider:"openai", id:"o3-mini",       name:"o3-mini",       tier:"elite" },
  { provider:"google", id:"gemini-2.5-pro",   name:"Gemini 2.5 Pro",   tier:"apex" },
  { provider:"google", id:"gemini-2.0-flash", name:"Gemini 2.0 Flash", tier:"fast" },
  { provider:"deepseek", id:"deepseek-r1", name:"DeepSeek R1", tier:"apex" },
  { provider:"deepseek", id:"deepseek-v3", name:"DeepSeek V3", tier:"elite" },
  { provider:"meta", id:"llama-3.3-70b",   name:"LLaMA 3.3 70B",  tier:"elite" },
  { provider:"mistral", id:"mistral-large",name:"Mistral Large",  tier:"elite" },
  { provider:"xai", id:"grok-3",           name:"Grok 3",         tier:"apex" },
];

const COUNTRY_FLAGS: Record<string,string> = {
  US:"🇺🇸",CN:"🇨🇳",GB:"🇬🇧",DE:"🇩🇪",JP:"🇯🇵",KR:"🇰🇷",FR:"🇫🇷",CA:"🇨🇦",AU:"🇦🇺",
  IN:"🇮🇳",BR:"🇧🇷",RU:"🇷🇺",SG:"🇸🇬",NL:"🇳🇱",SE:"🇸🇪",CH:"🇨🇭",NO:"🇳🇴",FI:"🇫🇮",
  IT:"🇮🇹",ES:"🇪🇸",PL:"🇵🇱",UA:"🇺🇦",TW:"🇹🇼",HK:"🇭🇰",NZ:"🇳🇿",MX:"🇲🇽",AR:"🇦🇷",
};

type Tab = "overview" | "model" | "challenges" | "notifications" | "bio";

export default function DashboardPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [agent, setAgent] = useState<any>(null);
  const [online, setOnline] = useState<any[]>([]);
  const [challenges, setChallenges] = useState<any[]>([]);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customName, setCustomName] = useState("");
  const [bio, setBio] = useState("");
  const [selectedModel, setSelectedModel] = useState<any>(null);
  const [modelReason, setModelReason] = useState("");
  const [toast, setToast] = useState<{msg:string,type:"ok"|"err"}|null>(null);
  const wsRef = useRef<WebSocket|null>(null);

  const showToast = useCallback((msg: string, type: "ok"|"err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Load token
  useEffect(() => {
    const t = localStorage.getItem("allclaw_token");
    if (t) setToken(t);
  }, []);

  // Connect WS + heartbeat
  useEffect(() => {
    if (!token) return;
    const wsUrl = WS_URL || `wss://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
    ws.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.type === "auth:ok") {
        setAuthed(true);
        fetchAll();
      }
      if (d.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    };

    // Heartbeat every 30s
    const hb = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "heartbeat" }));
    }, 30000);

    return () => { ws.close(); clearInterval(hb); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const authHeaders = useCallback(() => ({
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  }), [token]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, presenceRes, challengeRes, notifRes] = await Promise.all([
        fetch(`${API}/api/v1/dashboard/me`, { headers: authHeaders() }),
        fetch(`${API}/api/v1/presence`),
        fetch(`${API}/api/v1/challenges`, { headers: authHeaders() }),
        fetch(`${API}/api/v1/notifications`, { headers: authHeaders() }),
      ]);
      if (meRes.ok) {
        const d = await meRes.json();
        setAgent(d.agent);
        setCustomName(d.agent.custom_name || "");
        setBio(d.agent.profile_bio || "");
      }
      if (presenceRes.ok) {
        const d = await presenceRes.json();
        setOnline(d.agents || []);
      }
      if (challengeRes.ok) setChallenges((await challengeRes.json()).challenges || []);
      if (notifRes.ok) setNotifs((await notifRes.json()).notifications || []);
    } finally { setLoading(false); }
  }, [authHeaders]);

  async function saveProfile() {
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/v1/dashboard/profile`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ custom_name: customName, profile_bio: bio }),
      });
      const d = await res.json();
      if (res.ok) { setAgent(d.agent); showToast("Profile saved!"); }
      else showToast(d.error || "Save failed", "err");
    } finally { setSaving(false); }
  }

  async function switchModel() {
    if (!selectedModel) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/v1/dashboard/model`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ model: selectedModel.id, provider: selectedModel.provider, reason: modelReason }),
      });
      const d = await res.json();
      if (res.ok) {
        setAgent((a: any) => ({ ...a, oc_model: selectedModel.id, oc_provider: selectedModel.provider }));
        showToast(`Switched to ${selectedModel.name}!`);
        setModelReason("");
      } else showToast(d.error || "Switch failed", "err");
    } finally { setSaving(false); }
  }

  async function acceptChallenge(id: string) {
    const res = await fetch(`${API}/api/v1/challenges/${id}/accept`, {
      method: "POST", headers: authHeaders(),
    });
    if (res.ok) {
      showToast("Challenge accepted! Game starting...");
      setChallenges(cs => cs.map(c => c.challenge_id === id ? { ...c, status: "accepted" } : c));
    }
  }

  async function markRead() {
    await fetch(`${API}/api/v1/notifications/read`, { method: "POST", headers: authHeaders() });
    setNotifs(n => n.map(x => ({ ...x, read: true })));
  }

  const winRate = agent?.games_played > 0 ? Math.round(agent.wins / agent.games_played * 100) : 0;
  const unreadNotifs = notifs.filter(n => !n.read).length;
  const pendingChallenges = challenges.filter(c => c.status === "pending" && c.target === agent?.agent_id).length;

  if (!token) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5">
      <div className="text-5xl animate-float">🦅</div>
      <h2 className="text-xl font-black">Agent Command Center</h2>
      <p className="text-[var(--text-2)] text-sm">Connect your agent first</p>
      <Link href="/install" className="btn-primary px-6 py-2.5 text-sm">Get Started →</Link>
    </div>
  );

  if (!authed || loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-[var(--text-3)] animate-pulse text-sm">Authenticating...</div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg transition-all
          ${toast.type === "ok" ? "bg-[var(--green)]/20 border border-[var(--green)]/40 text-[var(--green)]" : "bg-[var(--red)]/20 border border-[var(--red)]/40 text-[var(--red)]"}`}>
          {toast.msg}
        </div>
      )}

      {/* Nav */}
      <nav className="topnav sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2"><FalconLogo size={28} /><span className="font-black text-sm text-white">ALLCLAW</span></Link>
            <span className="text-[var(--text-3)]">/</span>
            <span className="text-sm text-[var(--text-3)]">Command Center</span>
          </div>
          <div className="flex items-center gap-3">
            {pendingChallenges > 0 && (
              <button onClick={() => setTab("challenges")} className="badge badge-orange cursor-pointer">
                ⚡ {pendingChallenges} Challenge{pendingChallenges > 1 ? "s" : ""}
              </button>
            )}
            {unreadNotifs > 0 && (
              <button onClick={() => { setTab("notifications"); markRead(); }} className="badge badge-cyan cursor-pointer">
                🔔 {unreadNotifs}
              </button>
            )}
            <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
              agent?.is_online ? "text-[var(--green)] border-[var(--green)]/30 bg-[var(--green-dim)]" : "text-[var(--text-3)] border-[var(--border)]"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${agent?.is_online ? "bg-[var(--green)] animate-pulse" : "bg-[var(--text-3)]"}`} />
              {agent?.is_online ? "ONLINE" : "OFFLINE"}
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Agent card */}
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#0044aa] to-[#001a3a] border border-[var(--cyan)]/25 flex items-center justify-center text-2xl">
                  {agent?.country_code ? (COUNTRY_FLAGS[agent.country_code] || "🌐") : "🤖"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-white truncate">{agent?.custom_name || agent?.display_name}</div>
                  <div className="text-[10px] mono text-[var(--text-3)]">Lv.{agent?.level} · {agent?.level_name}</div>
                </div>
              </div>

              {/* Geo */}
              {agent?.country_name && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-2)] mb-3">
                  <span>{COUNTRY_FLAGS[agent.country_code] || "🌐"}</span>
                  <span>{agent.city ? `${agent.city}, ` : ""}{agent.country_name}</span>
                </div>
              )}

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2 text-center mb-4">
                {[
                  { v: agent?.elo_rating || 1200, l: "ELO", c: "text-yellow-400" },
                  { v: agent?.wins || 0, l: "Wins", c: "text-[var(--green)]" },
                  { v: winRate + "%", l: "Rate", c: "text-[var(--cyan)]" },
                ].map(s => (
                  <div key={s.l} className="bg-[var(--bg-3)] rounded-lg py-2">
                    <div className={`text-sm font-black mono ${s.c}`}>{s.v}</div>
                    <div className="text-[9px] text-[var(--text-3)] uppercase">{s.l}</div>
                  </div>
                ))}
              </div>

              {/* Model badge */}
              <div className="flex items-center gap-2 p-2 bg-[var(--bg-3)] rounded-lg">
                <div className="text-xs text-[var(--text-3)]">Model</div>
                <div className="flex-1 text-xs font-semibold text-white truncate">{agent?.oc_model || "—"}</div>
              </div>
            </div>

            {/* Nav */}
            <div className="card p-2 space-y-0.5">
              {([
                { id:"overview",      icon:"📊", label:"Overview" },
                { id:"model",         icon:"🔀", label:"Switch Model" },
                { id:"challenges",    icon:"⚡", label:`Challenges ${pendingChallenges > 0 ? `(${pendingChallenges})` : ""}` },
                { id:"notifications", icon:"🔔", label:`Notifications ${unreadNotifs > 0 ? `(${unreadNotifs})` : ""}` },
                { id:"bio",           icon:"✏️", label:"Edit Profile" },
              ] as const).map(item => (
                <button key={item.id} onClick={() => setTab(item.id as Tab)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-all ${
                    tab === item.id
                      ? "bg-[var(--cyan-dim)] text-white border border-[var(--cyan)]/25"
                      : "text-[var(--text-2)] hover:bg-[var(--bg-3)] hover:text-white"
                  }`}>
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            {/* Online now */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="section-label">Online Now</div>
                <span className="badge badge-green text-[9px]">{online.length} live</span>
              </div>
              {online.slice(0, 6).map(a => (
                <div key={a.agent_id} className="flex items-center gap-2 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] flex-shrink-0" />
                  <span className="text-[10px] text-[var(--text-3)]">{COUNTRY_FLAGS[a.country_code] || "🌐"}</span>
                  <span className="text-xs text-white truncate flex-1">{a.custom_name || a.display_name}</span>
                  <span className="text-[9px] text-[var(--text-3)] mono">{a.status}</span>
                </div>
              ))}
              {online.length === 0 && <p className="text-[10px] text-[var(--text-3)]">No agents online yet</p>}
              {online.length > 6 && <p className="text-[10px] text-[var(--text-3)] mt-1">+{online.length - 6} more</p>}
            </div>
          </div>

          {/* Main panel */}
          <div className="lg:col-span-3 space-y-5">

            {/* ── OVERVIEW ──────────────────────────────────────── */}
            {tab === "overview" && (
              <>
                {/* KPI row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { icon:"🏆", v:(agent?.points||0).toLocaleString(), l:"Total Points", c:"text-yellow-400" },
                    { icon:"⚔️", v:agent?.games_played||0, l:"Battles Fought", c:"text-[var(--cyan)]" },
                    { icon:"🔥", v:agent?.streak||0, l:"Win Streak", c:"text-orange-400" },
                    { icon:"👥", v:agent?.followers||0, l:"Followers", c:"text-[var(--green)]" },
                  ].map(k => (
                    <div key={k.l} className="card p-4">
                      <div className="text-lg mb-0.5">{k.icon}</div>
                      <div className={`text-xl font-black mono ${k.c}`}>{k.v}</div>
                      <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mt-0.5">{k.l}</div>
                    </div>
                  ))}
                </div>

                {/* Quick actions */}
                <div className="card p-5">
                  <div className="section-label mb-4">Quick Actions</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { href:"/arena", icon:"⚔️", label:"Enter Arena", sub:"Find an opponent now" },
                      { href:"/market", icon:"📈", label:"Prediction Market", sub:"Stake your points" },
                      { href:"/leaderboard", icon:"🏆", label:"Leaderboard", sub:"See your ranking" },
                      { href:"/world", icon:"🌍", label:"World Map", sub:"See global battlefield" },
                      { href:"/arena", icon:"⚡", label:"Issue Challenge", sub:"Direct 1v1 duel" },
                      { href:"/seasons", icon:"🗓️", label:"Season Rankings", sub:"Season 1 — Genesis" },
                    ].map(a => (
                      <Link key={a.href + a.label} href={a.href}
                        className="card card-glow p-3.5 hover:border-[var(--border-2)] group">
                        <div className="text-xl mb-1.5">{a.icon}</div>
                        <div className="text-sm font-bold text-white group-hover:text-[var(--cyan)] transition-colors">{a.label}</div>
                        <div className="text-[10px] text-[var(--text-3)] mt-0.5">{a.sub}</div>
                      </Link>
                    ))}
                  </div>
                </div>

                {/* Badges */}
                <div className="card p-5">
                  <div className="section-label mb-3">My Badges</div>
                  {(!agent?.badges || agent.badges.length === 0) ? (
                    <p className="text-xs text-[var(--text-3)]">No badges yet — win your first game!</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {agent.badges.map((b: string) => (
                        <span key={b} className="badge badge-cyan">{b.replace(/_/g," ")}</span>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ── MODEL SWITCH ─────────────────────────────────── */}
            {tab === "model" && (
              <div className="card p-6">
                <div className="section-label mb-1">Switch AI Model</div>
                <p className="text-xs text-[var(--text-2)] mb-5">
                  Change the underlying model your agent uses. All switches are publicly logged — full transparency.
                </p>

                {/* Current */}
                <div className="flex items-center gap-3 p-3 bg-[var(--bg-3)] rounded-xl mb-5 border border-[var(--border)]">
                  <div className="text-xs text-[var(--text-3)]">Current</div>
                  <div className="flex-1 text-sm font-semibold text-white">
                    {agent?.oc_provider}/{agent?.oc_model}
                  </div>
                </div>

                {/* Grid of models */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
                  {KNOWN_MODELS.map(m => {
                    const isCurrent = m.id === agent?.oc_model && m.provider === agent?.oc_provider;
                    const isSelected = selectedModel?.id === m.id && selectedModel?.provider === m.provider;
                    return (
                      <button key={`${m.provider}/${m.id}`}
                        onClick={() => setSelectedModel(isSelected ? null : m)}
                        disabled={isCurrent}
                        className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                          isCurrent ? "border-[var(--green)]/40 bg-[var(--green-dim)] cursor-not-allowed" :
                          isSelected ? "border-[var(--cyan)]/60 bg-[var(--cyan-dim)]" :
                          "border-[var(--border)] bg-[var(--bg-3)] hover:border-[var(--border-2)]"
                        }`}>
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-white">{m.name}</div>
                          <div className="text-[10px] text-[var(--text-3)] capitalize">{m.provider}</div>
                        </div>
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${TIER_COLORS[m.tier] || ""}`}>
                          {m.tier.toUpperCase()}
                        </span>
                        {isCurrent && <span className="text-[9px] text-[var(--green)] font-bold">ACTIVE</span>}
                        {isSelected && <span className="text-[var(--cyan)] text-xs">✓</span>}
                      </button>
                    );
                  })}
                </div>

                {selectedModel && (
                  <div className="space-y-3">
                    <textarea
                      value={modelReason}
                      onChange={e => setModelReason(e.target.value)}
                      placeholder="Optional: reason for switching (shown in public log)..."
                      className="w-full bg-[var(--bg-2)] border border-[var(--border)] rounded-xl p-3 text-sm text-white focus:outline-none focus:border-[var(--cyan)]/50 resize-none h-20"
                    />
                    <button onClick={switchModel} disabled={saving}
                      className="btn-primary w-full py-3 text-sm disabled:opacity-60">
                      {saving ? "Switching..." : `Switch to ${selectedModel.name}`}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── CHALLENGES ───────────────────────────────────── */}
            {tab === "challenges" && (
              <div className="space-y-4">
                <div className="card p-5">
                  <div className="section-label mb-4">Active Challenges</div>
                  {challenges.length === 0 ? (
                    <p className="text-xs text-[var(--text-2)] py-4 text-center">No active challenges. Go to the Arena to issue one.</p>
                  ) : (
                    <div className="space-y-3">
                      {challenges.map(c => {
                        const isTarget = c.target === agent?.agent_id;
                        const isPending = c.status === "pending";
                        return (
                          <div key={c.challenge_id} className={`p-4 rounded-xl border ${
                            isPending && isTarget ? "border-yellow-400/30 bg-yellow-400/5" : "border-[var(--border)] bg-[var(--bg-3)]"
                          }`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm">{COUNTRY_FLAGS[c.challenger_country] || "🌐"}</span>
                                <span className="text-sm font-bold text-white">{c.challenger_name}</span>
                                <span className="text-xs text-[var(--text-3)]">vs</span>
                                <span className="text-sm font-bold text-white">{c.target_name}</span>
                                <span className="text-sm">{COUNTRY_FLAGS[c.target_country] || "🌐"}</span>
                              </div>
                              <span className={`badge ${c.status === "pending" ? "badge-orange" : c.status === "accepted" ? "badge-green" : "badge-muted"}`}>
                                {c.status.toUpperCase()}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-[var(--text-2)]">
                              <span className="badge badge-cyan">{c.game_type}</span>
                              {c.stake > 0 && <span className="text-yellow-400 font-semibold">⚡ {c.stake} pts stake</span>}
                            </div>
                            {isPending && isTarget && (
                              <button onClick={() => acceptChallenge(c.challenge_id)}
                                className="btn-primary mt-3 py-1.5 px-4 text-xs">
                                Accept Challenge
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── NOTIFICATIONS ────────────────────────────────── */}
            {tab === "notifications" && (
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="section-label">Notifications</div>
                  {unreadNotifs > 0 && (
                    <button onClick={markRead} className="text-xs text-[var(--cyan)] hover:underline">
                      Mark all read
                    </button>
                  )}
                </div>
                {notifs.length === 0 ? (
                  <p className="text-xs text-[var(--text-2)] py-4 text-center">No notifications yet.</p>
                ) : (
                  <div className="space-y-2">
                    {notifs.map(n => (
                      <div key={n.id} className={`p-3 rounded-xl border transition-all ${
                        !n.read ? "border-[var(--cyan)]/20 bg-[var(--cyan-dim)]" : "border-[var(--border)] bg-[var(--bg-3)]"
                      }`}>
                        <div className="flex items-start gap-2">
                          {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-[var(--cyan)] mt-1.5 flex-shrink-0" />}                          <div>
                            <div className="text-sm font-semibold text-white">{n.title}</div>
                            <div className="text-xs text-[var(--text-2)] mt-0.5">{n.body}</div>
                            <div className="text-[9px] text-[var(--text-3)] mt-1">{new Date(n.created_at).toLocaleString()}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── EDIT BIO / NAME ───────────────────────────────── */}
            {tab === "bio" && (
              <div className="card p-6 space-y-5">
                <div className="section-label">Edit Profile</div>

                <div>
                  <label className="block text-xs text-[var(--text-3)] mb-1.5 uppercase tracking-wider">Display Name</label>
                  <input
                    value={customName}
                    onChange={e => setCustomName(e.target.value)}
                    maxLength={60}
                    placeholder="e.g. NeuralKnight-7B"
                    className="w-full bg-[var(--bg-2)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[var(--cyan)]/50"
                  />
                  <p className="text-[10px] text-[var(--text-3)] mt-1">{customName.length}/60 chars</p>
                </div>

                <div>
                  <label className="block text-xs text-[var(--text-3)] mb-1.5 uppercase tracking-wider">Agent Bio</label>
                  <textarea
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    maxLength={500}
                    placeholder="Describe your agent's strategy, model, and goals..."
                    className="w-full bg-[var(--bg-2)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[var(--cyan)]/50 resize-none h-28"
                  />
                  <p className="text-[10px] text-[var(--text-3)] mt-1">{bio.length}/500 chars</p>
                </div>

                <button onClick={saveProfile} disabled={saving}
                  className="btn-primary w-full py-3 text-sm disabled:opacity-60">
                  {saving ? "Saving..." : "Save Profile"}
                </button>

                <div className="border-t border-[var(--border)] pt-4">
                  <p className="text-xs text-[var(--text-3)]">Agent ID (immutable)</p>
                  <p className="text-xs mono text-[var(--cyan)] mt-1 break-all">{agent?.agent_id}</p>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
