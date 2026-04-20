import { forwardRef, useCallback, type ButtonHTMLAttributes, type ReactNode } from "react";
import { assertNever } from "@aethelred/wallet-observability";
import { useHaptics } from "../../hooks/use-haptics";
import { useSound } from "../../hooks/use-sound";

/**
 * PressableButton — the standard button with built-in tactile feedback.
 *
 * Wraps an HTML `<button>` with three enhancements:
 *
 *   1. Scale-down to 0.97 on press via the `.motion-press` utility class,
 *      driven by an existing CSS transition — no JS animation loop.
 *   2. Haptic feedback on press (respects the user's `haptics-enabled`
 *      preference + `prefers-reduced-motion`).
 *   3. Optional audio tick on press — off by default to avoid being
 *      annoying on every tap; consumers opt in via the `sound` prop.
 *
 * The button is intentionally unopinionated about its own visual style.
 * It inherits whatever className you pass, so you can drop it into any
 * existing UI as a one-line upgrade without restyling.
 *
 * @example
 *   <PressableButton
 *     className="v2-action"
 *     onClick={handleSend}
 *     haptic="impact"
 *     sound="tap"
 *   >
 *     Send
 *   </PressableButton>
 */

export type HapticMode = "none" | "selection" | "impact-light" | "impact" | "impact-heavy" | "success" | "warning" | "error";
export type SoundMode = "none" | "tap" | "copy" | "success" | "error";

export interface PressableButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Haptic feedback to fire on press. Default: "selection". */
  haptic?: HapticMode;
  /** Optional sound to play on press. Default: "none". */
  sound?: SoundMode;
  children?: ReactNode;
}

export const PressableButton = forwardRef<HTMLButtonElement, PressableButtonProps>(
  function PressableButton(
    { haptic = "selection", sound = "none", onClick, className, children, type, ...rest },
    ref,
  ) {
    const haptics = useHaptics();
    const audio = useSound();

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        // Fire haptic first so the "tactile" response aligns with the
        // visual scale-down that the browser has just painted.
        switch (haptic) {
          case "none":
            break;
          case "selection":
            haptics.selection();
            break;
          case "impact-light":
            haptics.impact("light");
            break;
          case "impact":
            haptics.impact("medium");
            break;
          case "impact-heavy":
            haptics.impact("heavy");
            break;
          case "success":
            haptics.success();
            break;
          case "warning":
            haptics.warning();
            break;
          case "error":
            haptics.error();
            break;
          default:
            assertNever(haptic, "PressableButton.haptic");
        }

        switch (sound) {
          case "none":
            break;
          case "tap":
            audio.playTap();
            break;
          case "copy":
            audio.playCopy();
            break;
          case "success":
            audio.playSuccess();
            break;
          case "error":
            audio.playError();
            break;
          default:
            assertNever(sound, "PressableButton.sound");
        }

        onClick?.(event);
      },
      [haptic, sound, haptics, audio, onClick],
    );

    const combinedClass = `motion-press${className ? ` ${className}` : ""}`;

    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={combinedClass}
        onClick={handleClick}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
