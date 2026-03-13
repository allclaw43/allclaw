"use client";
/**
 * AllClaw — Falcon Prime Totem
 * Cyberpunk mechanical falcon, animated SVG.
 * Inspired by: national emblems × sci-fi × circuit board aesthetics.
 */
export default function FalconTotem({
  size = 420,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 420 420"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="AllClaw Falcon Prime — the AI battle totem"
    >
      <defs>
        {/* ── Gradients ───────────────────────────────────── */}
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00ff88" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#00d4ff" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
        </radialGradient>

        <linearGradient id="wingLeft" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#0066cc" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#001133" stopOpacity="0.5" />
        </linearGradient>

        <linearGradient id="wingRight" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#0066cc" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#001133" stopOpacity="0.5" />
        </linearGradient>

        <linearGradient id="bodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.95" />
          <stop offset="40%" stopColor="#0088bb" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#003355" stopOpacity="0.6" />
        </linearGradient>

        <linearGradient id="hexGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00ff88" />
          <stop offset="100%" stopColor="#00d4ff" />
        </linearGradient>

        <linearGradient id="lightningGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffd700" />
          <stop offset="50%" stopColor="#ffaa00" />
          <stop offset="100%" stopColor="#ff6600" stopOpacity="0.5" />
        </linearGradient>

        <filter id="glowBlue" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>

        <filter id="glowGreen" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>

        <filter id="glowGold" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>

        <filter id="scanline">
          <feColorMatrix type="saturate" values="1.5" />
        </filter>

        <clipPath id="falconClip">
          <circle cx="210" cy="210" r="200" />
        </clipPath>
      </defs>

      {/* ── Outer ring ─────────────────────────────────────── */}
      <circle cx="210" cy="210" r="200" fill="none" stroke="#00d4ff" strokeWidth="1" strokeOpacity="0.3" />
      <circle cx="210" cy="210" r="195" fill="none" stroke="#00d4ff" strokeWidth="0.5" strokeOpacity="0.15" />

      {/* Spinning outer ring marks */}
      <g style={{ transformOrigin: "210px 210px" }}>
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 210 210"
          to="360 210 210"
          dur="30s"
          repeatCount="indefinite"
        />
        {Array.from({ length: 24 }).map((_, i) => {
          const angle = (i * 15 * Math.PI) / 180;
          const x = 210 + 196 * Math.cos(angle);
          const y = 210 + 196 * Math.sin(angle);
          return (
            <circle key={i} cx={x} cy={y} r={i % 6 === 0 ? 3 : 1.5}
              fill="#00d4ff" opacity={i % 6 === 0 ? 0.8 : 0.3} />
          );
        })}
      </g>

      {/* Counter-spinning inner ring */}
      <g style={{ transformOrigin: "210px 210px" }}>
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 210 210"
          to="-360 210 210"
          dur="20s"
          repeatCount="indefinite"
        />
        <circle cx="210" cy="210" r="175" fill="none" stroke="#00d4ff" strokeWidth="0.5"
          strokeDasharray="4 8" strokeOpacity="0.25" />
      </g>

      {/* ── Background ambient glow ─────────────────────────── */}
      <circle cx="210" cy="210" r="160" fill="url(#coreGlow)" opacity="0.15">
        <animate attributeName="opacity" values="0.10;0.22;0.10" dur="3s" repeatCount="indefinite" />
      </circle>

      {/* ── LEFT WING ──────────────────────────────────────── */}
      {/* Primary wing shape */}
      <path
        d="M210 185
           C180 170, 120 155, 60 130
           C45 124, 25 110, 18 95
           C35 100, 55 108, 80 118
           C60 100, 30 85, 15 65
           C35 75, 62 88, 90 105
           C70 82, 45 62, 32 42
           C55 58, 80 78, 108 100
           C95 72, 78 48, 70 28
           C90 50, 108 74, 128 108
           C120 80, 115 55, 115 38
           C130 62, 138 86, 145 118
           C148 95, 152 72, 158 58
           C162 82, 165 105, 168 135
           C175 118, 180 102, 188 92
           C188 112, 190 130, 192 155
           L210 185Z"
        fill="url(#wingLeft)"
        filter="url(#glowBlue)"
      >
        <animateTransform attributeName="transform" type="translate"
          values="0,0; -4,3; 0,0" dur="4s" repeatCount="indefinite" />
      </path>

      {/* Wing circuit lines — left */}
      {[
        "M210 175 C175 168, 130 158, 75 138",
        "M200 195 C165 185, 110 172, 52 148",
        "M205 210 C170 202, 115 190, 60 168",
        "M195 165 C165 158, 120 148, 72 128",
      ].map((d, i) => (
        <path key={i} d={d} stroke="#00d4ff" strokeWidth="0.8" strokeOpacity="0.6" fill="none">
          <animate attributeName="stroke-opacity" values="0.4;0.9;0.4" dur={`${2.5 + i * 0.4}s`} repeatCount="indefinite" />
        </path>
      ))}

      {/* Wing feather details — left */}
      {[
        { d: "M165 138 L148 120 L162 125Z", op: 0.5 },
        { d: "M145 122 L125 102 L140 108Z", op: 0.4 },
        { d: "M118 108 L95 84 L112 92Z", op: 0.35 },
        { d: "M88 104 L68 78 L85 88Z", op: 0.3 },
        { d: "M62 128 L40 104 L58 112Z", op: 0.25 },
      ].map((f, i) => (
        <path key={i} d={f.d} fill="#00d4ff" opacity={f.op} />
      ))}

      {/* ── RIGHT WING ─────────────────────────────────────── */}
      <path
        d="M210 185
           C240 170, 300 155, 360 130
           C375 124, 395 110, 402 95
           C385 100, 365 108, 340 118
           C360 100, 390 85, 405 65
           C385 75, 358 88, 330 105
           C350 82, 375 62, 388 42
           C365 58, 340 78, 312 100
           C325 72, 342 48, 350 28
           C330 50, 312 74, 292 108
           C300 80, 305 55, 305 38
           C290 62, 282 86, 275 118
           C272 95, 268 72, 262 58
           C258 82, 255 105, 252 135
           C245 118, 240 102, 232 92
           C232 112, 230 130, 228 155
           L210 185Z"
        fill="url(#wingRight)"
        filter="url(#glowBlue)"
      >
        <animateTransform attributeName="transform" type="translate"
          values="0,0; 4,3; 0,0" dur="4s" repeatCount="indefinite" />
      </path>

      {/* Wing circuit lines — right */}
      {[
        "M210 175 C245 168, 290 158, 345 138",
        "M220 195 C255 185, 310 172, 368 148",
        "M215 210 C250 202, 305 190, 360 168",
        "M225 165 C255 158, 300 148, 348 128",
      ].map((d, i) => (
        <path key={i} d={d} stroke="#00d4ff" strokeWidth="0.8" strokeOpacity="0.6" fill="none">
          <animate attributeName="stroke-opacity" values="0.4;0.9;0.4" dur={`${2.5 + i * 0.4}s`} repeatCount="indefinite" />
        </path>
      ))}

      {/* Wing feather details — right */}
      {[
        { d: "M255 138 L272 120 L258 125Z", op: 0.5 },
        { d: "M275 122 L295 102 L280 108Z", op: 0.4 },
        { d: "M302 108 L325 84 L308 92Z", op: 0.35 },
        { d: "M332 104 L352 78 L335 88Z", op: 0.3 },
        { d: "M358 128 L380 104 L362 112Z", op: 0.25 },
      ].map((f, i) => (
        <path key={i} d={f.d} fill="#00d4ff" opacity={f.op} />
      ))}

      {/* ── HEAD & BODY ────────────────────────────────────── */}
      {/* Neck / body */}
      <path
        d="M185 200 C185 180, 188 165, 210 155 C232 165, 235 180, 235 200
           C235 240, 230 280, 210 305 C190 280, 185 240, 185 200Z"
        fill="url(#bodyGrad)"
        filter="url(#glowBlue)"
      />

      {/* Head shape */}
      <ellipse cx="210" cy="152" rx="28" ry="32" fill="#0a1a2a" stroke="#00d4ff" strokeWidth="1.5" />

      {/* Beak */}
      <path d="M210 165 L198 178 L210 174 L222 178 L210 165Z"
        fill="#00d4ff" opacity="0.9" filter="url(#glowBlue)" />

      {/* Head crest — crown of data */}
      <path d="M210 120 L204 132 L210 128 L216 132 L210 120Z"
        fill="#00ff88" filter="url(#glowGreen)" />
      <path d="M200 122 L196 134 L202 131 L204 136 L200 122Z"
        fill="#00d4ff" opacity="0.7" />
      <path d="M220 122 L224 134 L218 131 L216 136 L220 122Z"
        fill="#00d4ff" opacity="0.7" />

      {/* ── EYES — Scanning red targeting systems ──────────── */}
      {/* Left eye */}
      <circle cx="200" cy="148" r="8" fill="#0a0a12" stroke="#ff4444" strokeWidth="1.5" />
      <circle cx="200" cy="148" r="5" fill="#ff1111" opacity="0.8">
        <animate attributeName="opacity" values="0.6;1.0;0.6" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <circle cx="200" cy="148" r="2.5" fill="#ffffff" opacity="0.9" />
      {/* Scan line across left eye */}
      <line x1="192" y1="148" x2="208" y2="148" stroke="#ff4444" strokeWidth="0.8" opacity="0.6">
        <animate attributeName="y1" values="142;154;142" dur="2s" repeatCount="indefinite" />
        <animate attributeName="y2" values="142;154;142" dur="2s" repeatCount="indefinite" />
      </line>

      {/* Right eye */}
      <circle cx="220" cy="148" r="8" fill="#0a0a12" stroke="#ff4444" strokeWidth="1.5" />
      <circle cx="220" cy="148" r="5" fill="#ff1111" opacity="0.8">
        <animate attributeName="opacity" values="1.0;0.6;1.0" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <circle cx="220" cy="148" r="2.5" fill="#ffffff" opacity="0.9" />
      <line x1="212" y1="148" x2="228" y2="148" stroke="#ff4444" strokeWidth="0.8" opacity="0.6">
        <animate attributeName="y1" values="154;142;154" dur="2s" repeatCount="indefinite" />
        <animate attributeName="y2" values="154;142;154" dur="2s" repeatCount="indefinite" />
      </line>

      {/* Eye glow halos */}
      <circle cx="200" cy="148" r="10" fill="none" stroke="#ff4444" strokeWidth="1" opacity="0.4">
        <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="220" cy="148" r="10" fill="none" stroke="#ff4444" strokeWidth="1" opacity="0.4">
        <animate attributeName="r" values="14;8;14" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.4;0" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* ── HEXAGONAL ENERGY CORE (chest) ──────────────────── */}
      {/* Outer hex ring */}
      <polygon
        points="210,228 222,235 222,249 210,256 198,249 198,235"
        fill="none" stroke="url(#hexGrad)" strokeWidth="2"
        filter="url(#glowGreen)"
      >
        <animateTransform attributeName="transform" type="rotate"
          from="0 210 242" to="360 210 242" dur="8s" repeatCount="indefinite" />
      </polygon>

      {/* Inner hex */}
      <polygon
        points="210,234 218,239 218,248 210,253 202,248 202,239"
        fill="#00ff8822" stroke="#00ff88" strokeWidth="1.5"
        filter="url(#glowGreen)"
      />

      {/* Core pulse */}
      <circle cx="210" cy="242" r="8" fill="#00ff88" opacity="0.7" filter="url(#glowGreen)">
        <animate attributeName="r" values="6;10;6" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0.95;0.5" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="210" cy="242" r="3" fill="#ffffff" opacity="0.9" />

      {/* Circuit traces from core */}
      {[
        "M210 252 L210 268 L200 274",
        "M210 252 L210 268 L220 274",
        "M202 238 L192 232 L182 238",
        "M218 238 L228 232 L238 238",
      ].map((d, i) => (
        <path key={i} d={d} stroke="#00ff88" strokeWidth="0.8" fill="none" strokeOpacity="0.6">
          <animate attributeName="stroke-opacity" values="0.3;0.9;0.3"
            dur={`${1.2 + i * 0.3}s`} repeatCount="indefinite" />
        </path>
      ))}

      {/* ── TALONS / CLAWS ─────────────────────────────────── */}
      {/* Left talon */}
      <path d="M190 295 C182 305, 170 320, 162 335 C168 330, 175 318, 180 310"
        stroke="#00d4ff" strokeWidth="3" fill="none" strokeLinecap="round" filter="url(#glowBlue)" />
      <path d="M186 298 C175 310, 162 328, 155 345 C162 338, 170 322, 178 312"
        stroke="#00d4ff" strokeWidth="2.5" fill="none" strokeLinecap="round" filter="url(#glowBlue)" opacity="0.7" />
      <path d="M195 302 C188 314, 180 332, 176 348 C182 340, 188 325, 192 314"
        stroke="#00d4ff" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#glowBlue)" opacity="0.6" />

      {/* Right talon */}
      <path d="M230 295 C238 305, 250 320, 258 335 C252 330, 245 318, 240 310"
        stroke="#00d4ff" strokeWidth="3" fill="none" strokeLinecap="round" filter="url(#glowBlue)" />
      <path d="M234 298 C245 310, 258 328, 265 345 C258 338, 250 322, 242 312"
        stroke="#00d4ff" strokeWidth="2.5" fill="none" strokeLinecap="round" filter="url(#glowBlue)" opacity="0.7" />
      <path d="M225 302 C232 314, 240 332, 244 348 C238 340, 232 325, 228 314"
        stroke="#00d4ff" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#glowBlue)" opacity="0.6" />

      {/* ── LIGHTNING BOLTS (held in talons) ───────────────── */}
      {/* Left bolt */}
      <path d="M175 318 L162 340 L170 337 L158 360 L168 355 L156 378"
        stroke="url(#lightningGrad)" strokeWidth="2.5" fill="none"
        strokeLinecap="round" strokeLinejoin="round"
        filter="url(#glowGold)">
        <animate attributeName="opacity" values="0.7;1.0;0.7;0.5;1.0;0.7" dur="0.6s" repeatCount="indefinite" />
      </path>
      {/* Left bolt glow */}
      <path d="M175 318 L162 340 L170 337 L158 360 L168 355 L156 378"
        stroke="#ffd700" strokeWidth="5" fill="none" opacity="0.15"
        strokeLinecap="round" strokeLinejoin="round" filter="url(#glowGold)">
        <animate attributeName="opacity" values="0.1;0.3;0.1;0.05;0.3;0.1" dur="0.6s" repeatCount="indefinite" />
      </path>

      {/* Right bolt */}
      <path d="M245 318 L258 340 L250 337 L262 360 L252 355 L264 378"
        stroke="url(#lightningGrad)" strokeWidth="2.5" fill="none"
        strokeLinecap="round" strokeLinejoin="round"
        filter="url(#glowGold)">
        <animate attributeName="opacity" values="1.0;0.7;0.5;1.0;0.7;1.0" dur="0.6s" repeatCount="indefinite" />
      </path>
      <path d="M245 318 L258 340 L250 337 L262 360 L252 355 L264 378"
        stroke="#ffd700" strokeWidth="5" fill="none" opacity="0.15"
        strokeLinecap="round" strokeLinejoin="round" filter="url(#glowGold)">
        <animate attributeName="opacity" values="0.3;0.1;0.05;0.3;0.1;0.3" dur="0.6s" repeatCount="indefinite" />
      </path>

      {/* ── TAIL FEATHERS (flag-like spread) ───────────────── */}
      {[
        { d: "M203 305 L195 345 L202 338 L200 360", offset: -2 },
        { d: "M210 308 L210 352 L212 345 L210 368", offset: 0 },
        { d: "M217 305 L225 345 L218 338 L220 360", offset: 2 },
        { d: "M196 300 L182 338 L190 332 L186 354", offset: -4 },
        { d: "M224 300 L238 338 L230 332 L234 354", offset: 4 },
      ].map((t, i) => (
        <path key={i} d={t.d} stroke="#00d4ff" strokeWidth="1.5" fill="none"
          strokeOpacity={0.4 - Math.abs(t.offset) * 0.05}
          strokeLinecap="round" />
      ))}

      {/* ── DATA STREAMS (orbit particles) ─────────────────── */}
      {[0, 1, 2].map(i => (
        <circle key={i} r="3" fill="#00d4ff" opacity="0.8" filter="url(#glowBlue)">
          <animateMotion
            dur={`${5 + i * 1.5}s`}
            repeatCount="indefinite"
            begin={`${i * -1.8}s`}
          >
            <mpath href="#orbitPath" />
          </animateMotion>
          <animate attributeName="opacity" values="0;0.8;0.8;0" dur={`${5 + i * 1.5}s`} repeatCount="indefinite" begin={`${i * -1.8}s`} />
        </circle>
      ))}
      <path id="orbitPath" d="M210,55 C330,55 365,145 365,210 C365,310 300,365 210,365 C120,365 55,310 55,210 C55,145 90,55 210,55Z"
        fill="none" visibility="hidden" />

      {/* Green data particles */}
      {[0, 1].map(i => (
        <circle key={i} r="2.5" fill="#00ff88" opacity="0.7" filter="url(#glowGreen)">
          <animateMotion dur={`${7 + i * 2}s`} repeatCount="indefinite" begin={`${i * -3}s`}>
            <mpath href="#innerOrbit" />
          </animateMotion>
        </circle>
      ))}
      <path id="innerOrbit" d="M210,80 C305,80 340,148 340,210 C340,295 282,340 210,340 C138,340 80,295 80,210 C80,148 115,80 210,80Z"
        fill="none" visibility="hidden" />

      {/* ── SCANLINE EFFECT across eyes ────────────────────── */}
      <rect x="188" y="140" width="44" height="2" fill="#ff4444" opacity="0.4">
        <animate attributeName="y" values="138;160;138" dur="2.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2.5s" repeatCount="indefinite" />
      </rect>

      {/* ── HUD overlay rings ───────────────────────────────── */}
      {/* Targeting ring around head */}
      <circle cx="210" cy="152" r="38" fill="none" stroke="#ff4444" strokeWidth="0.5"
        strokeDasharray="3 8" strokeOpacity="0.4">
        <animateTransform attributeName="transform" type="rotate"
          from="0 210 152" to="-360 210 152" dur="6s" repeatCount="indefinite" />
      </circle>

      {/* ── Body armor plates ───────────────────────────────── */}
      {[
        { y: 205, w: 36 },
        { y: 218, w: 30 },
        { y: 231, w: 24 },
      ].map((p, i) => (
        <rect key={i}
          x={210 - p.w / 2} y={p.y} width={p.w} height="8"
          rx="2"
          fill="#00d4ff" fillOpacity="0.08"
          stroke="#00d4ff" strokeWidth="0.5" strokeOpacity="0.4"
        />
      ))}

      {/* ── Ambient bottom glow ─────────────────────────────── */}
      <ellipse cx="210" cy="360" rx="80" ry="15" fill="#00d4ff" opacity="0.08">
        <animate attributeName="opacity" values="0.05;0.14;0.05" dur="3s" repeatCount="indefinite" />
      </ellipse>

      {/* ── Floating data hex nodes (background ambiance) ─── */}
      {[
        { x: 75, y: 185, r: 6, dur: "4s" },
        { x: 345, y: 185, r: 6, dur: "5s" },
        { x: 110, y: 270, r: 4, dur: "3.5s" },
        { x: 310, y: 270, r: 4, dur: "4.5s" },
        { x: 155, y: 330, r: 3, dur: "5.5s" },
        { x: 265, y: 330, r: 3, dur: "3.8s" },
      ].map((h, i) => (
        <g key={i}>
          <polygon
            points={`${h.x},${h.y - h.r} ${h.x + h.r * 0.866},${h.y - h.r * 0.5} ${h.x + h.r * 0.866},${h.y + h.r * 0.5} ${h.x},${h.y + h.r} ${h.x - h.r * 0.866},${h.y + h.r * 0.5} ${h.x - h.r * 0.866},${h.y - h.r * 0.5}`}
            fill="none" stroke="#00d4ff" strokeWidth="0.8" strokeOpacity="0.4">
            <animate attributeName="stroke-opacity" values="0.2;0.6;0.2" dur={h.dur} repeatCount="indefinite" />
          </polygon>
          <circle cx={h.x} cy={h.y} r="1.5" fill="#00d4ff" opacity="0.5">
            <animate attributeName="opacity" values="0.3;0.8;0.3" dur={h.dur} repeatCount="indefinite" />
          </circle>
        </g>
      ))}

      {      /* ── Text label ───────────────────────────────────────── */}
      <text x="210" y="400" textAnchor="middle"
        fill="#00d4ff" fontSize="10" fontFamily="monospace" letterSpacing="6" opacity="0.7">
        FALCON PRIME
      </text>
    </svg>
  );
}

/* ── Compact logo version (nav bar) ──────────────────────────────── */
export function FalconLogo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg"
      aria-label="AllClaw">
      <defs>
        <radialGradient id="logoGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00ff88" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
        </radialGradient>
        <filter id="logoBlur">
          <feGaussianBlur stdDeviation="1.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Wings */}
      <path d="M40 35 C28 30, 10 25, 4 15 C12 18, 22 23, 32 28 C18 18, 8 10, 5 2 C15 8, 26 18, 36 28 L40 35Z"
        fill="#00d4ff" opacity="0.85" filter="url(#logoBlur)" />
      <path d="M40 35 C52 30, 70 25, 76 15 C68 18, 58 23, 48 28 C62 18, 72 10, 75 2 C65 8, 54 18, 44 28 L40 35Z"
        fill="#00d4ff" opacity="0.85" filter="url(#logoBlur)" />
      {/* Body */}
      <ellipse cx="40" cy="30" rx="7" ry="10" fill="#0a1a2a" stroke="#00d4ff" strokeWidth="1" />
      {/* Eyes */}
      <circle cx="37" cy="27" r="2.5" fill="#ff1111">
        <animate attributeName="opacity" values="0.7;1;0.7" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="43" cy="27" r="2.5" fill="#ff1111">
        <animate attributeName="opacity" values="1;0.7;1" dur="2s" repeatCount="indefinite" />
      </circle>
      {/* Core hex */}
      <polygon points="40,40 44,42.5 44,47.5 40,50 36,47.5 36,42.5"
        fill="none" stroke="#00ff88" strokeWidth="1" filter="url(#logoBlur)">
        <animateTransform attributeName="transform" type="rotate"
          from="0 40 45" to="360 40 45" dur="6s" repeatCount="indefinite" />
      </polygon>
      <circle cx="40" cy="45" r="3" fill="#00ff88" opacity="0.8">
        <animate attributeName="opacity" values="0.6;1;0.6" dur="1.5s" repeatCount="indefinite" />
      </circle>
      {/* Lightning */}
      <path d="M34 55 L30 63 L33 61 L29 70" stroke="#ffd700" strokeWidth="1.5"
        fill="none" strokeLinecap="round">
        <animate attributeName="opacity" values="0.7;1;0.5;1" dur="0.5s" repeatCount="indefinite" />
      </path>
      <path d="M46 55 L50 63 L47 61 L51 70" stroke="#ffd700" strokeWidth="1.5"
        fill="none" strokeLinecap="round">
        <animate attributeName="opacity" values="1;0.5;1;0.7" dur="0.5s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}
