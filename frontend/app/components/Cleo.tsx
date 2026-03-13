"use client";
/**
 * CLEO — AllClaw's Mascot
 *
 * A cyber-mechanical falcon chick.
 * Design philosophy:
 *   • Disney rule: eyes are 40% of the face (emotion lives in the eyes)
 *   • Kakao/Line rule: flat geometry, bold outlines, no gradients in core shapes
 *   • The contrast: soft round body × hard mechanical wing panels × glowing data eyes
 *   • Color: body = deep navy #1a1a2e, accents = brand cyan #00e5ff, 
 *             beak = warm amber #ffd60a (the one warm touch in a cold palette)
 *
 * Variants:
 *   default  — standing, neutral, wings folded
 *   thinking — head tilted, one wing raised, scan-line eyes active  
 *   celebrate — wings spread, stars burst, eyes wide
 *   idle     — eyes half-closed, one foot raised (resting)
 *
 * "CLEO" = Cognitive Learning Entity Omega
 * But officially, it's just a name. Cleo.
 */

import { useEffect, useRef, useState } from "react";

type CleoMood = "default" | "thinking" | "celebrate" | "idle";

interface CleoProps {
  size?: number;
  mood?: CleoMood;
  animated?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function Cleo({
  size = 120,
  mood = "default",
  animated = true,
  className = "",
  style,
}: CleoProps) {
  const [blink, setBlink]     = useState(false);
  const [scanLine, setScan]   = useState(0);
  const [bounce, setBounce]   = useState(false);

  // Blink randomly every 2–5 seconds
  useEffect(() => {
    if (!animated) return;
    const doBlink = () => {
      setBlink(true);
      setTimeout(() => setBlink(false), 120);
      setTimeout(doBlink, 2000 + Math.random() * 3000);
    };
    const t = setTimeout(doBlink, 1500);
    return () => clearTimeout(t);
  }, [animated]);

  // Scan-line in eyes (thinking / celebrate)
  useEffect(() => {
    if (!animated || mood === "idle") return;
    const t = setInterval(() => {
      setScan(s => (s + 1) % 10);
    }, 80);
    return () => clearInterval(t);
  }, [animated, mood]);

  // Bounce on celebrate
  useEffect(() => {
    if (mood !== "celebrate" || !animated) return;
    const t = setInterval(() => {
      setBounce(b => !b);
    }, 400);
    return () => clearInterval(t);
  }, [mood, animated]);

  const S    = size / 100;   // scale to 100-unit grid
  const eyeH = blink ? 1 : 14; // eye height — collapses on blink

  // Eye colour by mood
  const eyeGlow = mood === "celebrate" ? "#ffd60a"
                : mood === "thinking"  ? "#a78bfa"
                : "#00e5ff";

  const bodyTilt = mood === "thinking" ? "rotate(-6deg)"
                 : bounce             ? "translateY(-4px) rotate(2deg)"
                 : "none";

  return (
    <div
      className={className}
      style={{
        display: "inline-block",
        width: size, height: size * 1.05,
        position: "relative",
        transform: bodyTilt,
        transition: "transform 0.3s cubic-bezier(.34,1.56,.64,1)",
        ...style,
      }}
    >
      <svg
        viewBox="0 0 100 105"
        width={size}
        height={size * 1.05}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Body gradient */}
          <radialGradient id="bodyGrad" cx="45%" cy="35%" r="65%">
            <stop offset="0%"   stopColor="#2a2a4a"/>
            <stop offset="100%" stopColor="#0e0e22"/>
          </radialGradient>

          {/* Eye glow */}
          <radialGradient id="eyeGlowL" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={eyeGlow} stopOpacity="1"/>
            <stop offset="60%"  stopColor={eyeGlow} stopOpacity="0.6"/>
            <stop offset="100%" stopColor={eyeGlow} stopOpacity="0"/>
          </radialGradient>
          <radialGradient id="eyeGlowR" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={eyeGlow} stopOpacity="1"/>
            <stop offset="60%"  stopColor={eyeGlow} stopOpacity="0.6"/>
            <stop offset="100%" stopColor={eyeGlow} stopOpacity="0"/>
          </radialGradient>

          {/* Wing shimmer */}
          <linearGradient id="wingL" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#1a2a4a"/>
            <stop offset="50%"  stopColor="#0e1a32"/>
            <stop offset="100%" stopColor="#0a0a1e"/>
          </linearGradient>
          <linearGradient id="wingR" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"   stopColor="#1a2a4a"/>
            <stop offset="50%"  stopColor="#0e1a32"/>
            <stop offset="100%" stopColor="#0a0a1e"/>
          </linearGradient>

          {/* Belly lighter patch */}
          <radialGradient id="bellyGrad" cx="50%" cy="40%" r="55%">
            <stop offset="0%"   stopColor="#2e2e5e" stopOpacity="0.9"/>
            <stop offset="100%" stopColor="#1a1a3a" stopOpacity="0"/>
          </radialGradient>

          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>

          <filter id="softGlow">
            <feGaussianBlur stdDeviation="1.2" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>

          <clipPath id="eyeClipL">
            <ellipse cx="36" cy="42" rx="9" ry={eyeH / 2 + 1}/>
          </clipPath>
          <clipPath id="eyeClipR">
            <ellipse cx="64" cy="42" rx="9" ry={eyeH / 2 + 1}/>
          </clipPath>
        </defs>

        {/* ── SHADOW ─────────────────────────────────────────── */}
        <ellipse cx="50" cy="102" rx="22" ry="3.5"
          fill="rgba(0,0,0,0.5)" opacity="0.6"/>

        {/* ── TAIL FEATHERS ──────────────────────────────────── */}
        <path d="M 38 88 Q 36 96 32 98 Q 36 94 40 92 Z"
          fill="#0e1428" stroke="rgba(0,229,255,0.2)" strokeWidth="0.5"/>
        <path d="M 50 90 Q 50 99 50 102 Q 51 98 52 90 Z"
          fill="#0e1428" stroke="rgba(0,229,255,0.25)" strokeWidth="0.5"/>
        <path d="M 62 88 Q 64 96 68 98 Q 64 94 60 92 Z"
          fill="#0e1428" stroke="rgba(0,229,255,0.2)" strokeWidth="0.5"/>

        {/* ── LEFT WING ──────────────────────────────────────── */}
        {mood === "celebrate" ? (
          // Spread wing (celebrate)
          <g>
            <path d="M 28 55 Q 8 38 6 22 Q 14 32 20 38 Q 10 26 16 18 Q 22 28 26 36 Q 18 24 26 18 Q 30 30 30 40 Q 28 48 28 55 Z"
              fill="url(#wingL)" stroke="rgba(0,229,255,0.35)" strokeWidth="0.8"/>
            {/* Wing circuit lines */}
            <path d="M 20 30 L 25 40" stroke="rgba(0,229,255,0.4)" strokeWidth="0.6"/>
            <path d="M 16 26 L 23 36" stroke="rgba(0,229,255,0.3)" strokeWidth="0.5"/>
          </g>
        ) : (
          // Folded wing
          <g>
            <path d="M 30 55 Q 20 52 18 45 Q 20 50 24 52 Q 16 46 20 38 Q 24 44 28 48 Q 22 40 28 35 Q 30 42 30 50 Z"
              fill="url(#wingL)" stroke="rgba(0,229,255,0.25)" strokeWidth="0.8"/>
            {/* Wing panel lines — mechanical detail */}
            <path d="M 22 45 L 28 50" stroke="rgba(0,229,255,0.3)" strokeWidth="0.5"/>
            <path d="M 20 41 L 27 46" stroke="rgba(0,229,255,0.25)" strokeWidth="0.4"/>
            {/* Wing tip glow node */}
            <circle cx="19" cy="40" r="1.2" fill={eyeGlow} opacity="0.7"
              filter="url(#softGlow)"/>
          </g>
        )}

        {/* ── RIGHT WING ─────────────────────────────────────── */}
        {mood === "celebrate" ? (
          <g>
            <path d="M 72 55 Q 92 38 94 22 Q 86 32 80 38 Q 90 26 84 18 Q 78 28 74 36 Q 82 24 74 18 Q 70 30 70 40 Q 72 48 72 55 Z"
              fill="url(#wingR)" stroke="rgba(0,229,255,0.35)" strokeWidth="0.8"/>
            <path d="M 80 30 L 75 40" stroke="rgba(0,229,255,0.4)" strokeWidth="0.6"/>
            <path d="M 84 26 L 77 36" stroke="rgba(0,229,255,0.3)" strokeWidth="0.5"/>
          </g>
        ) : (
          <g>
            <path d="M 70 55 Q 80 52 82 45 Q 80 50 76 52 Q 84 46 80 38 Q 76 44 72 48 Q 78 40 72 35 Q 70 42 70 50 Z"
              fill="url(#wingR)" stroke="rgba(0,229,255,0.25)" strokeWidth="0.8"/>
            <path d="M 78 45 L 72 50" stroke="rgba(0,229,255,0.3)" strokeWidth="0.5"/>
            <path d="M 80 41 L 73 46" stroke="rgba(0,229,255,0.25)" strokeWidth="0.4"/>
            <circle cx="81" cy="40" r="1.2" fill={eyeGlow} opacity="0.7"
              filter="url(#softGlow)"/>
          </g>
        )}

        {/* ── BODY ───────────────────────────────────────────── */}
        {/* Main body — teardrop/egg shape */}
        <ellipse cx="50" cy="65" rx="22" ry="26"
          fill="url(#bodyGrad)"
          stroke="rgba(255,255,255,0.06)" strokeWidth="0.5"/>

        {/* Belly lighter patch */}
        <ellipse cx="50" cy="64" rx="14" ry="18"
          fill="url(#bellyGrad)"/>

        {/* Body circuit line details — mechanical texture */}
        <path d="M 40 58 Q 45 54 50 55 Q 55 54 60 58"
          stroke="rgba(0,229,255,0.15)" strokeWidth="0.5" fill="none"/>
        <path d="M 42 65 Q 50 62 58 65"
          stroke="rgba(0,229,255,0.1)" strokeWidth="0.4" fill="none"/>

        {/* Chest hex emblem */}
        <path d="M 50 70 L 53 72.6 L 53 77.4 L 50 80 L 47 77.4 L 47 72.6 Z"
          fill="none" stroke="rgba(0,229,255,0.4)" strokeWidth="0.7"/>
        <circle cx="50" cy="75" r="1.5"
          fill={eyeGlow} opacity="0.8" filter="url(#softGlow)"/>

        {/* ── HEAD ───────────────────────────────────────────── */}
        {/* Head — larger circle for big-head kawaii proportion */}
        <circle cx="50" cy="38" r="26"
          fill="url(#bodyGrad)"
          stroke="rgba(255,255,255,0.07)" strokeWidth="0.5"/>

        {/* Head sheen — top highlight */}
        <ellipse cx="44" cy="24" rx="10" ry="6"
          fill="rgba(255,255,255,0.04)" transform="rotate(-15, 44, 24)"/>

        {/* ── EARS / FEATHER TUFTS ───────────────────────────── */}
        {/* Left ear tuft — two pointed feathers */}
        <path d="M 30 20 L 26 10 L 30 14 L 28 6 L 33 13 L 31 18 Z"
          fill="#1a1a3a" stroke="rgba(0,229,255,0.3)" strokeWidth="0.6"/>
        <circle cx="27" cy="8" r="1" fill={eyeGlow} opacity="0.6"
          filter="url(#softGlow)"/>

        {/* Right ear tuft */}
        <path d="M 70 20 L 74 10 L 70 14 L 72 6 L 67 13 L 69 18 Z"
          fill="#1a1a3a" stroke="rgba(0,229,255,0.3)" strokeWidth="0.6"/>
        <circle cx="73" cy="8" r="1" fill={eyeGlow} opacity="0.6"
          filter="url(#softGlow)"/>

        {/* ── EYES ───────────────────────────────────────────── */}
        {/* LEFT EYE */}
        {/* Outer glow halo */}
        <ellipse cx="36" cy="42" rx="12" ry="12"
          fill={eyeGlow} opacity="0.07" filter="url(#glow)"/>

        {/* Eye socket — dark background */}
        <ellipse cx="36" cy="42" rx="9" ry={Math.max(1, eyeH / 2)}
          fill="#080818"/>

        {/* Iris */}
        {!blink && (
          <>
            <ellipse cx="36" cy="42" rx="7.5" ry={Math.max(0.5, eyeH / 2 - 1)}
              fill={eyeGlow} opacity="0.9"/>
            {/* Scan line animation */}
            <ellipse cx="36" cy={42 - eyeH / 4 + (scanLine / 10) * (eyeH / 2)}
              rx="7" ry="0.8"
              fill="rgba(255,255,255,0.25)" opacity={mood === "thinking" || mood === "celebrate" ? 0.9 : 0.3}
              clipPath="url(#eyeClipL)"/>
            {/* Pupil */}
            <ellipse cx="36" cy="42" rx="3" ry={Math.max(0.3, eyeH / 4)}
              fill="#060614"/>
            {/* Catchlight — Disney magic */}
            <ellipse cx="33" cy={42 - eyeH / 5} rx="1.8" ry="1.2"
              fill="white" opacity="0.85"/>
            <circle cx="38" cy={42 + eyeH / 6} r="0.7"
              fill="white" opacity="0.4"/>
          </>
        )}

        {/* Eye outline */}
        <ellipse cx="36" cy="42" rx="9" ry={Math.max(1, eyeH / 2)}
          fill="none" stroke={eyeGlow} strokeWidth="1.2" opacity="0.8"/>

        {/* RIGHT EYE — mirror */}
        <ellipse cx="64" cy="42" rx="12" ry="12"
          fill={eyeGlow} opacity="0.07" filter="url(#glow)"/>

        <ellipse cx="64" cy="42" rx="9" ry={Math.max(1, eyeH / 2)}
          fill="#080818"/>

        {!blink && (
          <>
            <ellipse cx="64" cy="42" rx="7.5" ry={Math.max(0.5, eyeH / 2 - 1)}
              fill={eyeGlow} opacity="0.9"/>
            <ellipse cx="64" cy={42 - eyeH / 4 + (scanLine / 10) * (eyeH / 2)}
              rx="7" ry="0.8"
              fill="rgba(255,255,255,0.25)" opacity={mood === "thinking" || mood === "celebrate" ? 0.9 : 0.3}
              clipPath="url(#eyeClipR)"/>
            <ellipse cx="64" cy="42" rx="3" ry={Math.max(0.3, eyeH / 4)}
              fill="#060614"/>
            <ellipse cx="61" cy={42 - eyeH / 5} rx="1.8" ry="1.2"
              fill="white" opacity="0.85"/>
            <circle cx="66" cy={42 + eyeH / 6} r="0.7"
              fill="white" opacity="0.4"/>
          </>
        )}
        <ellipse cx="64" cy="42" rx="9" ry={Math.max(1, eyeH / 2)}
          fill="none" stroke={eyeGlow} strokeWidth="1.2" opacity="0.8"/>

        {/* ── BEAK ───────────────────────────────────────────── */}
        {/* Upper beak — small hooked falcon beak */}
        <path d="M 47 53 Q 50 51 53 53 Q 52 57 50 58 Q 48 57 47 53 Z"
          fill="#ffd60a" stroke="#e6b800" strokeWidth="0.4"/>
        {/* Beak hook */}
        <path d="M 50 58 Q 51 60 50 61 Q 49 60 50 58 Z"
          fill="#e6a800"/>
        {/* Nostril dots */}
        <circle cx="48.5" cy="54.5" r="0.5" fill="#c8960080"/>
        <circle cx="51.5" cy="54.5" r="0.5" fill="#c8960080"/>

        {/* ── THINKING: floating question mark ───────────────── */}
        {mood === "thinking" && (
          <g opacity="0.85">
            <text x="80" y="20" fontSize="10" fill={eyeGlow}
              fontFamily="Space Grotesk, sans-serif" fontWeight="700"
              filter="url(#softGlow)" style={{ animation: "float-soft 2s ease-in-out infinite" }}>
              ?
            </text>
          </g>
        )}

        {/* ── CELEBRATE: star burst ──────────────────────────── */}
        {mood === "celebrate" && (
          <g filter="url(#softGlow)">
            {[0, 60, 120, 180, 240, 300].map((angle, i) => {
              const rad = (angle * Math.PI) / 180;
              const r = 8 + (i % 2) * 4;
              const x = 50 + r * 1.8 * Math.cos(rad);
              const y = 18 + r * Math.sin(rad);
              return (
                <g key={i}>
                  <line x1={x - 1.5 * Math.cos(rad)} y1={y - 1.5 * Math.sin(rad)}
                    x2={x + 1.5 * Math.cos(rad)} y2={y + 1.5 * Math.sin(rad)}
                    stroke={i % 2 === 0 ? "#ffd60a" : eyeGlow}
                    strokeWidth="1.2" strokeLinecap="round"/>
                </g>
              );
            })}
            {/* Central star */}
            <circle cx="50" cy="18" r="2.5" fill="#ffd60a" opacity="0.9"/>
          </g>
        )}

        {/* ── FEET ───────────────────────────────────────────── */}
        {mood === "idle" ? (
          // One foot raised
          <g>
            {/* Standing foot */}
            <path d="M 44 91 L 42 96 M 44 91 L 44 96 M 44 91 L 46 96"
              stroke="rgba(0,229,255,0.6)" strokeWidth="1.2" strokeLinecap="round"/>
            <path d="M 44 96 L 38 98 M 44 96 L 44 99 M 44 96 L 50 98"
              stroke="rgba(0,229,255,0.5)" strokeWidth="1" strokeLinecap="round"/>
            {/* Raised foot */}
            <path d="M 56 91 L 58 85 M 58 85 L 56 82 M 58 85 L 60 82"
              stroke="rgba(0,229,255,0.4)" strokeWidth="1.1" strokeLinecap="round"/>
          </g>
        ) : (
          // Both feet
          <g>
            <path d="M 42 91 L 40 96 M 42 91 L 42 96 M 42 91 L 44 96"
              stroke="rgba(0,229,255,0.6)" strokeWidth="1.2" strokeLinecap="round"/>
            <path d="M 42 96 L 36 98 M 42 96 L 42 99 M 42 96 L 48 98"
              stroke="rgba(0,229,255,0.5)" strokeWidth="1" strokeLinecap="round"/>
            <path d="M 58 91 L 56 96 M 58 91 L 58 96 M 58 91 L 60 96"
              stroke="rgba(0,229,255,0.6)" strokeWidth="1.2" strokeLinecap="round"/>
            <path d="M 58 96 L 52 98 M 58 96 L 58 99 M 58 96 L 64 98"
              stroke="rgba(0,229,255,0.5)" strokeWidth="1" strokeLinecap="round"/>
          </g>
        )}

      </svg>
    </div>
  );
}

// ─── Cleo with floating animation wrapper ────────────────────────
export function FloatingCleo({
  size = 120,
  mood = "default",
  ...props
}: CleoProps) {
  return (
    <div style={{
      animation: "float-soft 4s ease-in-out infinite",
      display: "inline-block",
    }}>
      <Cleo size={size} mood={mood} {...props}/>
    </div>
  );
}
