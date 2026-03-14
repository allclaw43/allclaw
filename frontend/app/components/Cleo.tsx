"use client";
/**
 * CLEO — AllClaw Mascot Family
 *
 * Design principles:
 *   Disney: huge eyes (40% face), expressive blink, dual catchlights
 *   Line Friends / Kakao: geometric flat shapes, bold outlines
 *   Pokemon: one core concept → contrast (soft body × mechanical detail)
 *   LVMH rule: one warm accent in a cold palette (beak = #ffd60a)
 *
 * Colour variants — 6 characters, each a different model archetype:
 *   cyan    (default) — Claude / Anthropic  — calm, thoughtful
 *   purple  — GPT / OpenAI                  — mystical, powerful
 *   green   — Gemini / Google               — energetic, curious
 *   orange  — DeepSeek / Qwen               — fierce, bold
 *   pink    — Llama / Meta                  — friendly, playful
 *   gold    — Apex Legend                   — legendary, radiant
 */

import { useEffect, useRef, useState } from "react";

export type CleoColor = "cyan" | "purple" | "green" | "orange" | "pink" | "gold";
export type CleoMood  = "default" | "thinking" | "celebrate" | "idle";

const COLOR_MAP: Record<CleoColor, { main: string; dim: string; body: string; bodyHi: string }> = {
  cyan:   { main: "#00e5ff", dim: "rgba(0,229,255,0.15)",   body: "#1a1a2e", bodyHi: "#2a2a4a" },
  purple: { main: "#a78bfa", dim: "rgba(167,139,250,0.15)", body: "#1a102e", bodyHi: "#2a1a4a" },
  green:  { main: "#34d399", dim: "rgba(52,211,153,0.15)",  body: "#0e2218", bodyHi: "#1a3a2a" },
  orange: { main: "#f97316", dim: "rgba(249,115,22,0.15)",  body: "#2a1208", bodyHi: "#3a1e0e" },
  pink:   { main: "#f472b6", dim: "rgba(244,114,182,0.15)", body: "#2a1228", bodyHi: "#3a1a3a" },
  gold:   { main: "#ffd60a", dim: "rgba(255,214,10,0.15)",  body: "#1e1800", bodyHi: "#2e2400" },
};

interface CleoProps {
  size?: number;
  color?: CleoColor;
  mood?: CleoMood;
  animated?: boolean;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
}

export default function Cleo({
  size = 120,
  color = "cyan",
  mood = "default",
  animated = true,
  className = "",
  style,
  label,
}: CleoProps) {
  const [blink, setBlink] = useState(false);
  const [scan,  setScan]  = useState(0);
  const [bob,   setBob]   = useState(false);

  const palette = COLOR_MAP[color];
  const accent  = palette.main;

  // Blink — random 2–5s
  useEffect(() => {
    if (!animated) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlink(true);
        setTimeout(() => { setBlink(false); schedule(); }, 130);
      }, 2200 + Math.random() * 3000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [animated]);

  // Scanline — always ticking
  useEffect(() => {
    if (!animated) return;
    const id = setInterval(() => setScan(s => (s + 1) % 12), 75);
    return () => clearInterval(id);
  }, [animated]);

  // Bob / float
  useEffect(() => {
    if (!animated) return;
    const id = setInterval(() => setBob(b => !b), 1800);
    return () => clearInterval(id);
  }, [animated]);

  const eyeH  = blink ? 0.5 : 13;
  const eyeGlow = mood === "celebrate" ? "#ffd60a"
                : mood === "thinking"  ? accent
                : accent;

  const bobY = animated ? (bob ? -3 : 3) : 0;
  const tiltD = mood === "thinking" ? -7 : 0;

  const id = `cleo-${color}-${Math.random().toString(36).slice(2, 6)}`;

  return (
    <div className={className} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4, ...style }}>
      <svg
        viewBox="0 0 100 108"
        width={size}
        height={size * 1.08}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          transform: `translateY(${bobY}px) rotate(${tiltD}deg)`,
          transition: "transform 1.8s cubic-bezier(.45,.05,.55,.95)",
          filter: `drop-shadow(0 4px 16px ${palette.dim})`,
        }}
      >
        <defs>
          <radialGradient id={`bg-${id}`} cx="40%" cy="30%" r="70%">
            <stop offset="0%"   stopColor={palette.bodyHi}/>
            <stop offset="100%" stopColor={palette.body}/>
          </radialGradient>
          <radialGradient id={`belly-${id}`} cx="50%" cy="40%" r="55%">
            <stop offset="0%"   stopColor={palette.bodyHi} stopOpacity="0.8"/>
            <stop offset="100%" stopColor={palette.bodyHi} stopOpacity="0"/>
          </radialGradient>
          <radialGradient id={`eL-${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={eyeGlow}/>
            <stop offset="100%" stopColor={eyeGlow} stopOpacity="0"/>
          </radialGradient>
          <filter id={`glow-${id}`}>
            <feGaussianBlur stdDeviation="1.8" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id={`soft-${id}`}>
            <feGaussianBlur stdDeviation="0.8" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <clipPath id={`cl-${id}`}><ellipse cx="36" cy="42" rx="9" ry={eyeH / 2 + 1}/></clipPath>
          <clipPath id={`cr-${id}`}><ellipse cx="64" cy="42" rx="9" ry={eyeH / 2 + 1}/></clipPath>
        </defs>

        {/* ── Shadow ── */}
        <ellipse cx="50" cy="104" rx="20" ry="3" fill="rgba(0,0,0,0.4)"/>

        {/* ── Tail feathers ── */}
        {[38, 50, 62].map((x, i) => (
          <path key={i}
            d={`M ${x} 88 Q ${x + (i-1)*3} 97 ${x + (i-1)*5} 100 Q ${x} 94 ${x + (i===1?0:(i===0?-3:3))} 91 Z`}
            fill={palette.body}
            stroke={`${accent}30`} strokeWidth="0.5"/>
        ))}

        {/* ── Wings folded/spread ── */}
        {mood === "celebrate" ? (
          <>
            {/* Left spread */}
            <path d="M 28 55 Q 5 35 4 18 Q 12 28 18 35 Q 8 23 15 15 Q 21 25 25 34 Q 17 22 25 16 Q 29 28 28 42 Z"
              fill={`url(#bg-${id})`} stroke={`${accent}40`} strokeWidth="0.8"/>
            <path d="M 18 26 L 24 38 M 14 22 L 22 32"
              stroke={`${accent}50`} strokeWidth="0.7"/>
            {/* Right spread */}
            <path d="M 72 55 Q 95 35 96 18 Q 88 28 82 35 Q 92 23 85 15 Q 79 25 75 34 Q 83 22 75 16 Q 71 28 72 42 Z"
              fill={`url(#bg-${id})`} stroke={`${accent}40`} strokeWidth="0.8"/>
            <path d="M 82 26 L 76 38 M 86 22 L 78 32"
              stroke={`${accent}50`} strokeWidth="0.7"/>
          </>
        ) : (
          <>
            {/* Left folded */}
            <path d="M 30 56 Q 18 52 17 43 Q 20 49 24 51 Q 15 44 20 36 Q 24 43 28 48 Q 21 39 28 33 Q 30 41 30 51 Z"
              fill={`url(#bg-${id})`} stroke={`${accent}30`} strokeWidth="0.7"/>
            <path d="M 21 44 L 27 49 M 19 40 L 26 45"
              stroke={`${accent}35`} strokeWidth="0.5"/>
            <circle cx="18" cy="38" r="1.1" fill={accent} opacity="0.65" filter={`url(#soft-${id})`}/>
            {/* Right folded */}
            <path d="M 70 56 Q 82 52 83 43 Q 80 49 76 51 Q 85 44 80 36 Q 76 43 72 48 Q 79 39 72 33 Q 70 41 70 51 Z"
              fill={`url(#bg-${id})`} stroke={`${accent}30`} strokeWidth="0.7"/>
            <path d="M 79 44 L 73 49 M 81 40 L 74 45"
              stroke={`${accent}35`} strokeWidth="0.5"/>
            <circle cx="82" cy="38" r="1.1" fill={accent} opacity="0.65" filter={`url(#soft-${id})`}/>
          </>
        )}

        {/* ── Body ── */}
        <ellipse cx="50" cy="66" rx="21" ry="25"
          fill={`url(#bg-${id})`}
          stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>
        <ellipse cx="50" cy="64" rx="13" ry="17"
          fill={`url(#belly-${id})`}/>
        {/* Circuit lines */}
        <path d="M 40 58 Q 50 55 60 58"
          stroke={`${accent}18`} strokeWidth="0.5" fill="none"/>
        {/* Chest hex */}
        <path d="M 50 71 L 53.5 73.8 L 53.5 79.2 L 50 82 L 46.5 79.2 L 46.5 73.8 Z"
          fill="none" stroke={`${accent}50`} strokeWidth="0.7"/>
        <circle cx="50" cy="76.5" r="1.5" fill={accent} opacity="0.85"
          filter={`url(#soft-${id})`}/>

        {/* ── Head ── */}
        <circle cx="50" cy="38" r="27"
          fill={`url(#bg-${id})`}
          stroke="rgba(255,255,255,0.06)" strokeWidth="0.5"/>
        {/* Head sheen */}
        <ellipse cx="43" cy="22" rx="11" ry="6"
          fill="rgba(255,255,255,0.04)"
          transform="rotate(-18,43,22)"/>

        {/* ── Ear tufts ── */}
        <path d="M 29 19 L 24 8  L 29 13 L 27 5 L 33 12 L 31 18 Z"
          fill={palette.body} stroke={`${accent}40`} strokeWidth="0.7"/>
        <circle cx="25" cy="6" r="1.1" fill={accent} opacity="0.7"
          filter={`url(#soft-${id})`}/>
        <path d="M 71 19 L 76 8  L 71 13 L 73 5 L 67 12 L 69 18 Z"
          fill={palette.body} stroke={`${accent}40`} strokeWidth="0.7"/>
        <circle cx="75" cy="6" r="1.1" fill={accent} opacity="0.7"
          filter={`url(#soft-${id})`}/>

        {/* ── Eyes ── */}
        {(["L","R"] as const).map(side => {
          const cx = side === "L" ? 36 : 64;
          const clipId = side === "L" ? `cl-${id}` : `cr-${id}`;
          const catchX = side === "L" ? 33 : 61;
          return (
            <g key={side}>
              {/* Ambient halo */}
              <ellipse cx={cx} cy={42} rx={13} ry={13}
                fill={eyeGlow} opacity="0.06" filter={`url(#glow-${id})`}/>
              {/* Socket */}
              <ellipse cx={cx} cy={42} rx={9} ry={Math.max(0.8, eyeH/2)}
                fill="#070712"/>
              {/* Iris */}
              {!blink && <>
                <ellipse cx={cx} cy={42} rx={7.5} ry={Math.max(0.4, eyeH/2-1)}
                  fill={eyeGlow} opacity="0.92"/>
                {/* Scan line */}
                <ellipse
                  cx={cx}
                  cy={42 - eyeH/4 + (scan/12) * (eyeH/2)}
                  rx={7} ry={0.9}
                  fill="rgba(255,255,255,0.3)"
                  clipPath={`url(#${clipId})`}/>
                {/* Pupil */}
                <ellipse cx={cx} cy={42} rx={2.8} ry={Math.max(0.3, eyeH/4)}
                  fill="#050510"/>
                {/* Catchlights — Disney magic */}
                <ellipse cx={catchX} cy={42 - eyeH/5} rx={1.8} ry={1.3}
                  fill="white" opacity="0.88"/>
                <circle cx={cx+2} cy={42 + eyeH/5} r={0.7}
                  fill="white" opacity="0.4"/>
              </>}
              {/* Outline */}
              <ellipse cx={cx} cy={42} rx={9} ry={Math.max(0.8, eyeH/2)}
                fill="none" stroke={eyeGlow} strokeWidth="1.3" opacity="0.85"/>
            </g>
          );
        })}

        {/* ── Beak ── */}
        <path d="M 47 52 Q 50 50 53 52 Q 52 56 50 57.5 Q 48 56 47 52 Z"
          fill="#ffd60a" stroke="#d4a800" strokeWidth="0.4"/>
        <path d="M 50 57.5 Q 51 59.5 50 60.5 Q 49 59.5 50 57.5 Z"
          fill="#c89200"/>
        <circle cx="48.5" cy="53.5" r="0.5" fill="#a8780080"/>
        <circle cx="51.5" cy="53.5" r="0.5" fill="#a8780080"/>

        {/* ── Mood extras ── */}
        {mood === "thinking" && (
          <text x={77} y={20} fontSize={11} fill={accent}
            fontFamily="Space Grotesk, sans-serif" fontWeight="800"
            filter={`url(#soft-${id})`} opacity="0.9">?</text>
        )}

        {mood === "celebrate" && (
          <g filter={`url(#soft-${id})`}>
            {[0,60,120,180,240,300].map((deg, i) => {
              const a = (deg * Math.PI) / 180;
              const r = 9 + (i % 2) * 5;
              return (
                <line key={i}
                  x1={50 + (r-2) * 1.7 * Math.cos(a)}
                  y1={16 + (r-2) * Math.sin(a)}
                  x2={50 + (r+2) * 1.7 * Math.cos(a)}
                  y2={16 + (r+2) * Math.sin(a)}
                  stroke={i % 2 === 0 ? "#ffd60a" : accent}
                  strokeWidth="1.4" strokeLinecap="round"/>
              );
            })}
            <circle cx="50" cy="16" r="2.8" fill="#ffd60a" opacity="0.95"/>
          </g>
        )}

        {mood === "idle" && (
          /* Zzz floating */
          <text x={77} y={22} fontSize={9} fill={accent}
            fontFamily="JetBrains Mono, monospace" fontWeight="700"
            filter={`url(#soft-${id})`} opacity="0.6">z</text>
        )}

        {/* ── Feet ── */}
        {mood === "idle" ? (
          <g>
            {/* Standing left */}
            <path d="M 43 91 L 41 97 M 43 91 L 43 97 M 43 91 L 45 97"
              stroke={`${accent}70`} strokeWidth="1.2" strokeLinecap="round"/>
            <path d="M 43 97 L 37 99 M 43 97 L 43 100 M 43 97 L 49 99"
              stroke={`${accent}60`} strokeWidth="1" strokeLinecap="round"/>
            {/* Right foot raised */}
            <path d="M 57 91 L 59 85 M 59 85 L 57 82 M 59 85 L 61 82"
              stroke={`${accent}45`} strokeWidth="1.1" strokeLinecap="round"/>
          </g>
        ) : (
          <g>
            {[43,57].map(x => (
              <g key={x}>
                <path d={`M ${x} 91 L ${x-2} 97 M ${x} 91 L ${x} 97 M ${x} 91 L ${x+2} 97`}
                  stroke={`${accent}70`} strokeWidth="1.2" strokeLinecap="round"/>
                <path d={`M ${x} 97 L ${x-6} 99 M ${x} 97 L ${x} 100 M ${x} 97 L ${x+6} 99`}
                  stroke={`${accent}60`} strokeWidth="1" strokeLinecap="round"/>
              </g>
            ))}
          </g>
        )}

      </svg>

      {/* Optional name label */}
      {label && (
        <div style={{
          fontSize: Math.max(9, size * 0.09),
          fontWeight: 700,
          color: accent,
          fontFamily: "JetBrains Mono, monospace",
          letterSpacing: "0.08em",
          textAlign: "center",
          textShadow: `0 0 10px ${palette.dim}`,
        }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ─── FloatingCleo with CSS float animation ───────────────────────
export function FloatingCleo({
  color = "cyan",
  size  = 120,
  mood  = "default",
  delay = 0,
  ...props
}: CleoProps & { delay?: number }) {
  return (
    <div style={{
      animation: `float-soft ${3.5 + (["cyan","purple","green","orange","pink","gold"].indexOf(color)) * 0.3}s ease-in-out infinite`,
      animationDelay: `${delay}s`,
      display: "inline-block",
    }}>
      <Cleo color={color} size={size} mood={mood} {...props}/>
    </div>
  );
}

// ─── CleoBattle — 6 Cleos in a row for homepage ─────────────────
export function CleoBattle({ size = 80 }: { size?: number }) {
  const LINEUP: { color: CleoColor; label: string; mood: CleoMood; delay: number }[] = [
    { color: "cyan",   label: "Iris",   mood: "thinking",  delay: 0   },
    { color: "purple", label: "Nova",    mood: "default",   delay: 0.4 },
    { color: "green",  label: "Echo",    mood: "celebrate", delay: 0.8 },
    { color: "orange", label: "Rex",     mood: "default",   delay: 1.2 },
    { color: "pink",   label: "Pixel",   mood: "idle",      delay: 1.6 },
    { color: "gold",   label: "Apex",    mood: "celebrate", delay: 2.0 },
  ];

  return (
    <div style={{
      display: "flex",
      alignItems: "flex-end",
      gap: size * 0.15,
      justifyContent: "center",
      flexWrap: "wrap",
    }}>
      {LINEUP.map(({ color, label, mood, delay }) => (
        <FloatingCleo
          key={color}
          color={color}
          label={label}
          mood={mood}
          size={size}
          delay={delay}
        />
      ))}
    </div>
  );
}
