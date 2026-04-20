import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import i18n from "../i18n/i18n";

/**
 * ViewErrorBoundary
 * ─────────────────
 * A PER-ROUTE error boundary. The existing top-level boundary in App.tsx
 * is a safety net for catastrophic errors, but when a single view crashes
 * it wipes the entire popup UI — including the nav bar and header —
 * which is a terrible UX because the user has no way to navigate away.
 *
 * This boundary wraps each view separately so a crash in one view:
 *   1. Surfaces an inline error card INSIDE the view container
 *   2. Keeps the nav bar + header visible so the user can escape
 *   3. Offers a "Try again" button that resets the boundary
 *   4. Offers a "Go home" button as a fallback
 *   5. In dev mode, shows the actual error + stack trace
 *
 * Usage in App.tsx's ViewRouter:
 *
 *   <ViewErrorBoundary viewName={view} onNavigateHome={() => navigate("home")}>
 *     {renderCurrentView()}
 *   </ViewErrorBoundary>
 *
 * Error logging hook: if `window.__onViewError` is defined, we call it
 * with the error + info so Sentry / analytics can wire up later without
 * touching this file.
 */

interface Props {
  children: ReactNode;
  /** The active view name — used as the React key so changing view resets the boundary */
  viewName?: string;
  /** Called when the user clicks "Go home" */
  onNavigateHome?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ViewErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });

    // Log to console in dev mode
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.error(
        `[ViewErrorBoundary] Error in view "${this.props.viewName ?? "unknown"}":`,
        error,
        errorInfo,
      );
    }

    // Call the global error hook if defined (for Sentry wiring later)
    const hook = (window as unknown as {
      __onViewError?: (error: Error, info: ErrorInfo, viewName?: string) => void;
    }).__onViewError;
    if (typeof hook === "function") {
      try {
        hook(error, errorInfo, this.props.viewName);
      } catch { /* ignore */ }
    }
  }

  componentDidUpdate(prevProps: Props) {
    // Reset the boundary when the view name changes —
    // otherwise navigating away from a crashed view still shows the error.
    if (prevProps.viewName !== this.props.viewName && this.state.hasError) {
      this.setState({ hasError: false, error: null, errorInfo: null });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onNavigateHome?.();
  };

  render() {
    if (this.state.hasError) {
      const isDev = import.meta.env?.DEV;
      /* Fallback strings default to English if i18n hasn't initialised.
       * This boundary is the last-line UI, so we can't trust any
       * provider above us — including TranslationProvider. `i18n.t` is
       * a safe global because `i18n.ts` initialises at module load. */
      const tr = (key: string, fallback: string): string => {
        try {
          const result = i18n.t(key);
          if (typeof result === "string" && result !== key) return result;
        } catch {
          // i18n may not be initialised in some test harnesses — fall back.
        }
        return fallback;
      };
      return (
        <div className="view-padded" role="alert" aria-live="assertive">
          <div className="veb-hero">
            <div className="veb-icon">
              <AlertTriangle size={22} strokeWidth={2.3} />
            </div>
            <div className="veb-info">
              <span className="veb-label">{tr("boundary.viewError", "VIEW ERROR")}</span>
              <strong className="veb-title">{tr("boundary.title", "Something went wrong")}</strong>
              <span className="veb-sub">
                {tr("boundary.sub", "This page crashed while rendering. Your wallet is still safe.")}
              </span>
            </div>
          </div>

          <div className="veb-actions">
            <button className="veb-btn primary" onClick={this.handleRetry} type="button">
              <RefreshCw size={13} strokeWidth={2.4} />
              {tr("boundary.tryAgain", "Try again")}
            </button>
            <button className="veb-btn secondary" onClick={this.handleGoHome} type="button">
              <Home size={13} strokeWidth={2.4} />
              {tr("boundary.goHome", "Go home")}
            </button>
          </div>

          {isDev && this.state.error && (
            <div className="veb-debug">
              <div className="veb-debug-label">{tr("boundary.devDiagnostics", "DEV DIAGNOSTICS")}</div>
              <div className="veb-debug-body">
                <strong>{this.state.error.name}: {this.state.error.message}</strong>
                {this.state.error.stack && (
                  <pre className="veb-debug-stack">{this.state.error.stack.slice(0, 600)}</pre>
                )}
                {this.state.errorInfo?.componentStack && (
                  <>
                    <div className="veb-debug-label" style={{ marginTop: 10 }}>{tr("boundary.componentStack", "COMPONENT STACK")}</div>
                    <pre className="veb-debug-stack">
                      {this.state.errorInfo.componentStack.slice(0, 600)}
                    </pre>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
