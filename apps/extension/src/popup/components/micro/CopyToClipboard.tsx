import { memo, useCallback, type ReactNode } from "react";
import { Copy, Check } from "lucide-react";
import { useCopyToClipboard } from "../../hooks/use-copy-to-clipboard";
import { useHaptics } from "../../hooks/use-haptics";
import { useSound } from "../../hooks/use-sound";
import { DURATION, EASE, prefersReducedMotion } from "../../design/motion";

/**
 * CopyToClipboard — the Copy icon that morphs into a Check on success,
 * with a 180° rotation + haptic + subtle sound.
 *
 * Wraps the low-level `useCopyToClipboard` hook so every copy surface in
 * the wallet can share the same micro-interaction. The checkmark
 * persists for ~1.6s (matching iOS) then fades back to the Copy icon.
 *
 * Looks + feels:
 *   - 180° rotation with scale(0.85 → 1) for a satisfying "flip".
 *   - Haptic success pulse.
 *   - Soft WebAudio "click" (opt-out via `sound={false}`).
 *   - Aria-live region so screen readers announce "Copied".
 *
 * @example
 *   <CopyToClipboard value={address} label="address">
 *     Copy address
 *   </CopyToClipboard>
 */

export interface CopyToClipboardProps {
  /** The string to write to the clipboard. */
  value: string;
  /** Internal label used to track "was THIS one copied recently". Default: "default". */
  label?: string;
  /** Whether to fire haptic + sound. Default: both true. */
  haptic?: boolean;
  sound?: boolean;
  /** Optional children rendered beside the icon. */
  children?: ReactNode;
  /** Icon size. Default: 13 */
  size?: number;
  /** Extra classNames */
  className?: string;
  /** aria-label for the button. Default: "Copy" */
  ariaLabel?: string;
  /** Fires after a successful copy */
  onCopied?: () => void;
}

function CopyToClipboardImpl({
  value,
  label = "default",
  haptic = true,
  sound = true,
  children,
  size = 13,
  className,
  ariaLabel = "Copy",
  onCopied,
}: CopyToClipboardProps) {
  const { copy, copied } = useCopyToClipboard(1600);
  const haptics = useHaptics();
  const audio = useSound();

  const isCopied = copied === label;

  const handleClick = useCallback(async () => {
    const ok = await copy(value, label);
    if (ok) {
      if (haptic) haptics.success();
      if (sound) audio.playCopy();
      onCopied?.();
    } else {
      if (haptic) haptics.error();
      if (sound) audio.playError();
    }
  }, [copy, value, label, haptic, sound, haptics, audio, onCopied]);

  const reduced = prefersReducedMotion();
  const iconStyle: React.CSSProperties = {
    transition: reduced ? "none" : `transform ${DURATION.normal}ms ${EASE.pop}, opacity ${DURATION.fast}ms ${EASE.out}`,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transformOrigin: "center",
  };

  return (
    <button
      type="button"
      className={`motion-press ui-copy-btn${className ? ` ${className}` : ""}`}
      onClick={handleClick}
      aria-label={isCopied ? "Copied" : ariaLabel}
      aria-live="polite"
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: "pointer",
        background: "transparent",
        border: "none",
        padding: 0,
        color: "inherit",
        font: "inherit",
      }}
    >
      <span
        style={{
          position: "relative",
          width: size,
          height: size,
          display: "inline-block",
        }}
        aria-hidden="true"
      >
        <Copy
          size={size}
          style={{
            ...iconStyle,
            position: "absolute",
            inset: 0,
            opacity: isCopied ? 0 : 1,
            transform: isCopied ? "rotate(180deg) scale(0.6)" : "rotate(0deg) scale(1)",
          }}
        />
        <Check
          size={size}
          strokeWidth={3}
          style={{
            ...iconStyle,
            position: "absolute",
            inset: 0,
            color: "#34c759",
            opacity: isCopied ? 1 : 0,
            transform: isCopied ? "rotate(0deg) scale(1)" : "rotate(-180deg) scale(0.6)",
          }}
        />
      </span>
      {children}
    </button>
  );
}

export const CopyToClipboard = memo(CopyToClipboardImpl);
