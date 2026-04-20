import { memo, useEffect, useRef, type ReactNode } from "react";
import { useHaptics } from "../../hooks/use-haptics";
import { prefersReducedMotion } from "../../design/motion";

/**
 * ErrorShake — horizontal shake animation for form validation failures.
 *
 * Passes children through; adds a keyframe-driven horizontal shake when
 * the `trigger` prop changes (any falsy → truthy transition plays the
 * animation). Useful pattern: pin `trigger` to `errorMessage` so every
 * validation failure shakes the input, and clearing the error returns
 * it to rest.
 *
 * Also fires `haptics.error()` the moment the shake starts, so sighted
 * and non-sighted users both feel the failure.
 *
 * Implementation:
 *
 *   - Animation is the `shake` keyframe defined in motion.css.
 *   - A monotonically increasing `animKey` forces React to remount the
 *     div, replaying the animation from scratch each time `trigger`
 *     toggles on.
 *   - Reduced-motion: no animation; haptic still fires (error haptics
 *     are information, not decoration).
 *
 * @example
 *   const [error, setError] = useState<string | null>(null);
 *   <ErrorShake trigger={error}>
 *     <input onChange={e => validate(e.target.value)} />
 *     {error && <span>{error}</span>}
 *   </ErrorShake>
 */

export interface ErrorShakeProps {
  /** The shake replays whenever this value changes (truthy-to-new-truthy or falsy-to-truthy). */
  trigger: unknown;
  /** Whether to fire haptics.error() alongside the shake. Default: true */
  haptic?: boolean;
  /** Wrapped content */
  children: ReactNode;
  /** Passthrough className */
  className?: string;
}

function ErrorShakeImpl({ trigger, haptic = true, children, className }: ErrorShakeProps) {
  const haptics = useHaptics();
  const prevTriggerRef = useRef<unknown>(null);
  const animKeyRef = useRef<number>(0);

  // Detect fresh truthy transitions. We don't replay on every trigger
  // change — only when the prev was falsy OR the new value differs from
  // the prev (so consumers re-setting the same error re-shake).
  if (
    trigger &&
    (prevTriggerRef.current == null ||
      prevTriggerRef.current === false ||
      prevTriggerRef.current === "" ||
      prevTriggerRef.current !== trigger)
  ) {
    animKeyRef.current++;
  }
  prevTriggerRef.current = trigger;

  // Fire haptic on every shake (the effect runs whenever animKey bumps).
  useEffect(() => {
    if (animKeyRef.current > 0 && haptic) {
      haptics.error();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animKeyRef.current, haptic]);

  const animation = trigger && !prefersReducedMotion()
    ? "shake 420ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both"
    : undefined;

  return (
    <div
      key={animKeyRef.current}
      className={className}
      style={{ animation }}
    >
      {children}
    </div>
  );
}

export const ErrorShake = memo(ErrorShakeImpl);
