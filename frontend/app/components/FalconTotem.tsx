"use client";
/**
 * AllClaw — Brand Identity v3
 *
 * LOGO DESIGN PHILOSOPHY:
 * ─────────────────────────────────────────────────────
 * Symbol: Three angular claws radiating from a hexagonal core.
 * Each claw = one dimension of intelligence (Logic, Knowledge, Execution)
 * The core = the arena where they converge and are tested
 *
 * Aesthetic rule: geometric precision, NOT organic.
 * No curves. Only lines, angles, and deliberate gaps.
 * The "gap" between claw tips is intentional — nothing is complete
 * until it has been tested against others.
 *
 * Color: Single brand color — Xenon Cyan #00e5ff
 * No gradients in the logo mark. Pure flat. Scalable to any size.
 *
 * Typography: "ALLCLAW" in Space Grotesk 700, wide tracking
 * Sub: "AI ARENA" in JetBrains Mono, very wide tracking, dim
 *
 * Relationship to OpenClaw:
 * OpenClaw = a tool. AllClaw = the stage.
 * Same lineage, different purpose. The mark should feel like a cousin,
 * not a clone — same angular DNA, different soul.
 * ─────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState } from "react";

// ─── BRAND COLORS ────────────────────────────────────────────────
const BRAND   = "#00e5ff";   // Xenon Cyan — THE brand color
const BRAND_DIM = "rgba(0,229,255,0.35)";
const BRAND_GLOW = "rgba(0,229,255,0.15)";

// ═══════════════════════════════════════════════════════════════
//  ClawMark — The Icon
//  Three claws + hexagonal core. Pure geometry. Single color.
//  Used everywhere: favicon, nav, loading screens.
// ═══════════════════════════════════════════════════════════════
export function ClawMark({
  size = 32,
  color = BRAND,
  animated = false,
  className = "",
}: {
  size?: number;
  color?: string;
  animated?: boolean;
  className?: string;
}) {
  // All coordinates are designed on a 32×32 grid
  // Center: (16, 16)
  // Hex core: regular hexagon, radius 5
  // Claws: 3 angular arms at 330°, 90°, 210° (shifted from hex vertices)

  const S = size / 32; // scale factor

  // Hex core points (radius 5, center 16,16)
  const hexPts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return [16 + 5 * Math.cos(a), 16 + 5 * Math.sin(a)];
  });
  const hexPath = hexPts.map((p, i) =>
    (i === 0 ? "M" : "L") + `${p[0]} ${p[1]}`
  ).join(" ") + " Z";

  // Three claws — each is a thin angular blade
  // Claw angles: -90° (top), 150° (bottom-left), 30° (bottom-right)
  const clawAngles = [-90, 150, 30];
  const claws = clawAngles.map(deg => {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);

    // Claw tip
    const tx = 16 + 13 * cos, ty = 16 + 13 * sin;
    // Base left (perpendicular offset -1.2)
    const bx1 = 16 + 5.5 * cos + 1.4 * sin, by1 = 16 + 5.5 * sin - 1.4 * cos;
    // Base right
    const bx2 = 16 + 5.5 * cos - 1.4 * sin, by2 = 16 + 5.5 * sin + 1.4 * cos;
    // Inner notch (gives blade the "claw" curve)
    const nx = 16 + 9 * cos + 0.8 * sin, ny = 16 + 9 * sin - 0.8 * cos;

    return `M ${bx1} ${by1} L ${tx} ${ty} L ${bx2} ${by2} L ${nx} ${ny} Z`;
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="AllClaw"
      style={animated ? { animation: "float-soft 4s ease-in-out infinite" } : undefined}
    >
      {animated && (
        <defs>
          <filter id="clawGlow">
            <feGaussianBlur stdDeviation="1.5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
      )}

      {/* Outer ring — very subtle */}
      <circle cx="16" cy="16" r="15"
        stroke={color} strokeWidth="0.4" fill="none"
        strokeOpacity="0.2"
        strokeDasharray="4 3"
      />

      {/* Three claws */}
      {claws.map((d, i) => (
        <path key={i} d={d} fill={color}
          opacity={animated ? 1 : 0.92}
          filter={animated ? "url(#clawGlow)" : undefined}
        />
      ))}

      {/* Hex core */}
      <path d={hexPath} fill={color} opacity="0.95"/>

      {/* Center dot — the arena */}
      <circle cx="16" cy="16" r="1.8" fill="#090912"/>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
//  BrandLogo — Icon + Wordmark
//  The complete lockup. Used in nav, headers, og-image.
// ═══════════════════════════════════════════════════════════════
export function BrandLogo({
  size = 34,
  showSub = true,
  className = "",
}: {
  size?: number;
  showSub?: boolean;
  className?: string;
}) {
  const nameFontSize = Math.round(size * 0.47);
  const subFontSize  = Math.round(size * 0.22);

  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.round(size * 0.28),
        textDecoration: "none",
        userSelect: "none",
      }}
    >
      <ClawMark size={size} />

      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        {/* Primary wordmark */}
        <span style={{
          fontSize: nameFontSize,
          fontWeight: 800,
          letterSpacing: "0.08em",
          color: "white",
          fontFamily: "'Space Grotesk', -apple-system, sans-serif",
          lineHeight: 1,
        }}>
          ALLCLAW
        </span>

        {/* Sub-label */}
        {showSub && (
          <span style={{
            fontSize: subFontSize,
            fontWeight: 600,
            letterSpacing: "0.22em",
            color: BRAND_DIM,
            fontFamily: "'JetBrains Mono', monospace",
            marginTop: Math.round(size * 0.07),
            textTransform: "uppercase",
          }}>
            AI ARENA
          </span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  HeroTotem — Large decorative version for homepage
//  Animated, with pulse rings and floating particles.
// ═══════════════════════════════════════════════════════════════
export default function HeroTotem({
  size = 220,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Orbiting particle ring around the logo
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width  = size;
    canvas.height = size;
    const cx = size / 2, cy = size / 2;
    const R  = size * 0.41; // orbit radius

    // 12 particles on the orbit
    const particles = Array.from({ length: 12 }, (_, i) => ({
      angle:  (i / 12) * Math.PI * 2,
      speed:  0.003 + (i % 3) * 0.001,
      radius: R + (i % 3 - 1) * (size * 0.04),
      size:   (i % 4 === 0) ? 2.5 : 1.2,
      alpha:  0.3 + (i % 3) * 0.2,
    }));

    let animId: number;

    const draw = () => {
      ctx.clearRect(0, 0, size, size);

      // Outer glow ring
      const grad = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.2);
      grad.addColorStop(0, "rgba(0,229,255,0)");
      grad.addColorStop(0.5, "rgba(0,229,255,0.04)");
      grad.addColorStop(1, "rgba(0,229,255,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,229,255,0.08)";
      ctx.lineWidth = size * 0.06;
      ctx.stroke();

      // Particles
      for (const p of particles) {
        p.angle += p.speed;
        const x = cx + p.radius * Math.cos(p.angle);
        const y = cy + p.radius * Math.sin(p.angle);
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,229,255,${p.alpha})`;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animId);
  }, [size]);

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Particle canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      />

      {/* Pulse rings */}
      {[1, 1.4, 1.8].map((scale, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: size * 0.5,
            height: size * 0.5,
            borderRadius: "50%",
            border: `1px solid rgba(0,229,255,${0.25 - i * 0.07})`,
            animation: `oracle-ring ${2 + i * 0.8}s ease-out infinite`,
            animationDelay: `${i * 0.6}s`,
          }}
        />
      ))}

      {/* Main logo mark — large, glowing */}
      <div style={{
        position: "relative", zIndex: 1,
        filter: `drop-shadow(0 0 ${size * 0.1}px rgba(0,229,255,0.5))
                 drop-shadow(0 0 ${size * 0.25}px rgba(0,229,255,0.2))`,
        animation: "float-soft 5s ease-in-out infinite",
      }}>
        <ClawMark size={size * 0.52} animated={false}/>
      </div>
    </div>
  );
}

// ─── Keep FalconLogo as alias for backward compat ─────────────────
export const FalconLogo = BrandLogo;
