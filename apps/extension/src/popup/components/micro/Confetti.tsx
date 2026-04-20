import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../../design/motion";

/**
 * Confetti — celebratory particle burst for major milestones (first
 * successful transaction, 100th transaction, referral earn, etc).
 *
 * Implementation: a canvas overlay that fills the parent's bounding
 * box, runs a 40-particle rAF simulation with simple gravity + friction,
 * then cleans itself up when every particle has faded below 0 alpha.
 *
 * Zero deps, zero libraries — just ~80 lines of imperative canvas. The
 * entire component unmounts after the animation completes; consumers
 * toggle it on via a conditional render.
 *
 * @example
 *   {firstTxConfirmed && <Confetti />}
 */

export interface ConfettiProps {
  /** Number of particles. Default: 40 */
  count?: number;
  /** Origin y-coordinate as a ratio of canvas height. Default: 0.35 */
  originY?: number;
  /** Particle colours. Default: wallet brand mix. */
  colors?: string[];
  /** Fires when the animation finishes; consumers can use it to clean up. */
  onDone?: () => void;
  /** Make the overlay non-clickable. Default: true */
  passThrough?: boolean;
}

const DEFAULT_COLORS = ["#c41e1e", "#8b5cf6", "#0ea5e9", "#34c759", "#ff9f0a", "#ff3b30"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  spin: number;
  color: string;
  alpha: number;
  shape: "rect" | "circle";
}

export function Confetti({
  count = 40,
  originY = 0.35,
  colors = DEFAULT_COLORS,
  onDone,
  passThrough = true,
}: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      onDone?.();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const parent = canvas.parentElement;
    const width = parent?.clientWidth ?? window.innerWidth;
    const height = parent?.clientHeight ?? window.innerHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    const originXy = { x: width / 2, y: height * originY };
    const particles: Particle[] = Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI - Math.PI / 2;
      const speed = 4 + Math.random() * 6;
      return {
        x: originXy.x + (Math.random() - 0.5) * 40,
        y: originXy.y,
        vx: Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1),
        vy: Math.sin(angle) * speed - 2,
        size: 5 + Math.random() * 6,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.3,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        shape: Math.random() > 0.5 ? "rect" : "circle",
      };
    });

    const gravity = 0.18;
    const friction = 0.995;
    const fade = 0.008;

    const tick = () => {
      ctx.clearRect(0, 0, width, height);
      let alive = false;

      for (const p of particles) {
        if (p.alpha <= 0) continue;
        alive = true;

        p.vy += gravity;
        p.vx *= friction;
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;
        p.alpha -= fade;

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;

        if (p.shape === "rect") {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, (p.size * 2) / 3);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (alive) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        onDone?.();
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      try {
        ctx.clearRect(0, 0, width, height);
      } catch {
        // already detached
      }
    };
  }, [count, originY, colors, onDone]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: passThrough ? "none" : "auto",
        zIndex: 10,
      }}
    />
  );
}
