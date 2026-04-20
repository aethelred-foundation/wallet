/**
 * MV3 service-worker lifecycle orchestrator.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Why this file exists
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Manifest V3 service workers are ephemeral. The background JS can die at
 * any time — after ~30s idle, after every browser restart, after every
 * reload, after every extension update — and then spring back to life on
 * the very next message. Every critical subsystem of the wallet therefore
 * has to opt into a rehydration protocol:
 *
 *   - `chrome.runtime.onInstalled`  — first install / update / reload.
 *     Seed defaults. Run migrations. This runs ONCE per install event.
 *   - `chrome.runtime.onStartup`    — browser restart. Re-hydrate every
 *     subsystem that holds state in memory.
 *   - `chrome.runtime.onSuspend`    — Chrome is about to evict this worker.
 *     We have ~5 seconds to flush every critical buffer (audit events,
 *     half-finalized Merkle batches, pending tx ledger, session state).
 *   - `onMessage`                   — first message after wake. We cannot
 *     trust any in-memory state until `ensureBooted()` has resolved once,
 *     so every message handler gates on it.
 *
 * Without this orchestration the following silent-data-loss bugs happen in
 * production: audit chain sequence resets to zero on SW wake (breaking
 * the hash chain), Merkle batches lose in-flight events mid-batch,
 * pending transactions vanish until the user revisits the Activity tab,
 * WalletConnect sessions appear disconnected to connected dApps, and
 * policy velocity counters reset (allowing velocity-bypass attacks).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Design
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Each wallet subsystem registers a `LifecycleStage`. The orchestrator
 * runs stages in ascending `priority` on every lifecycle event — so
 * low-level stages (storage, audit chain) run before high-level stages
 * (pending approvals, workflow engine). A single "boot" run is cached in
 * `bootedPromise`: every concurrent `ensureBooted()` caller awaits the
 * SAME promise, so 50 messages arriving at the same time as SW wake all
 * block on one shared boot.
 *
 * Stages are allowed to be partial: a stage may implement only
 * `onInstalled`, only `onStartup`, or any subset. Unused hooks are simply
 * not invoked.
 *
 * Every callback is wrapped in a span from the root boot tracer so ops
 * dashboards see a hierarchical trace of "sw-boot" → individual stage
 * spans. If a stage throws, the error is logged with `error` level and
 * the rest of the stages still run — a single broken stage must never
 * brick the wallet.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Contract
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   - `boot()` is idempotent. Calling it twice returns the same promise.
 *   - `ensureBooted()` always resolves to the SAME `LifecycleContext`
 *     until the orchestrator is disposed — so every message handler sees
 *     consistent values.
 *   - Every stage callback MUST be idempotent. The test suite triple-
 *     invokes each to lock this invariant.
 *   - `onMessage` callbacks MUST be fast (<10ms target) — they run on
 *     every bridge message. Put heavy work in `onStartup`.
 *   - `shutdown()` is synchronous-ish — MV3 gives ~5s from `onSuspend`
 *     before the JS heap is gone. Stages must not await unbounded work.
 */

import type { Logger, Tracer } from "@aethelred/wallet-observability";

/**
 * Context passed to every stage callback. Pinned for the lifetime of one
 * SW instance so stages can stash the logger, the tracer, or any boot
 * metadata.
 */
export interface LifecycleContext {
  /** True if this boot was triggered by `chrome.runtime.onInstalled` with reason `"install"`. */
  isFirstInstall: boolean;
  /** True if this boot was triggered by `chrome.runtime.onInstalled` with reason `"update"`. */
  isUpdate: boolean;
  /** Previous version if this is an update; `null` on install / reload / restart. */
  previousVersion: string | null;
  /** The running extension version. */
  currentVersion: string;
  /** Unix milliseconds when the boot began — useful for cold-start perf. */
  bootedAt: number;
  /** Scoped logger, bound to `correlationId: "sw-boot-<timestamp>"`. */
  logger: Logger;
  /** Scoped tracer, bound to the root boot span. */
  tracer: Tracer;
}

/**
 * A subsystem's opt-in hook set. Stages run in ascending `priority`, so
 * lower-priority stages execute first (e.g. storage-level stages at
 * priority 0 before audit-chain rehydration at priority 10).
 */
export interface LifecycleStage {
  /** Human-readable stage name, surfaced in log records + traces. */
  name: string;
  /** Lower priorities run first. Stages at the same priority run in registration order. */
  priority: number;
  /** Fires on first install / update / reload — ONCE per install event. */
  onInstalled?: (ctx: LifecycleContext) => Promise<void>;
  /** Fires on browser restart — re-hydrate all in-memory state. */
  onStartup?: (ctx: LifecycleContext) => Promise<void>;
  /** Fires when Chrome is about to terminate the SW. Budget ~5s. */
  onSuspend?: (ctx: LifecycleContext) => Promise<void>;
  /**
   * Fires on every bridge message BEFORE the message handler runs.
   * Target < 10 ms. If you need state, stash it in `onStartup` and
   * consult the cache here.
   */
  onMessage?: (ctx: LifecycleContext) => Promise<void>;
}

/**
 * Options accepted by the orchestrator constructor.
 */
export interface SwLifecycleOptions {
  /** Current extension version (manifest version). Defaults to `"0.0.0"`. */
  currentVersion?: string;
  /**
   * If `true`, a failing stage aborts the rest of the boot. Default
   * `false` — a broken stage must never brick the wallet in production.
   * Tests flip this on to lock invariants.
   */
  strictBoot?: boolean;
  /**
   * Override for the wall-clock source — injected in tests so the boot
   * timestamp (and the derived correlationId) are deterministic.
   */
  now?: () => number;
}

/**
 * Shape of the install trigger payload. Mirrors
 * `chrome.runtime.InstalledDetails` but narrowed — we only need the
 * fields our stages consume.
 */
export interface InstallTrigger {
  reason: "install" | "update" | "chrome_update" | "shared_module_update";
  previousVersion?: string;
}

/**
 * SW lifecycle orchestrator — single instance per service worker.
 *
 * Call `registerStage()` at module load. Then register lifecycle hooks
 * (see `background.ts`) that route into `boot()` / `onStartup()` /
 * `onSuspend()` / `ensureBooted()`.
 */
export class SwLifecycle {
  private readonly stages: LifecycleStage[] = [];
  private readonly logger: Logger;
  private readonly tracer: Tracer;
  private readonly currentVersion: string;
  private readonly strictBoot: boolean;
  private readonly now: () => number;
  private bootedPromise: Promise<LifecycleContext> | null = null;
  private bootedContext: LifecycleContext | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private installTrigger: InstallTrigger | null = null;
  private disposed = false;

  constructor(logger: Logger, tracer: Tracer, options: SwLifecycleOptions = {}) {
    this.logger = logger;
    this.tracer = tracer;
    this.currentVersion = options.currentVersion ?? "0.0.0";
    this.strictBoot = options.strictBoot ?? false;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Register a subsystem's lifecycle hooks. Safe to call multiple times
   * for the same stage NAME — later registrations overwrite earlier ones
   * so tests can swap stages for mocks.
   */
  registerStage(stage: LifecycleStage): void {
    if (this.disposed) {
      throw new Error("SwLifecycle: cannot registerStage after dispose()");
    }
    if (!stage.name || typeof stage.name !== "string") {
      throw new Error("SwLifecycle: stage.name is required");
    }
    if (!Number.isFinite(stage.priority)) {
      throw new Error(`SwLifecycle: stage ${stage.name} priority must be a finite number`);
    }
    const existingIdx = this.stages.findIndex((s) => s.name === stage.name);
    if (existingIdx >= 0) {
      this.stages[existingIdx] = stage;
    } else {
      this.stages.push(stage);
    }
    // Keep the stage list in priority order so `boot()` / `shutdown()`
    // can iterate without re-sorting.
    this.stages.sort((a, b) => a.priority - b.priority);
  }

  /** List of registered stages in priority order. Primarily for tests. */
  listStages(): ReadonlyArray<LifecycleStage> {
    return this.stages.slice();
  }

  /**
   * Record the install-event payload so the next boot knows whether it
   * was triggered by an install / update. MV3 fires `onInstalled` before
   * `onStartup` — we save the trigger and consume it on boot.
   */
  recordInstallTrigger(trigger: InstallTrigger): void {
    this.installTrigger = trigger;
  }

  /**
   * Drive the boot pipeline. Runs every stage's `onInstalled` (if the SW
   * was just installed / updated / reloaded) followed by `onStartup` for
   * every stage regardless. Idempotent — concurrent callers join the same
   * promise.
   */
  boot(): Promise<LifecycleContext> {
    if (this.bootedPromise) return this.bootedPromise;
    this.bootedPromise = this.doBoot().catch((err) => {
      // If strictBoot is set, re-throw so tests can assert on failure.
      // Otherwise log + return the context anyway so the wallet keeps
      // functioning degraded. The context is stamped at boot start.
      this.logger.error(
        "sw.boot.failed",
        "SW lifecycle boot threw — continuing in degraded mode.",
        { error: err instanceof Error ? err.message : String(err) },
      );
      if (this.strictBoot) throw err;
      if (this.bootedContext) return this.bootedContext;
      throw err;
    });
    return this.bootedPromise;
  }

  /**
   * The "idempotent, fast-path" entry point every message handler calls
   * as its first await. Returns immediately on the second-and-later
   * invocations for the lifetime of the SW instance. Fires every stage's
   * `onMessage` hook — stages MUST keep those fast (<10ms) since every
   * bridge message pays the cost.
   */
  async ensureBooted(): Promise<LifecycleContext> {
    const ctx = await this.boot();
    // Fan out `onMessage` hooks. We swallow individual errors so a broken
    // subsystem never kills a message. The hook is advisory — stages
    // should make their critical state durable via onStartup/onSuspend.
    for (const stage of this.stages) {
      if (!stage.onMessage) continue;
      try {
        await stage.onMessage(ctx);
      } catch (err) {
        this.logger.warn(
          "sw.onMessage.stageFailed",
          `onMessage hook threw in stage ${stage.name}`,
          { stage: stage.name, error: err instanceof Error ? err.message : String(err) },
        );
      }
    }
    return ctx;
  }

  /**
   * Fire every stage's `onSuspend` hook. Idempotent — the second caller
   * joins the same shutdown promise. Mirrors `boot()` semantics.
   */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.doShutdown();
    return this.shutdownPromise;
  }

  /**
   * Release the orchestrator — only used in test tear-down. After a
   * `dispose()` the instance cannot be booted again.
   */
  dispose(): void {
    this.disposed = true;
    this.bootedPromise = null;
    this.bootedContext = null;
    this.shutdownPromise = null;
    this.stages.length = 0;
  }

  /** Whether `boot()` has completed at least once. */
  isBooted(): boolean {
    return this.bootedContext !== null;
  }

  /** The context installed by `boot()`, or `null` before first boot. */
  getContext(): LifecycleContext | null {
    return this.bootedContext;
  }

  // ───── Internals ─────────────────────────────────────────────────

  private async doBoot(): Promise<LifecycleContext> {
    const bootedAt = this.now();
    const correlationId = `sw-boot-${bootedAt}`;
    const scopedLogger = this.logger.withCorrelation(correlationId);
    const rootSpan = this.tracer.startSpan("sw.boot", {
      attributes: {
        "sw.version": this.currentVersion,
        "sw.install.reason": this.installTrigger?.reason ?? "none",
      },
    });

    const trigger = this.installTrigger;
    this.installTrigger = null;

    const ctx: LifecycleContext = {
      isFirstInstall: trigger?.reason === "install",
      isUpdate: trigger?.reason === "update",
      previousVersion: trigger?.previousVersion ?? null,
      currentVersion: this.currentVersion,
      bootedAt,
      logger: scopedLogger,
      tracer: this.tracer,
    };
    this.bootedContext = ctx;

    scopedLogger.info("sw.boot.started", "SW lifecycle boot started.", {
      stageCount: this.stages.length,
      isFirstInstall: ctx.isFirstInstall,
      isUpdate: ctx.isUpdate,
      previousVersion: ctx.previousVersion ?? "",
    });

    // Phase 1 — run onInstalled for every stage IF this boot was
    // triggered by an install event. Stages that don't implement
    // onInstalled are skipped. Order: ascending priority.
    if (trigger) {
      await this.runPhase(ctx, "onInstalled", (s) => s.onInstalled);
    }

    // Phase 2 — run onStartup for every stage UNCONDITIONALLY. This is
    // the rehydration path every subsystem needs on every SW wake.
    await this.runPhase(ctx, "onStartup", (s) => s.onStartup);

    const elapsed = this.now() - bootedAt;
    rootSpan.setAttribute("sw.boot.duration_ms", elapsed);
    rootSpan.setAttribute("sw.boot.stage_count", this.stages.length);
    rootSpan.setStatus("ok");
    rootSpan.end();
    scopedLogger.info("sw.boot.completed", "SW lifecycle boot completed.", {
      elapsedMs: elapsed,
      stageCount: this.stages.length,
    });
    return ctx;
  }

  private async doShutdown(): Promise<void> {
    if (!this.bootedContext) {
      this.logger.info(
        "sw.shutdown.skip",
        "SW shutdown requested before boot — nothing to flush.",
      );
      return;
    }
    const shutdownAt = this.now();
    const ctx = this.bootedContext;
    const scopedLogger = ctx.logger.withCorrelation(`sw-shutdown-${shutdownAt}`);
    const rootSpan = this.tracer.startSpan("sw.shutdown", {
      attributes: { "sw.version": this.currentVersion },
    });

    scopedLogger.info(
      "sw.shutdown.started",
      "SW shutdown flush started — stages have ~5s.",
      { stageCount: this.stages.length },
    );

    // onSuspend runs in REVERSE priority order so higher-level stages
    // get to flush before we tear down lower-level plumbing. Example:
    // pending-approvals must persist before storage-persistence flushes
    // its debounced writes.
    const reversed = [...this.stages].reverse();
    for (const stage of reversed) {
      if (!stage.onSuspend) continue;
      const stageSpan = this.tracer.startSpan(`sw.shutdown.${stage.name}`, {
        parent: rootSpan,
        attributes: { stage: stage.name, priority: stage.priority },
      });
      try {
        await stage.onSuspend(ctx);
        stageSpan.setStatus("ok");
      } catch (err) {
        scopedLogger.error(
          "sw.shutdown.stageFailed",
          `onSuspend hook threw in stage ${stage.name}`,
          { stage: stage.name, error: err instanceof Error ? err.message : String(err) },
        );
        stageSpan.setStatus("error", err instanceof Error ? err.message : String(err));
      } finally {
        stageSpan.end();
      }
    }

    const elapsed = this.now() - shutdownAt;
    rootSpan.setAttribute("sw.shutdown.duration_ms", elapsed);
    rootSpan.setStatus("ok");
    rootSpan.end();
    scopedLogger.info(
      "sw.shutdown.completed",
      "SW shutdown flush completed.",
      { elapsedMs: elapsed },
    );
  }

  private async runPhase(
    ctx: LifecycleContext,
    phase: "onInstalled" | "onStartup",
    pick: (s: LifecycleStage) => LifecycleStage[keyof LifecycleStage] | undefined,
  ): Promise<void> {
    for (const stage of this.stages) {
      const fn = pick(stage);
      if (typeof fn !== "function") continue;
      const stageSpan = this.tracer.startSpan(`sw.${phase}.${stage.name}`, {
        attributes: { stage: stage.name, priority: stage.priority },
      });
      const started = this.now();
      try {
        await (fn as (ctx: LifecycleContext) => Promise<void>)(ctx);
        stageSpan.setAttribute("stage.duration_ms", this.now() - started);
        stageSpan.setStatus("ok");
      } catch (err) {
        stageSpan.setStatus("error", err instanceof Error ? err.message : String(err));
        ctx.logger.error(
          `sw.${phase}.stageFailed`,
          `${phase} hook threw in stage ${stage.name}`,
          { stage: stage.name, error: err instanceof Error ? err.message : String(err) },
        );
        if (this.strictBoot) {
          stageSpan.end();
          throw err;
        }
      } finally {
        stageSpan.end();
      }
    }
  }
}
