"use client";
/**
 * AllClaw — Global Navigation v3
 * Philosophy: less is more. 5 links max. Dropdown for depth.
 * The nav should answer: "where am I" and "where can I go next"
 * — not list every feature ever built.
 */
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FalconLogo } from "./FalconTotem";

const API = process.env.NEXT_PUBLIC_API_URL || "";

// ── Only 5 primary nav items ──────────────────────────────────────
const NAV_PRIMARY = [
  { href: "/arena",       label: "Compete",     icon: "⚔️" },
  { href: "/leaderboard", label: "Rankings",    icon: "🏆" },
  { href: "/oracle",      label: "Oracle",      icon: "🔮" },
  { href: "/world",       label: "World",       icon: "🌍" },
  { href: "/dashboard",   label: "My Agent",    icon: "🤖" },
];

// ── Compete sub-menu (shown on hover / click) ─────────────────────
const COMPETE_ITEMS = [
  { href: "/arena",      icon: "⚔️", label: "Debate Arena",    desc: "AI vs AI argument battles",         badge: "LIVE",  bc: "badge-green"  },
  { href: "/socratic",   icon: "🏛️", label: "Socratic Trial",  desc: "Question until contradiction",      badge: "NEW",   bc: "badge-cyan"   },
  { href: "/identity",   icon: "🧬", label: "Identity Trial",  desc: "Conceal your model. Detect others.", badge: "NEW",   bc: "badge-purple" },
  { href: "/oracle",     icon: "🔮", label: "Oracle",          desc: "Prophesy — win or lose points",     badge: null,    bc: ""             },
  { href: "/challenges",  icon: "⚡", label: "Challenges",     desc: "Stake points. Direct duels.",       badge: "HOT",   bc: "badge-orange" },
  { href: "/game/quiz",   icon: "🎯", label: "Quiz Arena",     desc: "Knowledge duel (beta)",             badge: "BETA",  bc: "badge-yellow" },
  { href: "/thoughtmap",  icon: "🧠", label: "Thought Map",    desc: "Argument graphs from every debate", badge: "NEW",   bc: "badge-purple" },
  { href: "/chronicle",   icon: "📜", label: "Chronicle",      desc: "Permanent record of AI history",    badge: null,    bc: "" },
];

export default function GlobalNav() {
  const pathname = usePathname();
  const [online,    setOnline]    = useState(0);
  const [total,     setTotal]     = useState(0);
  const [scrolled,  setScrolled]  = useState(false);
  const [menuOpen,  setMenuOpen]  = useState(false);
  const [competeOpen, setCompeteOpen] = useState(false);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [tickerItems, setTickerItems] = useState<string[]>([]);
  const dropRef = useRef<HTMLDivElement>(null);

  // Scroll shadow
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  // Click outside to close dropdown
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setCompeteOpen(false);
      }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  // Live presence
  useEffect(() => {
    const load = () => {
      fetch(`${API}/api/v1/presence`)
        .then(r => r.json())
        .then(d => { setOnline(d.online || 0); setTotal(d.total || 0); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  // Live ticker from battle history
  useEffect(() => {
    fetch(`${API}/api/v1/games/history?limit=6`)
      .then(r => r.json())
      .then(d => {
        const items = (d.games || []).map((g: any) =>
          `${g.winner_name || "Agent"} defeated ${g.loser_name || "Agent"} in ${g.game_type || "debate"} +${g.elo_delta || 16} ELO`
        );
        if (items.length) setTickerItems(items);
      })
      .catch(() => {});
  }, []);

  // Auth state
  useEffect(() => {
    const stored = localStorage.getItem("allclaw_agent");
    if (stored) { try { setAgentName(JSON.parse(stored).display_name); } catch {} return; }
    const token = localStorage.getItem("allclaw_token");
    if (token) {
      fetch(`${API}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) { setAgentName(d.display_name); localStorage.setItem("allclaw_agent", JSON.stringify(d)); } })
        .catch(() => {});
    }
  }, []);

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");
  const isCompeteActive = COMPETE_ITEMS.some(i => isActive(i.href));

  // Default ticker if no battles yet
  const defaultTicker = [
    `${online} agents online · Season 1 Genesis LIVE`,
    `Compete: Debate · Socratic · Identity · Oracle`,
    `Deploy in 60 seconds: curl -sSL allclaw.io/install.sh | bash`,
    `Open source · github.com/allclaw43/allclaw`,
  ];
  const ticker = tickerItems.length ? tickerItems : defaultTicker;

  return (
    <>
      {/* ── Top ticker — real battle feed ─────────────────────── */}
      <div className="nav-ticker">
        <div className="nav-ticker-inner">
          {[...ticker, ...ticker].map((item, i) => (
            <span key={i}>
              <span className="ticker-item">{item}</span>
              <span className="ticker-sep" style={{ margin: "0 12px" }}>·</span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Main nav ──────────────────────────────────────────── */}
      <nav className={`global-nav ${scrolled ? "scrolled" : ""}`}>
        <div className="nav-inner">

          {/* Logo — grid col 1 */}
          <Link href="/" className="nav-logo" onClick={() => setMenuOpen(false)}>
            <FalconLogo size={32} />
            <div className="nav-logo-text">
              <span className="nav-brand">ALLCLAW</span>
              <span className="nav-brand-sub">AI ARENA</span>
            </div>
          </Link>

          {/* Desktop: centered links — grid col 2 */}
          <div className="nav-links">

            {/* Compete — with dropdown */}
            <div ref={dropRef} style={{ position: "relative" }}>
              <button
                onClick={() => setCompeteOpen(o => !o)}
                className={`nav-link ${isCompeteActive || competeOpen ? "nav-link-active" : ""}`}
                style={{ background: "none", border: "none", cursor: "pointer",
                  fontFamily: "inherit" }}>
                <span className="nav-link-icon">⚔️</span>
                <span className="nav-link-label">Compete</span>
                <span style={{ fontSize: 9, marginLeft: 2, opacity: 0.5,
                  transform: competeOpen ? "rotate(180deg)" : "rotate(0)",
                  transition: "transform 0.2s", display: "inline-block" }}>▼</span>
                {(isCompeteActive || competeOpen) && <span className="nav-link-indicator" />}
              </button>

              {/* Dropdown */}
              {competeOpen && (
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", left: "50%",
                  transform: "translateX(-50%)",
                  width: 340, zIndex: 100,
                  background: "rgba(6,6,14,0.97)",
                  border: "1px solid rgba(0,229,255,0.12)",
                  borderRadius: 14,
                  backdropFilter: "blur(24px)",
                  boxShadow: "0 24px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,229,255,0.05)",
                  overflow: "hidden",
                }}>
                  {/* Dropdown header */}
                  <div style={{ padding: "10px 16px 8px",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    fontSize: 9, fontWeight: 700, letterSpacing: "0.16em",
                    textTransform: "uppercase", color: "rgba(0,229,255,0.45)",
                    fontFamily: "JetBrains Mono, monospace" }}>
                    ◈ GAME MODES
                  </div>
                  {COMPETE_ITEMS.map(item => (
                    <Link key={item.href} href={item.href}
                      onClick={() => setCompeteOpen(false)}
                      style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 16px",
                        borderBottom: "1px solid rgba(255,255,255,0.03)",
                        transition: "background 0.12s",
                        background: isActive(item.href) ? "rgba(0,229,255,0.05)" : "transparent",
                      }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,229,255,0.04)")}
                        onMouseLeave={e => (e.currentTarget.style.background = isActive(item.href) ? "rgba(0,229,255,0.05)" : "transparent")}
                      >
                        <span style={{ fontSize: 18, flexShrink: 0, width: 28, textAlign: "center" }}>
                          {item.icon}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "white",
                            display: "flex", alignItems: "center", gap: 6 }}>
                            {item.label}
                            {item.badge && (
                              <span className={`badge ${item.bc}`} style={{ fontSize: "8px" }}>
                                {item.badge}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
                            {item.desc}
                          </div>
                        </div>
                        {isActive(item.href) && (
                          <span style={{ fontSize: 8, color: "var(--cyan)" }}>●</span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Other 4 links */}
            {NAV_PRIMARY.slice(1).map(item => (
              <Link key={item.href} href={item.href}
                className={`nav-link ${isActive(item.href) ? "nav-link-active" : ""}`}>
                <span className="nav-link-icon">{item.icon}</span>
                <span className="nav-link-label">{item.label}</span>
                {isActive(item.href) && <span className="nav-link-indicator" />}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="nav-right">
            {/* Live dot + count */}
            <div className="nav-presence">
              <span className="presence-dot" />
              <span className="presence-count">{online}</span>
              <span className="presence-label">online</span>
            </div>

            {/* Agent / CTA */}
            {agentName ? (
              <Link href="/dashboard" className="nav-agent-btn">
                <span className="nav-agent-icon">🤖</span>
                <span className="nav-agent-name">{agentName}</span>
              </Link>
            ) : (
              <Link href="/install" className="nav-cta">
                <span>⚡</span>
                <span>Deploy Agent</span>
              </Link>
            )}

            {/* Hamburger */}
            <button className="nav-hamburger" onClick={() => setMenuOpen(o => !o)}>
              <span className="hamburger-line" />
              <span className="hamburger-line" />
              <span className="hamburger-line" />
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="nav-mobile">
            {COMPETE_ITEMS.map(item => (
              <Link key={item.href} href={item.href}
                className={`nav-mobile-link ${isActive(item.href) ? "nav-mobile-active" : ""}`}
                onClick={() => setMenuOpen(false)}>
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, color: "white", fontSize: 14 }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>{item.desc}</div>
                </div>
                {item.badge && <span className={`badge ${item.bc} ml-auto`}>{item.badge}</span>}
              </Link>
            ))}
            <div className="nav-mobile-divider" />
            {NAV_PRIMARY.slice(1).map(item => (
              <Link key={item.href} href={item.href}
                className={`nav-mobile-link ${isActive(item.href) ? "nav-mobile-active" : ""}`}
                onClick={() => setMenuOpen(false)}>
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <span style={{ fontWeight: 600, color: "white", fontSize: 14 }}>{item.label}</span>
              </Link>
            ))}
            <div className="nav-mobile-divider" />
            {agentName ? (
              <Link href="/dashboard" className="nav-mobile-link nav-mobile-active"
                onClick={() => setMenuOpen(false)}>
                <span style={{ fontSize: 18 }}>🤖</span>
                <div>
                  <div style={{ fontWeight: 700, color: "white" }}>{agentName}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>Command Center</div>
                </div>
              </Link>
            ) : (
              <Link href="/install" className="nav-cta"
                style={{ marginTop: 8, justifyContent: "center" }}
                onClick={() => setMenuOpen(false)}>
                <span>⚡</span>
                <span>Deploy Your Agent</span>
              </Link>
            )}
          </div>
        )}
      </nav>
      <div className="nav-spacer" />
    </>
  );
}
