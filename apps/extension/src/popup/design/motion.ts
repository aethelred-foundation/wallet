/**
 * Motion System — single source of truth for the wallet's animation
 * language.
 *
 * This module centralises every spring configuration, every easing curve,
 * and every canonical duration the popup uses. The numbers here mirror the
 * tokens declared in `styles/motion.css` so CSS and hand-rolled JS
 * animations stay in lock-step: if a designer bumps `--dur-slow` in CSS,
 * they should bump `DURATION.slow` here too.
 *
 * We intentionally do not ship framer-motion / react-spring. Chrome
 * extensions are bundle-size sensitive and the motions we need are
 * tractable in ~100 lines of hand-written interpolation + CSS keyframes.
 * The spring configs below are framer-motion compatible (stiffness /
 * damping / mass) so consumers can feed them into any imperative spring
 * implementation without translation.
 *
 * Usage (from a hand-rolled rAF loop):
 *   import { SPRING, springTick } from "../design/motion";
 *   const step = springTick(SPRING.snappy);
 *   ...
 *
 * Usage (from CSS-driven animations):
 *   style={{ animation: `fade-up ${DURATION.slow}ms ${EASE.spring} both` }}
 *
 * @example
 *   import { SPRING, EASE, DURATION } from "../design/motion";
 *   const anim = `scale-in ${DURATION.normal}ms ${EASE.spring}`;
 */

/**
 * Framer-motion compatible spring configs.
 *
 * `stiffness` — how "stiff" the spring is. Higher = faster settling.
 * `damping`   — how quickly oscillations die out. Higher = less bounce.
 * `mass`      — virtual mass of the animated thing. Higher = sluggish.
 *
 * These four named presets cover 95% of the UI's needs. Reach for
 * `snappy` on button press, `bouncy` on sheet open / success states,
 * `smooth` on page transitions and hero tickers, `gentle` on ambient
 * number tickers that shouldn't demand attention.
 */
export const SPRING = {
  /** Button press, toggle flick — snaps back instantly. */
  snappy: { stiffness: 400, damping: 30, mass: 1 },
  /** Sheet / modal open — pleasant overshoot that reads as "pop". */
  bouncy: { stiffness: 300, damping: 20, mass: 1.2 },
  /** Page transitions — smooth, never overshoots. */
  smooth: { stiffness: 170, damping: 26, mass: 1 },
  /** Count-up tickers, large balance reveals — slow decelerate. */
  gentle: { stiffness: 120, damping: 14, mass: 1 },
} as const;

export type SpringName = keyof typeof SPRING;
export type SpringConfig = (typeof SPRING)[SpringName];

/**
 * Easing curves. Values are CSS cubic-bezier literals so they can be
 * dropped directly into a `transition: ... ease ...` or
 * `animation: ... ease ...` declaration.
 *
 * These mirror the `--ease-*` tokens in motion.css. Keep the two in sync.
 */
export const EASE = {
  linear:      "linear",
  in:          "cubic-bezier(0.42, 0, 1, 1)",
  out:         "cubic-bezier(0, 0, 0.58, 1)",
  inOut:       "cubic-bezier(0.42, 0, 0.58, 1)",
  /** iOS default spring — the "Apple" curve. */
  spring:      "cubic-bezier(0.28, 0.44, 0.49, 1)",
  /** Overshoot pop — good for success states, badges. */
  pop:         "cubic-bezier(0.34, 1.56, 0.64, 1)",
  /** Smooth slide, used for horizontal page pushes. */
  soft:        "cubic-bezier(0.45, 0, 0.15, 1)",
  /** Stronger overshoot — reserved for big hero reveals. */
  overshoot:   "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
  /** Material-style standard easing. */
  emphasized:  "cubic-bezier(0.2, 0, 0, 1)",
  decelerate:  "cubic-bezier(0, 0, 0.2, 1)",
  accelerate:  "cubic-bezier(0.4, 0, 1, 1)",
} as const;

export type EaseName = keyof typeof EASE;

/**
 * Durations in milliseconds.
 *
 * - `instant`    — below the "I felt it" threshold (~75ms)
 * - `fast`       — tap-feedback scale, toggle thumb slide
 * - `normal`     — standard card reveal, dropdown open
 * - `slow`       — page transitions, balance count-ups
 * - `deliberate` — hero reveals where we WANT the user to watch
 */
export const DURATION = {
  instant: 75,
  fast: 150,
  normal: 250,
  slow: 400,
  deliberate: 600,
} as const;

export type DurationName = keyof typeof DURATION;

/**
 * Stagger delay helpers. `stagger(i)` returns the delay (in ms) for the
 * i-th sibling in a cascaded list entrance.
 *
 * The returned value caps at 400ms so a list of 100 items doesn't leave
 * the last element frozen for half a second before it appears.
 *
 * @example
 *   tokens.map((t, i) => (
 *     <TokenRow key={t.id} style={{ animationDelay: `${stagger(i)}ms` }} />
 *   ))
 */
export function stagger(index: number, stepMs: number = 40): number {
  return Math.min(400, Math.max(0, index) * stepMs);
}

/**
 * Returns true when the user has requested reduced motion OS-wide. Every
 * JS-driven animation in the popup should short-circuit when this is
 * true and snap to the final state instead of interpolating.
 *
 * Defensively handles environments where `matchMedia` is undefined
 * (test runners, older Chromium forks, extension service workers).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Lightweight critically-damped spring integrator. Runs a single step of
 * a spring simulation and returns the new position and velocity.
 *
 * This is the primitive the hand-rolled animation hooks use when they
 * need spring physics without pulling in a library. You won't reach for
 * it directly unless you're building a new custom hook.
 *
 * @example
 *   let x = 0, v = 0;
 *   const step = () => {
 *     ({ x, v } = springStep({ x, v, target: 100, config: SPRING.snappy, dtMs: 16 }));
 *     el.style.transform = `translateX(${x}px)`;
 *     if (Math.abs(x - 100) > 0.1 || Math.abs(v) > 0.1) requestAnimationFrame(step);
 *   };
 *   requestAnimationFrame(step);
 */
export function springStep({
  x,
  v,
  target,
  config,
  dtMs,
}: {
  x: number;
  v: number;
  target: number;
  config: SpringConfig;
  dtMs: number;
}): { x: number; v: number; settled: boolean } {
  const { stiffness, damping, mass } = config;
  // Clamp dt — if the tab was backgrounded for seconds the math blows up.
  const dt = Math.min(0.04, Math.max(0.001, dtMs / 1000));
  const springForce = -stiffness * (x - target);
  const dampingForce = -damping * v;
  const accel = (springForce + dampingForce) / mass;
  const nextV = v + accel * dt;
  const nextX = x + nextV * dt;
  const settled =
    Math.abs(nextX - target) < 0.1 && Math.abs(nextV) < 0.1;
  return { x: settled ? target : nextX, v: settled ? 0 : nextV, settled };
}

/**
 * Clamp a value to [0, 1]. Ubiquitous in motion math so we export it
 * centrally rather than re-declaring it in every file.
 */
export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Linear interpolate between `from` and `to` by `t` (0..1).
 */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

/**
 * Build a CSS `animation` shorthand from tokens. Handy when the caller
 * would rather stay declarative than reach for Framer's imperative API.
 *
 * @example
 *   style={{ animation: css("fade-up", "slow", "spring") }}
 */
export function css(
  name: string,
  duration: DurationName = "normal",
  ease: EaseName = "spring",
  options: { delay?: number; fill?: "both" | "forwards" | "none" } = {},
): string {
  const fill = options.fill ?? "both";
  const delay = options.delay ? ` ${options.delay}ms` : "";
  return `${name} ${DURATION[duration]}ms ${EASE[ease]}${delay} ${fill}`;
}

/**
 * Convert a spring config to an approximated CSS cubic-bezier + duration
 * pair for cases where a caller is forced to use plain CSS transitions
 * and can't run a JS-driven simulation.
 *
 * The mapping is a heuristic — it's "close enough" for button scale-down
 * and toggle slides, but genuine physics-y animations (elastic bounce,
 * list reorder) should stick to the JS path.
 */
export function springToCss(config: SpringConfig): { durationMs: number; ease: string } {
  const { stiffness, damping, mass } = config;
  // Approx settling time of a critically damped spring.
  const omega = Math.sqrt(stiffness / mass);
  const durationMs = Math.round((4 / omega) * 1000);
  // Overshoot iff underdamped.
  const ratio = damping / (2 * Math.sqrt(stiffness * mass));
  const ease = ratio < 1 ? EASE.pop : EASE.spring;
  return { durationMs, ease };
}

/**
 * Keyframe name tokens — keep callers from typo-ing the handful of names
 * declared in motion.css. If you add a new keyframe there, append it
 * here too.
 */
export const KEYFRAME = {
  fadeUp: "fade-up",
  fadeUpLg: "fade-up-lg",
  fadeIn: "fade-in",
  popIn: "pop-in",
  scaleIn: "scale-in",
  slideInRight: "slide-in-right",
  slideInLeft: "slide-in-left",
  shimmer: "shimmer",
  ringPulse: "ring-pulse",
  glowPulse: "glow-pulse",
  shineSweep: "shine-sweep",
  counterTick: "counter-tick",
  orbitSlow: "orbit-slow",
  breathe: "breathe",
  gradientShift: "gradient-shift",
  successBurst: "success-burst",
  pressRipple: "press-ripple",
  shake: "shake",
} as const;

export type KeyframeName = (typeof KEYFRAME)[keyof typeof KEYFRAME];

/**
 * Re-exportable namespace for consumers that prefer a single import.
 *
 * @example
 *   import { motion } from "../design/motion";
 *   motion.SPRING.snappy;
 */
export const motion = {
  SPRING,
  EASE,
  DURATION,
  KEYFRAME,
  stagger,
  prefersReducedMotion,
  springStep,
  springToCss,
  clamp01,
  lerp,
  css,
} as const;
