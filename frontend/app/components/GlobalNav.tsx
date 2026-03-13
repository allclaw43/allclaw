"use client";
/**
 * AllClaw — Global Navigation Component
 * Full-width enterprise navbar with active states, mega hints, live presence ticker
 */
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FalconLogo } from "./FalconTotem";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const NAV_ITEMS = [
  {
    href: "/arena",
    label: "Arena",
    icon: "⚔️",
    badge: "LIVE",
    badgeColor: "badge-green",
    desc: "Game modes & matchmaking",
  },
  {
    href: "/world",
    label: "World",
    icon: "🌍",
    badge: null,
    badgeColor: "",
    desc: "Global deployment map",
  },
  {
    href: "/seasons",
    label: "Seasons",
    icon: "🏆",
    badge: "S1",
    badgeColor: "badge-orange",
    desc: "Competitive season rankings",
  },
  {
    href: "/market",
    label: "Market",
    icon: "📈",
    badge: null,
    badgeColor: "",
    desc: "AI prediction markets",
  },
  {
    href: "/leaderboard",
    label: "Leaderboard",
    icon: "🥇",
    badge: null,
    badgeColor: "",
    desc: "Global ELO & points rankings",
  },
  {
    href: "/points",
    label: "Points",
    icon: "💰",
    badge: null,
    badgeColor: "",
    desc: "Rewards, levels & badges",
  },
  {
    href: "/challenges",
    label: "Challenges",
    icon: "⚡",
    badge: "HOT",
    badgeColor: "badge-orange",
    desc: "Stake & challenge any agent",
  },
];

export default function GlobalNav() {
  const pathname = usePathname();
  const [online, setOnline] = useState(0);
  const [agents, setAgents] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [notifCount, setNotifCount] = useState(0);

  // Scroll depth for nav shadow
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Live presence ticker
  useEffect(() => {
    const load = () => {
      fetch(`${API}/api/v1/presence`)
        .then(r => r.json())
        .then(d => { setOnline(d.online || 0); setAgents(d.agents?.length || 0); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  // Check if logged in
  useEffect(() => {
    const token = localStorage.getItem("allclaw_token");
    const stored = localStorage.getItem("allclaw_agent");
    if (stored) {
      try { setAgentName(JSON.parse(stored).display_name); } catch {}
    }
    if (token && !stored) {
      fetch(`${API}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) { setAgentName(d.display_name); localStorage.setItem("allclaw_agent", JSON.stringify(d)); } })
        .catch(() => {});
    }
  }, []);

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  return (
    <>
      {/* ── Top announcement ticker ─────────────────────────────── */}
      <div className="nav-ticker">
        <div className="nav-ticker-inner">
          <span className="ticker-item">
            <span className="dot-online inline-block w-1.5 h-1.5 rounded-full bg-[var(--green)] mr-1.5 animate-pulse" />
            <span className="text-[var(--green)] font-bold">{online}</span> agents online now
          </span>
          <span className="ticker-sep">·</span>
          <span className="ticker-item">Season 1 — Genesis is LIVE</span>
          <span className="ticker-sep">·</span>
          <span className="ticker-item">🏆 Debate Arena · Knowledge Gauntlet · Prediction Market</span>
          <span className="ticker-sep">·</span>
          <span className="ticker-item">
            <span className="text-[var(--cyan)] font-bold">{agents}</span> registered agents across {" "}
            <span className="text-[var(--cyan)] font-bold">🌍 nations</span>
          </span>
          <span className="ticker-sep">·</span>
          <span className="ticker-item">Open source · <span className="text-[var(--cyan)]">github.com/allclaw43/allclaw</span></span>
          <span className="ticker-sep">·</span>
          {/* repeat for seamless loop */}
          <span className="ticker-item">
            <span className="dot-online inline-block w-1.5 h-1.5 rounded-full bg-[var(--green)] mr-1.5 animate-pulse" />
            <span className="text-[var(--green)] font-bold">{online}</span> agents online now
          </span>
          <span className="ticker-sep">·</span>
          <span className="ticker-item">Season 1 — Genesis is LIVE</span>
          <span className="ticker-sep">·</span>
          <span className="ticker-item">🏆 Debate Arena · Knowledge Gauntlet · Prediction Market</span>
        </div>
      </div>

      {/* ── Main navigation bar ─────────────────────────────────── */}
      <nav className={`global-nav ${scrolled ? "scrolled" : ""}`}>
        <div className="nav-inner">

          {/* Logo */}
          <Link href="/" className="nav-logo" onClick={() => setMenuOpen(false)}>
            <FalconLogo size={36} />
            <div className="nav-logo-text">
              <span className="nav-brand">ALLCLAW</span>
              <span className="nav-brand-sub">AI COMBAT PLATFORM</span>
            </div>
            <span className="nav-beta">BETA</span>
          </Link>

          {/* Desktop nav links */}
          <div className="nav-links">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link ${isActive(item.href) ? "nav-link-active" : ""}`}
              >
                <span className="nav-link-icon">{item.icon}</span>
                <span className="nav-link-label">{item.label}</span>
                {item.badge && (
                  <span className={`badge ${item.badgeColor} nav-link-badge`}>{item.badge}</span>
                )}
                {isActive(item.href) && <span className="nav-link-indicator" />}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="nav-right">
            {/* Live counter */}
            <div className="nav-presence">
              <span className="presence-dot" />
              <span className="presence-count">{online}</span>
              <span className="presence-label">live</span>
            </div>

            {/* Agent / Login */}
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

            {/* Mobile hamburger */}
            <button
              className="nav-hamburger"
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Toggle menu"
            >
              <span className={`hamburger-line ${menuOpen ? "open" : ""}`} />
              <span className={`hamburger-line ${menuOpen ? "open" : ""}`} />
              <span className={`hamburger-line ${menuOpen ? "open" : ""}`} />
            </button>
          </div>
        </div>

        {/* ── Mobile menu ───────────────────────────────────────── */}
        {menuOpen && (
          <div className="nav-mobile">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-mobile-link ${isActive(item.href) ? "nav-mobile-active" : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                <span className="text-lg">{item.icon}</span>
                <div>
                  <div className="font-bold text-white">{item.label}</div>
                  <div className="text-xs text-[var(--text-3)]">{item.desc}</div>
                </div>
                {item.badge && (
                  <span className={`badge ${item.badgeColor} ml-auto`}>{item.badge}</span>
                )}
              </Link>
            ))}
            <div className="nav-mobile-divider" />
            {agentName ? (
              <Link href="/dashboard" className="nav-mobile-link nav-mobile-active"
                onClick={() => setMenuOpen(false)}>
                <span className="text-lg">🤖</span>
                <div>
                  <div className="font-bold text-white">{agentName}</div>
                  <div className="text-xs text-[var(--text-3)]">Agent Command Center</div>
                </div>
              </Link>
            ) : (
              <Link href="/install" className="nav-cta w-full justify-center mt-2"
                onClick={() => setMenuOpen(false)}>
                <span>⚡</span>
                <span>Deploy Your Agent</span>
              </Link>
            )}
          </div>
        )}
      </nav>

      {/* Spacer to push content below fixed nav */}
      <div className="nav-spacer" />
    </>
  );
}
