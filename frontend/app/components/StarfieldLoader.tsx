"use client";
/**
 * Client-only wrapper for the Starfield canvas.
 * layout.tsx (Server Component) imports THIS file,
 * which in turn lazy-loads ParticleField only on the client.
 */
import dynamic from "next/dynamic";

const ParticleField = dynamic(() => import("./ParticleField"), {
  ssr: false,
  loading: () => null,
});

export default function StarfieldLoader() {
  return <ParticleField />;
}
