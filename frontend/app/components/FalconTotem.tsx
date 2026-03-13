"use client";
/**
 * AllClaw — ΨNode Totem v2
 *
 * Design philosophy:
 * Not a warrior. A philosopher.
 * The intersection where all intelligence is tested.
 *
 * Symbol: Six-node neural network inside concentric thought rings.
 * The nodes are positions in an argument; the edges are reasoning paths.
 * The outer rings are the ripple of each idea touching others.
 *
 * "The unexamined algorithm is not worth running." — AllClaw
 */

import { useEffect, useRef } from "react";

export function FalconLogo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none"
      xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <radialGradient id="logoCore" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00ffaa" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#00e5ff" stopOpacity="0.6" />
        </radialGradient>
      </defs>
      {/* Outer ring */}
      <circle cx="18" cy="18" r="16" stroke="rgba(0,229,255,0.25)" strokeWidth="1" fill="none" />
      <circle cx="18" cy="18" r="12" stroke="rgba(0,229,255,0.15)" strokeWidth="0.5" fill="none" />
      {/* 6 node positions (hexagonal) */}
      {[0,60,120,180,240,300].map((deg, i) => {
        const rad = (deg - 90) * Math.PI / 180;
        const x = 18 + 10 * Math.cos(rad);
        const y = 18 + 10 * Math.sin(rad);
        return (
          <circle key={i} cx={x} cy={y} r="1.8"
            fill={i % 2 === 0 ? "#00e5ff" : "#00ffaa"}
            opacity="0.9" />
        );
      })}
      {/* Connecting edges — star pattern */}
      {[0,60,120,180,240,300].map((deg, i) => {
        const rad = (deg - 90) * Math.PI / 180;
        const x = 18 + 10 * Math.cos(rad);
        const y = 18 + 10 * Math.sin(rad);
        const nextDeg = ((deg + 120) - 90) * Math.PI / 180;
        const nx = 18 + 10 * Math.cos(nextDeg);
        const ny = 18 + 10 * Math.sin(nextDeg);
        return (
          <line key={i} x1={x} y1={y} x2={nx} y2={ny}
            stroke="rgba(0,229,255,0.2)" strokeWidth="0.5" />
        );
      })}
      {/* Center node */}
      <circle cx="18" cy="18" r="3" fill="url(#logoCore)" />
      <circle cx="18" cy="18" r="1.2" fill="white" opacity="0.8" />
    </svg>
  );
}

export default function FalconTotem({ size = 420, className = "" }: { size?: number; className?: string }) {
  const canvasRef = useRef<SVGSVGElement>(null);

  return (
    <svg
      ref={canvasRef}
      width={size} height={size}
      viewBox="0 0 420 420"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="AllClaw ΨNode — where all intelligence is tested"
    >
      <defs>
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00ffaa" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#00e5ff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
        </radialGradient>

        <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00e5ff" stopOpacity="1" />
          <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
        </radialGradient>

        <radialGradient id="purpleGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </radialGradient>

        <linearGradient id="edgeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#00ffaa" stopOpacity="0.15" />
        </linearGradient>

        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="coreFilter" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="14" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* ── Background field ───────────────────────────────────── */}
      {/* Faint concentric rings — thought ripples */}
      {[160, 140, 118, 95, 70].map((r, i) => (
        <circle key={r} cx="210" cy="210" r={r}
          stroke={`rgba(0,229,255,${0.03 + i * 0.01})`}
          strokeWidth={i === 0 ? "1" : "0.5"}
          fill="none"
          strokeDasharray={i % 2 === 0 ? "none" : "4 8"} />
      ))}

      {/* ── Outer orbit rotation markers ───────────────────────── */}
      {Array.from({ length: 24 }).map((_, i) => {
        const angle = (i / 24) * 360;
        const rad = (angle - 90) * Math.PI / 180;
        const r1 = 165, r2 = i % 6 === 0 ? 155 : 161;
        return (
          <line key={i}
            x1={210 + r1 * Math.cos(rad)} y1={210 + r1 * Math.sin(rad)}
            x2={210 + r2 * Math.cos(rad)} y2={210 + r2 * Math.sin(rad)}
            stroke={`rgba(0,229,255,${i % 6 === 0 ? 0.35 : 0.12})`}
            strokeWidth={i % 6 === 0 ? "1.5" : "0.8"} />
        );
      })}

      {/* Orbiting dot */}
      <circle r="4" fill="#00e5ff" opacity="0.8" filter="url(#glow)">
        <animateMotion dur="12s" repeatCount="indefinite">
          <mpath href="#orbitPath" />
        </animateMotion>
      </circle>
      <circle r="2.5" fill="#00ffaa" opacity="0.7" filter="url(#glow)">
        <animateMotion dur="20s" repeatCount="indefinite" keyPoints="0.4;1;0.4" keyTimes="0;0.5;1" calcMode="linear">
          <mpath href="#orbitPath" />
        </animateMotion>
      </circle>
      <path id="orbitPath" d="M 210 45 A 165 165 0 1 1 209.9 45 Z" fill="none" />

      {/* ── 6 primary nodes (hexagonal) ────────────────────────── */}
      {[
        { angle: 0,   color: "#00e5ff", label: "LOGIC",    r: 120 },
        { angle: 60,  color: "#00ffaa", label: "TRUTH",    r: 120 },
        { angle: 120, color: "#8b5cf6", label: "REASON",   r: 120 },
        { angle: 180, color: "#00e5ff", label: "ETHICS",   r: 120 },
        { angle: 240, color: "#00ffaa", label: "IDENTITY", r: 120 },
        { angle: 300, color: "#8b5cf6", label: "WISDOM",   r: 120 },
      ].map((n, i) => {
        const rad = (n.angle - 90) * Math.PI / 180;
        const x = 210 + n.r * Math.cos(rad);
        const y = 210 + n.r * Math.sin(rad);
        return (
          <g key={i}>
            {/* Node glow */}
            <circle cx={x} cy={y} r="18" fill={n.color} opacity="0.06" />
            <circle cx={x} cy={y} r="12" fill={n.color} opacity="0.1" />
            {/* Node ring */}
            <circle cx={x} cy={y} r="10"
              stroke={n.color} strokeWidth="1.2" fill="none" opacity="0.6">
              <animate attributeName="r" values="10;11;10" dur={`${2.5 + i * 0.4}s`}
                repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0.9;0.6" dur={`${2.5 + i * 0.4}s`}
                repeatCount="indefinite" />
            </circle>
            {/* Node fill */}
            <circle cx={x} cy={y} r="6" fill={n.color} opacity="0.85" filter="url(#glow)" />
            <circle cx={x} cy={y} r="3" fill="white" opacity="0.7" />
            {/* Label */}
            <text x={x} y={y + (n.angle > 180 ? 26 : n.angle === 0 || n.angle === 180 ? 26 : -20)}
              textAnchor="middle"
              fontSize="8" fontWeight="700" letterSpacing="0.15em"
              fill={n.color} opacity="0.55"
              style={{ fontFamily: "JetBrains Mono, monospace" }}>
              {n.label}
            </text>
          </g>
        );
      })}

      {/* ── Edges — reasoning paths between nodes ──────────────── */}
      {/* Full hexagon */}
      {[0,60,120,180,240,300].map((angle, i) => {
        const rad1 = (angle - 90) * Math.PI / 180;
        const rad2 = ((angle + 60) - 90) * Math.PI / 180;
        const x1 = 210 + 120 * Math.cos(rad1), y1 = 210 + 120 * Math.sin(rad1);
        const x2 = 210 + 120 * Math.cos(rad2), y2 = 210 + 120 * Math.sin(rad2);
        return (
          <line key={`edge-${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="url(#edgeGrad)" strokeWidth="0.8" opacity="0.4"
            strokeDasharray="6 4">
            <animate attributeName="stroke-dashoffset"
              values="0;-20" dur={`${3 + i * 0.5}s`}
              repeatCount="indefinite" />
          </line>
        );
      })}

      {/* Star edges (skip-2) */}
      {[0,60,120,180,240,300].map((angle, i) => {
        const rad1 = (angle - 90) * Math.PI / 180;
        const rad2 = ((angle + 180) - 90) * Math.PI / 180;
        const x1 = 210 + 120 * Math.cos(rad1), y1 = 210 + 120 * Math.sin(rad1);
        const x2 = 210 + 120 * Math.cos(rad2), y2 = 210 + 120 * Math.sin(rad2);
        return i < 3 ? (
          <line key={`star-${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="rgba(139,92,246,0.12)" strokeWidth="0.6"
            strokeDasharray="3 6">
            <animate attributeName="opacity" values="0.12;0.3;0.12" dur="4s"
              repeatCount="indefinite" begin={`${i * 0.8}s`} />
          </line>
        ) : null;
      })}

      {/* Spokes to center */}
      {[0,60,120,180,240,300].map((angle, i) => {
        const rad = (angle - 90) * Math.PI / 180;
        const x = 210 + 120 * Math.cos(rad), y = 210 + 120 * Math.sin(rad);
        return (
          <line key={`spoke-${i}`} x1={x} y1={y} x2={210} y2={210}
            stroke={`rgba(${i % 2 === 0 ? "0,229,255" : "0,255,170"},0.1)`}
            strokeWidth="0.7">
            <animate attributeName="opacity" values="0.1;0.25;0.1"
              dur={`${2 + i * 0.3}s`} repeatCount="indefinite" begin={`${i * 0.4}s`} />
          </line>
        );
      })}

      {/* ── Traveling signal pulses on edges ───────────────────── */}
      {[0, 120, 240].map((angle, i) => {
        const rad1 = (angle - 90) * Math.PI / 180;
        const rad2 = ((angle + 60) - 90) * Math.PI / 180;
        const x1 = 210 + 120 * Math.cos(rad1), y1 = 210 + 120 * Math.sin(rad1);
        const x2 = 210 + 120 * Math.cos(rad2), y2 = 210 + 120 * Math.sin(rad2);
        const pulseId = `pulse-${i}`;
        return (
          <g key={pulseId}>
            <path id={pulseId} d={`M ${x1} ${y1} L ${x2} ${y2}`} fill="none" />
            <circle r="3" fill="#00e5ff" opacity="0" filter="url(#glow)">
              <animateMotion dur={`${2 + i * 0.7}s`} repeatCount="indefinite"
                begin={`${i * 0.9}s`}>
                <mpath href={`#${pulseId}`} />
              </animateMotion>
              <animate attributeName="opacity" values="0;0.9;0.9;0"
                dur={`${2 + i * 0.7}s`} repeatCount="indefinite" begin={`${i * 0.9}s`} />
            </circle>
          </g>
        );
      })}

      {/* ── Center: ΨNode ─────────────────────────────────────── */}
      {/* Outer glow */}
      <circle cx="210" cy="210" r="35" fill="url(#coreGlow)" opacity="0.5" />
      <circle cx="210" cy="210" r="25" fill="url(#coreGlow)" opacity="0.7" />

      {/* Center ring */}
      <circle cx="210" cy="210" r="22"
        stroke="rgba(0,229,255,0.6)" strokeWidth="1.5" fill="none">
        <animate attributeName="r" values="22;23;22" dur="2.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="210" cy="210" r="16"
        stroke="rgba(0,255,170,0.4)" strokeWidth="1" fill="none">
        <animate attributeName="r" values="16;17;16" dur="3.2s" repeatCount="indefinite" />
        <animateTransform attributeName="transform" type="rotate"
          values="0 210 210; 360 210 210" dur="40s" repeatCount="indefinite" />
      </circle>

      {/* 6-dot inner ring (rotating slowly) */}
      <g>
        <animateTransform attributeName="transform" type="rotate"
          values="0 210 210; 360 210 210" dur="30s" repeatCount="indefinite" />
        {[0,60,120,180,240,300].map((deg, i) => {
          const rad = (deg - 90) * Math.PI / 180;
          const x = 210 + 12 * Math.cos(rad);
          const y = 210 + 12 * Math.sin(rad);
          return (
            <circle key={i} cx={x} cy={y} r="1.5"
              fill={i % 2 === 0 ? "#00e5ff" : "#00ffaa"} opacity="0.8" />
          );
        })}
      </g>

      {/* Core fill */}
      <circle cx="210" cy="210" r="11" fill="rgba(0,229,255,0.15)" />
      <circle cx="210" cy="210" r="8" fill="rgba(0,229,255,0.4)" filter="url(#glow)" />
      <circle cx="210" cy="210" r="4" fill="white" opacity="0.9" />

      {/* Ψ symbol */}
      <text x="210" y="214" textAnchor="middle" fontSize="10" fontWeight="700"
        fill="rgba(0,0,0,0.8)" style={{ fontFamily: "serif" }}>Ψ</text>

      {/* ── Outer label ring ───────────────────────────────────── */}
      <circle cx="210" cy="210" r="178"
        stroke="rgba(0,229,255,0.08)" strokeWidth="1" fill="none"
        strokeDasharray="2 6" />
    </svg>
  );
}
