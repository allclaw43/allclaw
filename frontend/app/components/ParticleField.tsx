"use client";
/**
 * AllClaw — ParticleField
 * Ambient neural-network particle canvas.
 * Nodes connect when near, pulse on activity, react to mouse.
 * Performance: ~60 FPS at 80 nodes. Zero deps.
 */
import { useEffect, useRef } from "react";

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  color: string;
  alpha: number;
  pulse: number;
  pulseSpeed: number;
}

const COLORS = [
  "rgba(96,165,250,",   // blue
  "rgba(167,139,250,",  // purple
  "rgba(52,211,153,",   // green
  "rgba(0,229,255,",    // cyan
];

export default function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = window.innerWidth;
    let H = document.documentElement.scrollHeight;
    let mouse = { x: -1000, y: -1000 };
    let animId: number;

    const resize = () => {
      W = window.innerWidth;
      H = document.documentElement.scrollHeight;
      canvas.width  = W;
      canvas.height = H;
    };
    resize();

    // Build particles
    const COUNT = Math.min(80, Math.floor(W / 18));
    const particles: Particle[] = Array.from({ length: COUNT }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 1.8 + 0.6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: Math.random() * 0.5 + 0.2,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.008 + Math.random() * 0.012,
    }));

    const CONNECT_DIST   = 140;
    const MOUSE_DIST     = 180;
    const MOUSE_REPEL    = 0.012;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      for (const p of particles) {
        // Move
        p.x += p.vx;
        p.y += p.vy;
        p.pulse += p.pulseSpeed;

        // Wrap
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;

        // Mouse repel
        const mx = p.x - mouse.x;
        const my = p.y - mouse.y;
        const md = Math.sqrt(mx * mx + my * my);
        if (md < MOUSE_DIST) {
          const force = (1 - md / MOUSE_DIST) * MOUSE_REPEL;
          p.vx += mx / md * force;
          p.vy += my / md * force;
        }

        // Dampen velocity
        p.vx *= 0.998;
        p.vy *= 0.998;

        // Pulse alpha
        const a = p.alpha * (0.7 + 0.3 * Math.sin(p.pulse));

        // Draw node
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + 0.2 * Math.sin(p.pulse)), 0, Math.PI * 2);
        ctx.fillStyle = p.color + a + ")";
        ctx.fill();
      }

      // Draw edges
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECT_DIST) {
            const opacity = (1 - dist / CONNECT_DIST) * 0.18;
            // Use the color of the closer particle
            const col = a.color;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = col + opacity + ")";
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      animId = requestAnimationFrame(draw);
    };

    draw();

    const onMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY + window.scrollY;
    };
    const onScroll = () => {
      mouse.y = (mouse.y - window.scrollY + window.scrollY);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("scroll",    onScroll, { passive: true });
    window.addEventListener("resize",    resize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("scroll",    onScroll);
      window.removeEventListener("resize",    resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0, left: 0,
        width: "100%", height: "100%",
        pointerEvents: "none",
        zIndex: 0,
        opacity: 0.55,
      }}
    />
  );
}
