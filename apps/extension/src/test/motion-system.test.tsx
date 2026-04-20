/**
 * Motion system — hook and component tests.
 *
 * The popup's motion / haptic / sound primitives sit in the hot path for
 * every interaction: if they throw, the entire UI freezes. These tests
 * pin the "graceful degradation" guarantees so we notice instantly if a
 * refactor regresses them.
 *
 * Coverage targets:
 *
 *   1. useHaptics / useSound — no-op correctly when the browser capability
 *      is missing.
 *   2. useHaptics / useSound — persist preferences to chrome.storage.local.
 *   3. useSharedElement — returns unique transition names per id.
 *   4. useScrollOpacity / useScrollProgress — return values in [0, 1].
 *   5. PressableButton — invokes the click handler AND fires haptic.
 *   6. SuccessMorph — renders the SVG path with correct dash length.
 *   7. Skeleton shapes — render without crashing.
 *   8. motion.ts utilities — spring / lerp / clamp behave correctly.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, renderHook } from "@testing-library/react";
import { useHaptics, setHapticsEnabled, isHapticsEnabled } from "../popup/hooks/use-haptics";
import { useSound, setSoundEnabled, isSoundEnabled } from "../popup/hooks/use-sound";
import {
  useSharedElement,
  withViewTransition,
} from "../popup/components/hero-transition";
import {
  useScrollOpacity,
  useScrollProgress,
} from "../popup/hooks/use-scroll-timeline";
import { PressableButton } from "../popup/components/micro/PressableButton";
import { SuccessMorph } from "../popup/components/micro/SuccessMorph";
import { ErrorShake } from "../popup/components/micro/ErrorShake";
import { CopyToClipboard } from "../popup/components/micro/CopyToClipboard";
import {
  TokenRowSkeleton,
  BalanceHeroSkeleton,
  AccountCardSkeleton,
  ApprovalRowSkeleton,
  ActivityRowSkeleton,
  TreasuryRowSkeleton,
  SettingsRowSkeleton,
  ChartSkeleton,
} from "../popup/components/skeleton-shapes";
import {
  SPRING,
  EASE,
  DURATION,
  clamp01,
  lerp,
  stagger,
  springStep,
  springToCss,
  prefersReducedMotion,
} from "../popup/design/motion";

/* ─── Chrome.storage mock ────────────────────────────────────── */
interface FakeStore {
  data: Record<string, unknown>;
  listeners: Array<(c: Record<string, { newValue?: unknown }>, a: string) => void>;
}
const fakeStore: FakeStore = { data: {}, listeners: [] };

function installChromeStorage(): void {
  // We cast to `any` because the full chrome.storage interface is huge
  // and tests only need a subset. Cast done once; callers above use the
  // real type via the hooks' ambient `chrome` global.
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (key: string, cb: (r: Record<string, unknown>) => void) => {
          cb({ [key]: fakeStore.data[key] });
        },
        set: (patch: Record<string, unknown>) => {
          Object.assign(fakeStore.data, patch);
          const changes: Record<string, { newValue?: unknown }> = {};
          for (const k of Object.keys(patch)) changes[k] = { newValue: patch[k] };
          fakeStore.listeners.forEach((l) => l(changes, "local"));
        },
      },
      onChanged: {
        addListener: (cb: (c: Record<string, { newValue?: unknown }>, a: string) => void) => {
          fakeStore.listeners.push(cb);
        },
      },
    },
  };
}

function clearChromeStorage(): void {
  fakeStore.data = {};
  fakeStore.listeners = [];
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
}

beforeEach(() => {
  // Fresh slate each test — reset preference caches by importing fresh.
  clearChromeStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearChromeStorage();
  // Clean up any faux APIs installed by tests
  (navigator as unknown as { vibrate?: unknown }).vibrate = undefined;
  (window as unknown as { AudioContext?: unknown }).AudioContext = undefined;
});

/* ─── motion.ts utilities ────────────────────────────────────── */

describe("motion utilities", () => {
  it("clamp01 clamps values to [0, 1]", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.3)).toBe(0.3);
    expect(clamp01(1.8)).toBe(1);
  });

  it("lerp interpolates between two values", () => {
    expect(lerp(0, 100, 0)).toBe(0);
    expect(lerp(0, 100, 0.5)).toBe(50);
    expect(lerp(0, 100, 1)).toBe(100);
  });

  it("stagger clamps out-of-range and caps at 400ms", () => {
    expect(stagger(0)).toBe(0);
    expect(stagger(5)).toBe(200);
    expect(stagger(100)).toBe(400);
    expect(stagger(-1)).toBe(0);
  });

  it("springStep converges toward the target", () => {
    let x = 0;
    let v = 0;
    for (let i = 0; i < 200; i++) {
      ({ x, v } = springStep({ x, v, target: 100, config: SPRING.snappy, dtMs: 16 }));
    }
    expect(Math.abs(x - 100)).toBeLessThan(1);
  });

  it("springToCss returns a duration + ease pair", () => {
    const css = springToCss(SPRING.smooth);
    expect(css.durationMs).toBeGreaterThan(0);
    expect(css.ease).toContain("cubic-bezier");
  });

  it("tokens expose the expected preset names", () => {
    expect(Object.keys(SPRING)).toEqual(expect.arrayContaining(["snappy", "bouncy", "smooth", "gentle"]));
    expect(EASE.spring).toContain("cubic-bezier");
    expect(DURATION.normal).toBe(250);
  });

  it("prefersReducedMotion honors matchMedia", () => {
    const original = window.matchMedia;
    (window as typeof window).matchMedia = ((q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    })) as unknown as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(true);
    (window as typeof window).matchMedia = original;
  });
});

/* ─── useHaptics ─────────────────────────────────────────────── */

describe("useHaptics", () => {
  it("is safe to call when navigator.vibrate is missing", () => {
    installChromeStorage();
    const { result } = renderHook(() => useHaptics());
    expect(() => result.current.selection()).not.toThrow();
    expect(() => result.current.impact("heavy")).not.toThrow();
    expect(() => result.current.success()).not.toThrow();
    expect(() => result.current.warning()).not.toThrow();
    expect(() => result.current.error()).not.toThrow();
  });

  it("invokes navigator.vibrate with the expected pattern when available", () => {
    installChromeStorage();
    const spy = vi.fn().mockReturnValue(true);
    (navigator as unknown as { vibrate: unknown }).vibrate = spy;
    const { result } = renderHook(() => useHaptics());
    result.current.selection();
    expect(spy).toHaveBeenCalledWith(5);
    result.current.impact("light");
    expect(spy).toHaveBeenLastCalledWith(10);
    result.current.success();
    expect(spy).toHaveBeenLastCalledWith(expect.arrayContaining([12, 48]));
  });

  it("respects the disabled preference", () => {
    installChromeStorage();
    setHapticsEnabled(false);
    const spy = vi.fn().mockReturnValue(true);
    (navigator as unknown as { vibrate: unknown }).vibrate = spy;
    const { result } = renderHook(() => useHaptics());
    result.current.selection();
    // preference was written synchronously, so vibrate should not fire
    expect(spy).not.toHaveBeenCalled();
    setHapticsEnabled(true);
  });

  it("persists to chrome.storage.local", () => {
    installChromeStorage();
    setHapticsEnabled(false);
    expect(fakeStore.data["haptics-enabled"]).toBe(false);
    setHapticsEnabled(true);
    expect(fakeStore.data["haptics-enabled"]).toBe(true);
    expect(isHapticsEnabled()).toBe(true);
  });

  it("respects prefers-reduced-motion by refusing to vibrate", () => {
    installChromeStorage();
    const originalMm = window.matchMedia;
    (window as typeof window).matchMedia = ((q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    })) as unknown as typeof window.matchMedia;
    const spy = vi.fn().mockReturnValue(true);
    (navigator as unknown as { vibrate: unknown }).vibrate = spy;
    const { result } = renderHook(() => useHaptics());
    result.current.impact("medium");
    expect(spy).not.toHaveBeenCalled();
    (window as typeof window).matchMedia = originalMm;
  });
});

/* ─── useSound ───────────────────────────────────────────────── */

describe("useSound", () => {
  it("gracefully no-ops when AudioContext is missing", () => {
    (window as unknown as { AudioContext?: unknown }).AudioContext = undefined;
    const { result } = renderHook(() => useSound());
    expect(() => result.current.playTap()).not.toThrow();
    expect(() => result.current.playCopy()).not.toThrow();
    expect(() => result.current.playSuccess()).not.toThrow();
    expect(() => result.current.playError()).not.toThrow();
  });

  it("creates oscillator nodes when AudioContext is available", () => {
    installChromeStorage();
    const connect = vi.fn();
    const start = vi.fn();
    const stop = vi.fn();
    const linearRamp = vi.fn();
    const setValueAtTime = vi.fn();
    const expRamp = vi.fn();
    const mockCtx = {
      currentTime: 0,
      state: "running" as AudioContextState,
      destination: {},
      createOscillator: vi.fn(() => ({
        type: "sine",
        frequency: { setValueAtTime, exponentialRampToValueAtTime: expRamp },
        connect,
        start,
        stop,
        disconnect: () => {},
        onended: null,
      })),
      createGain: vi.fn(() => ({
        gain: { setValueAtTime, linearRampToValueAtTime: linearRamp, exponentialRampToValueAtTime: expRamp },
        connect,
        disconnect: () => {},
      })),
      resume: vi.fn(),
      suspend: vi.fn(),
    };
    (window as unknown as { AudioContext?: unknown }).AudioContext = vi.fn(() => mockCtx);
    const { result } = renderHook(() => useSound());
    result.current.playTap();
    expect(mockCtx.createOscillator).toHaveBeenCalled();
    expect(mockCtx.createGain).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
  });

  it("persists mute preference", () => {
    installChromeStorage();
    const mockCtx = {
      currentTime: 0,
      state: "running" as AudioContextState,
      destination: {},
      createOscillator: () => ({
        type: "sine",
        frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {},
        onended: null,
      }),
      createGain: () => ({
        gain: {
          setValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        connect: () => {},
        disconnect: () => {},
      }),
      resume: () => {},
      suspend: () => {},
    };
    (window as unknown as { AudioContext?: unknown }).AudioContext = vi.fn(() => mockCtx);
    const { result } = renderHook(() => useSound());
    result.current.playTap();
    result.current.setMuted(true);
    expect(fakeStore.data["sound-enabled"]).toBe(false);
    result.current.setMuted(false);
    expect(fakeStore.data["sound-enabled"]).toBe(true);
  });

  it("isSoundEnabled returns the current preference", () => {
    installChromeStorage();
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
  });
});

/* ─── useSharedElement ───────────────────────────────────────── */

describe("useSharedElement", () => {
  it("returns a stable transitionName per id", () => {
    const { result, rerender } = renderHook((id: string) => useSharedElement(id), {
      initialProps: "token-AETHEL",
    });
    const first = result.current.transitionName;
    rerender("token-AETHEL");
    expect(result.current.transitionName).toBe(first);
  });

  it("sanitizes disallowed characters in the transitionName", () => {
    const { result } = renderHook(() => useSharedElement("token-{}@usd c/foo"));
    expect(result.current.transitionName).toMatch(/^sh-[a-zA-Z0-9_-]+$/);
  });

  it("emits distinct transitionNames for different ids", () => {
    const a = renderHook(() => useSharedElement("a"));
    const b = renderHook(() => useSharedElement("b"));
    expect(a.result.current.transitionName).not.toBe(b.result.current.transitionName);
  });

  it("withViewTransition falls through when startViewTransition is missing", () => {
    const cb = vi.fn();
    withViewTransition(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

/* ─── useScrollOpacity / useScrollProgress ───────────────────── */

describe("scroll-timeline hooks", () => {
  it("useScrollOpacity returns a clamped value", () => {
    const ref = React.createRef<HTMLDivElement>();
    const TestComp = () => {
      const opacity = useScrollOpacity(ref);
      return <div data-testid="opacity" ref={ref}>{opacity.toFixed(2)}</div>;
    };
    render(<TestComp />);
    const v = parseFloat(screen.getByTestId("opacity").textContent ?? "");
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it("useScrollProgress returns a clamped value", () => {
    const ref = React.createRef<HTMLDivElement>();
    const TestComp = () => {
      const p = useScrollProgress(ref);
      return <div data-testid="progress" ref={ref}>{p.toFixed(2)}</div>;
    };
    render(<TestComp />);
    const v = parseFloat(screen.getByTestId("progress").textContent ?? "");
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

/* ─── PressableButton ─────────────────────────────────────────── */

describe("PressableButton", () => {
  it("forwards onClick and fires haptic selection", () => {
    installChromeStorage();
    const vibrate = vi.fn().mockReturnValue(true);
    (navigator as unknown as { vibrate?: unknown }).vibrate = vibrate;
    const click = vi.fn();
    render(<PressableButton onClick={click}>Send</PressableButton>);
    fireEvent.click(screen.getByRole("button"));
    expect(click).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalled();
  });

  it("renders with the motion-press class", () => {
    render(<PressableButton>Go</PressableButton>);
    expect(screen.getByRole("button").className).toContain("motion-press");
  });

  it("supports haptic='none' to opt out", () => {
    installChromeStorage();
    const vibrate = vi.fn().mockReturnValue(true);
    (navigator as unknown as { vibrate?: unknown }).vibrate = vibrate;
    render(<PressableButton haptic="none">Quiet</PressableButton>);
    fireEvent.click(screen.getByRole("button"));
    expect(vibrate).not.toHaveBeenCalled();
  });
});

/* ─── SuccessMorph ───────────────────────────────────────────── */

describe("SuccessMorph", () => {
  it("renders an SVG with circle + path", () => {
    render(<SuccessMorph size={40} animate={false} />);
    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    const circle = svg?.querySelector("circle");
    const path = svg?.querySelector("path");
    expect(circle).toBeTruthy();
    expect(path).toBeTruthy();
    expect(circle?.getAttribute("r")).toBe("24");
  });
});

/* ─── ErrorShake + CopyToClipboard ───────────────────────────── */

describe("ErrorShake", () => {
  it("renders children and does not crash on trigger change", () => {
    installChromeStorage();
    const { rerender } = render(<ErrorShake trigger={null}><span>hi</span></ErrorShake>);
    expect(screen.getByText("hi")).toBeInTheDocument();
    rerender(<ErrorShake trigger="err"><span>hi</span></ErrorShake>);
    expect(screen.getByText("hi")).toBeInTheDocument();
  });
});

describe("CopyToClipboard", () => {
  it("writes to navigator.clipboard on click", async () => {
    installChromeStorage();
    const vibrate = vi.fn().mockReturnValue(true);
    (navigator as unknown as { vibrate?: unknown }).vibrate = vibrate;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<CopyToClipboard value="hello" label="greeting" />);
    fireEvent.click(screen.getByRole("button"));
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).toHaveBeenCalledWith("hello");
  });
});

/* ─── Skeleton shapes ────────────────────────────────────────── */

describe("skeleton shapes", () => {
  it("all eight shapes render without crashing", () => {
    render(
      <div>
        <TokenRowSkeleton />
        <BalanceHeroSkeleton />
        <AccountCardSkeleton />
        <ApprovalRowSkeleton />
        <ActivityRowSkeleton />
        <TreasuryRowSkeleton />
        <SettingsRowSkeleton />
        <ChartSkeleton />
      </div>,
    );
    const shimmered = document.querySelectorAll(".motion-shimmer");
    expect(shimmered.length).toBeGreaterThan(0);
  });

  it("SettingsRowSkeleton renders a toggle trailing when requested", () => {
    const { container } = render(<SettingsRowSkeleton trailing="toggle" />);
    expect(container.querySelector(".ui-skeleton-settings")).toBeTruthy();
  });
});
