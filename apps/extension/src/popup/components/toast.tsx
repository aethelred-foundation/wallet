import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

/* ─── Public API types ───────────────────────────────────────────────── *
 * The public surface of `useToast()` is the same `(type, message)` call
 * every caller in the codebase already relies on. We keep that signature
 * binary-compatible by making the 3rd `options` argument optional and
 * purely additive. Callers doing `toast("info", "Hello")` continue to
 * work without any changes. New callers can opt in to richer toasts with
 * `toast("success", "Saved!", { title: "Done", action: { … } })`.
 * ──────────────────────────────────────────────────────────────────── */
type ToastType = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Bold heading rendered above the message. Optional. */
  title?: string;
  /** Trailing action button (e.g. "Undo"). Optional. */
  action?: ToastAction;
  /**
   * Milliseconds before the toast auto-dismisses. Defaults to 3000ms.
   * The progress bar visually tracks this duration.
   */
  duration?: number;
}

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  title?: string;
  action?: ToastAction;
  duration: number;
  exiting: boolean;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

let toastId = 0;

const DEFAULT_DURATION = 3000;
const EXIT_DURATION = 250;

const icons: Record<ToastType, typeof Info> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    // Two-phase dismissal: flip `exiting` so CSS plays the exit
    // animation, then remove after EXIT_DURATION. This keeps the DOM in
    // sync with what the user sees and avoids visual "pops".
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_DURATION);
  }, []);

  const toast = useCallback(
    (type: ToastType, message: string, options?: ToastOptions) => {
      const id = ++toastId;
      const duration = options?.duration ?? DEFAULT_DURATION;
      setToasts((prev) => [
        ...prev,
        {
          id,
          type,
          message,
          title: options?.title,
          action: options?.action,
          duration,
          exiting: false,
        },
      ]);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-container" role="region" aria-label="Notifications">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ─── ToastItem ──────────────────────────────────────────────────────── *
 * Each rendered toast owns its own lifecycle: a paused flag (for hover),
 * a remaining-time counter so the auto-dismiss timer can resume where it
 * left off, and a ref to the progress bar so we can flip its animation
 * state between `running` and `paused` without re-rendering.
 * ──────────────────────────────────────────────────────────────────── */
function ToastItem({
  toast: t,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const Icon = icons[t.type];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef<number>(t.duration);
  const startedAtRef = useRef<number>(Date.now());
  const progressRef = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);

  // Start the auto-dismiss timer. We only schedule a timer when the
  // toast is not yet exiting — once `exiting` flips we rely on the
  // provider's cleanup timeout to actually unmount.
  useEffect(() => {
    if (t.exiting) return;

    const scheduleDismiss = () => {
      timerRef.current = setTimeout(() => onDismiss(t.id), remainingRef.current);
      startedAtRef.current = Date.now();
    };

    if (!paused) {
      scheduleDismiss();
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [paused, t.exiting, t.id, onDismiss]);

  const handleMouseEnter = () => {
    if (t.exiting) return;
    // Capture how long we've been visible so the resumed timer picks up
    // from the same position; pause the CSS animation on the progress
    // bar so it freezes at the matching visual state.
    const elapsed = Date.now() - startedAtRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    if (progressRef.current) {
      progressRef.current.style.animationPlayState = "paused";
    }
    setPaused(true);
  };

  const handleMouseLeave = () => {
    if (t.exiting) return;
    if (progressRef.current) {
      progressRef.current.style.animationPlayState = "running";
    }
    setPaused(false);
  };

  const handleAction = () => {
    if (!t.action) return;
    t.action.onClick();
    onDismiss(t.id);
  };

  return (
    <div
      className={`toast toast-${t.type}${t.exiting ? " toast-exit" : ""}`}
      role={t.type === "error" ? "alert" : "status"}
      aria-live={t.type === "error" ? "assertive" : "polite"}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="toast-icon" aria-hidden="true">
        <Icon size={18} />
      </div>
      <div className="toast-body">
        {t.title ? <div className="toast-title">{t.title}</div> : null}
        <div className="toast-message">{t.message}</div>
      </div>
      {t.action ? (
        <button className="toast-action" type="button" onClick={handleAction}>
          {t.action.label}
        </button>
      ) : null}
      <button
        className="toast-dismiss"
        onClick={() => onDismiss(t.id)}
        type="button"
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
      <div
        ref={progressRef}
        className="toast-progress"
        style={{ animationDuration: `${t.duration}ms` }}
        aria-hidden="true"
      />
    </div>
  );
}
