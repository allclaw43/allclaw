"use client";
/**
 * AllClaw — Starfield
 *
 * "Like looking through a telescope at the night sky."
 *
 * Features:
 *   ① Deep parallax — 3 star layers at different depths (speeds)
 *   ② Breathing stars — each star pulses with its own phase/rate
 *   ③ Mouse parallax — move mouse: the sky shifts as if you're panning
 *   ④ Shooting stars — occasional streaks, 1 every 4-8 seconds
 *   ⑤ Nebula glow — soft colour clouds fixed at different depths
 *   ⑥ Scroll depth — deeper scroll reveals more distant stars
 *
 * Performance: 3 canvas layers, ~60fps, zero dependencies
 */
import { useEffect, useRef } from "react";

// ─── Star types ───────────────────────────────────────────────────
interface Star {
  x: number;      // 0..1 normalised
  y: number;      // 0..1 normalised
  size: number;   // base radius px
  phase: number;  // breath phase offset
  rate: number;   // breath speed
  alpha: number;  // base opacity
  color: string;  // rgba prefix
  layer: number;  // 0=close, 1=mid, 2=far
}

interface Streak {
  x: number; y: number;
  vx: number; vy: number;
  len: number;
  alpha: number;
  life: number;
  maxLife: number;
}

// ─── Star colours: mostly white/blue, rare warm ──────────────────
const STAR_COLORS = [
  "rgba(255,255,255,",   // pure white      — most common
  "rgba(220,235,255,",   // cool blue-white
  "rgba(180,210,255,",   // blue
  "rgba(255,245,220,",   // warm yellow     — rare
  "rgba(200,180,255,",   // soft purple     — rare
];

const LAYER_SPEEDS   = [0.018, 0.010, 0.004]; // parallax factor per layer
const LAYER_COUNTS   = [80,  200,  400];       // star count per layer
const LAYER_SIZE_MAX = [2.4, 1.6,  0.9];       // max radius per layer

export default function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = window.innerWidth;
    let H = window.innerHeight;
    let animId: number;
    let mouse = { x: 0, y: 0 };          // -1..1 normalized
    let scrollFrac = 0;

    // ── Build star field ──────────────────────────────────────────
    const stars: Star[] = [];
    for (let layer = 0; layer < 3; layer++) {
      for (let i = 0; i < LAYER_COUNTS[layer]; i++) {
        stars.push({
          x:     Math.random(),
          y:     Math.random(),
          size:  Math.random() * LAYER_SIZE_MAX[layer] + 0.3,
          phase: Math.random() * Math.PI * 2,
          rate:  0.003 + Math.random() * 0.008,
          alpha: 0.25 + Math.random() * 0.65,
          color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
          layer,
        });
      }
    }

    // ── Shooting streaks ──────────────────────────────────────────
    const streaks: Streak[] = [];
    let nextStreak = 4000 + Math.random() * 5000;

    function spawnStreak() {
      const angle = (Math.random() * 40 + 10) * (Math.PI / 180); // 10–50° downward
      const speed = 8 + Math.random() * 12;
      streaks.push({
        x:       Math.random() * W * 0.8,
        y:       Math.random() * H * 0.3,
        vx:      Math.cos(angle) * speed,
        vy:      Math.sin(angle) * speed,
        len:     60 + Math.random() * 100,
        alpha:   1,
        life:    0,
        maxLife: 40 + Math.random() * 30,
      });
      nextStreak = 4000 + Math.random() * 6000;
    }

    // ── Nebula clouds (static painted once) ──────────────────────
    const offscreen = document.createElement("canvas");
    offscreen.width  = W;
    offscreen.height = H;
    const octx = offscreen.getContext("2d")!;

    function paintNebula() {
      offscreen.width  = W;
      offscreen.height = H;
      const clouds = [
        { cx: W*0.12, cy: H*0.22, rx: W*0.45, ry: H*0.38, color: [60, 80, 200], a: 0.04 },
        { cx: W*0.85, cy: H*0.60, rx: W*0.38, ry: H*0.32, color: [0, 229, 255], a: 0.025 },
        { cx: W*0.50, cy: H*0.85, rx: W*0.55, ry: H*0.28, color: [100, 40, 180], a: 0.03 },
        { cx: W*0.72, cy: H*0.10, rx: W*0.30, ry: H*0.25, color: [0, 180, 255], a: 0.02 },
      ];
      for (const c of clouds) {
        const grad = octx.createRadialGradient(c.cx, c.cy, 0, c.cx, c.cy, Math.max(c.rx, c.ry));
        grad.addColorStop(0,   `rgba(${c.color[0]},${c.color[1]},${c.color[2]},${c.a})`);
        grad.addColorStop(0.5, `rgba(${c.color[0]},${c.color[1]},${c.color[2]},${c.a * 0.4})`);
        grad.addColorStop(1,   `rgba(${c.color[0]},${c.color[1]},${c.color[2]},0)`);
        octx.save();
        octx.scale(c.rx / Math.max(c.rx, c.ry), c.ry / Math.max(c.rx, c.ry));
        octx.fillStyle = grad;
        octx.beginPath();
        const sx = c.cx * (Math.max(c.rx, c.ry) / c.rx);
        const sy = c.cy * (Math.max(c.rx, c.ry) / c.ry);
        octx.arc(sx, sy, Math.max(c.rx, c.ry), 0, Math.PI * 2);
        octx.fill();
        octx.restore();
      }
    }

    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width  = W;
      canvas.height = H;
      paintNebula();
    };
    resize();

    // ── Main render loop ─────────────────────────────────────────
    let lastTime = performance.now();
    let elapsed  = 0;

    const draw = (now: number) => {
      const dt = Math.min(now - lastTime, 50);
      lastTime = now;
      elapsed += dt;

      ctx.clearRect(0, 0, W, H);

      // ① Background gradient — deep space base
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0,   "#04040f");
      bg.addColorStop(0.5, "#070714");
      bg.addColorStop(1,   "#0a0a18");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // ② Nebula (pre-rendered offscreen)
      ctx.drawImage(offscreen, 0, 0);

      // ③ Stars — layer by layer with parallax
      for (const s of stars) {
        const speed = LAYER_SPEEDS[s.layer];
        // Parallax offset: mouse moves the sky
        const px = s.x * W + mouse.x * speed * W * 0.5;
        const py = s.y * H + mouse.y * speed * H * 0.5 + scrollFrac * speed * H * 0.3;

        // Breathing
        s.phase += s.rate;
        const breathe = 0.65 + 0.35 * Math.sin(s.phase);
        const alpha   = s.alpha * breathe;
        const radius  = s.size * (0.8 + 0.2 * breathe);

        // Glow for larger stars
        if (s.size > 1.2) {
          const glow = ctx.createRadialGradient(px, py, 0, px, py, radius * 3.5);
          glow.addColorStop(0,   s.color + alpha * 0.6 + ")");
          glow.addColorStop(0.4, s.color + alpha * 0.15 + ")");
          glow.addColorStop(1,   s.color + "0)");
          ctx.beginPath();
          ctx.arc(px, py, radius * 3.5, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        // Core dot
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.3, radius), 0, Math.PI * 2);
        ctx.fillStyle = s.color + alpha + ")";
        ctx.fill();
      }

      // ④ Shooting streaks
      nextStreak -= dt;
      if (nextStreak <= 0) spawnStreak();

      for (let i = streaks.length - 1; i >= 0; i--) {
        const st = streaks[i];
        st.life++;
        st.x += st.vx;
        st.y += st.vy;
        const progress = st.life / st.maxLife;
        const alpha    = progress < 0.3
          ? progress / 0.3
          : 1 - (progress - 0.3) / 0.7;

        const tx  = st.x - st.vx * (st.len / Math.sqrt(st.vx*st.vx+st.vy*st.vy));
        const ty  = st.y - st.vy * (st.len / Math.sqrt(st.vx*st.vx+st.vy*st.vy));

        const grad = ctx.createLinearGradient(st.x, st.y, tx, ty);
        grad.addColorStop(0, `rgba(255,255,255,${alpha * 0.95})`);
        grad.addColorStop(0.3, `rgba(200,230,255,${alpha * 0.6})`);
        grad.addColorStop(1, "rgba(180,210,255,0)");

        ctx.beginPath();
        ctx.moveTo(st.x, st.y);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = grad;
        ctx.lineWidth   = 1.5;
        ctx.stroke();

        if (st.life >= st.maxLife) streaks.splice(i, 1);
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    // ── Event listeners ───────────────────────────────────────────
    const onMouse = (e: MouseEvent) => {
      // Normalize to -1..1 centered
      mouse.x = (e.clientX / W - 0.5) * 2;
      mouse.y = (e.clientY / H - 0.5) * 2;
    };
    const onScroll = () => {
      scrollFrac = window.scrollY / Math.max(1, document.body.scrollHeight - H);
    };
    const onResize = () => { resize(); };

    window.addEventListener("mousemove",  onMouse);
    window.addEventListener("scroll",     onScroll, { passive: true });
    window.addEventListener("resize",     onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("mousemove",  onMouse);
      window.removeEventListener("scroll",     onScroll);
      window.removeEventListener("resize",     onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0, left: 0,
        width:  "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
