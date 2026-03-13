"use client";
/**
 * AllClaw — PulseNumber
 * Animates a number when it changes — counts up/down with color flash.
 * Used for online counts, ELO, points — anywhere live data matters.
 */
import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  color?: string;
  fontSize?: number | string;
  fontWeight?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function PulseNumber({
  value,
  color = "white",
  fontSize = 24,
  fontWeight = 800,
  duration = 600,
  prefix = "",
  suffix = "",
  className = "",
  style = {},
}: Props) {
  const [display, setDisplay]  = useState(value);
  const [flashing, setFlashing] = useState(false);
  const prevRef  = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value === prevRef.current) return;
    const start = prevRef.current;
    const end   = value;
    const delta = end - start;
    const steps = Math.min(Math.abs(delta), 30);
    const stepTime = duration / Math.max(steps, 1);
    let step = 0;

    setFlashing(true);
    if (timerRef.current) clearTimeout(timerRef.current);

    const tick = () => {
      step++;
      const progress = step / steps;
      // Ease out
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + delta * eased));
      if (step < steps) {
        timerRef.current = setTimeout(tick, stepTime);
      } else {
        setDisplay(end);
        setTimeout(() => setFlashing(false), 400);
      }
    };
    tick();
    prevRef.current = value;

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [value, duration]);

  return (
    <span
      className={className}
      style={{
        fontSize,
        fontWeight,
        fontFamily: "JetBrains Mono, monospace",
        color: flashing ? (value > prevRef.current ? "#34d399" : color) : color,
        transition: "color 0.3s",
        display: "inline-block",
        ...style,
      }}
    >
      {prefix}{display.toLocaleString()}{suffix}
    </span>
  );
}
