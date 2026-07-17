import { useState, useRef, useEffect, useMemo } from "react";
import {
  Camera, CameraOff, QrCode, Copy, Check, Scan,
  Wallet, Send, Link2, AlertTriangle, ArrowRight,
} from "lucide-react";
import { useNavigation } from "../router";
import { useCopyToClipboard } from "../hooks/use-copy-to-clipboard";

/* ─── Scanner state machine ────────────────────────────────────────── *
 * idle      – initial state, invite user to open camera
 * scanning  – camera stream active, looking for QR
 * result    – QR decoded, show content + actions
 * error     – camera failed (permission or hardware)
 * Each state has its own visual layout — the old code tried to share
 * one container and ended up with indistinct styling across modes. */
type ScanState = "idle" | "scanning" | "result" | "error";

/* Heuristic content-type detection. A production scanner would parse
   URI schemes (ethereum:, bitcoin:, wc:, etc). For now we classify
   based on string shape. */
type DetectedType = "address" | "payment" | "dapp" | "unknown";

type DetectedBarcode = {
  rawValue?: string;
};

type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
};

type BarcodeDetectorCtor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

function detectType(content: string): DetectedType {
  if (/^0x[a-fA-F0-9]{40}$/.test(content)) return "address";
  if (content.startsWith("ethereum:")) return "payment";
  if (content.startsWith("wc:") || content.startsWith("walletconnect:")) return "dapp";
  return "unknown";
}

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const candidate = (
    globalThis as typeof globalThis & {
      BarcodeDetector?: BarcodeDetectorCtor;
    }
  ).BarcodeDetector;

  return typeof candidate === "function" ? candidate : null;
}

function getTransferTarget(content: string): string | null {
  if (/^0x[a-fA-F0-9]{40}$/.test(content)) {
    return content;
  }

  if (!content.startsWith("ethereum:")) {
    return null;
  }

  const candidate = content
    .slice("ethereum:".length)
    .split(/[/?]/)[0]
    .trim();

  return /^0x[a-fA-F0-9]{40}$/.test(candidate) ? candidate : null;
}

const TYPE_META: Record<DetectedType, { label: string; icon: typeof Wallet; color: string }> = {
  address: { label: "Wallet Address",    icon: Wallet, color: "#14b8a6" },
  payment: { label: "Payment Request",   icon: Send,   color: "#34c759" },
  dapp:    { label: "dApp Connection",   icon: Link2,  color: "#0ea5e9" },
  unknown: { label: "Unknown Format",    icon: QrCode, color: "#8e8e93" },
};

export function QrScannerView() {
  const { navigate } = useNavigation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const frameRef = useRef<number | null>(null);
  const scanInFlightRef = useRef(false);

  const [state, setState] = useState<ScanState>("idle");
  const [scannedResult, setScannedResult] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const {
    copy,
    copied,
    error: copyError,
    reset: resetCopy,
  } = useCopyToClipboard(2000);

  const detectedType = useMemo(
    () => (scannedResult ? detectType(scannedResult) : null),
    [scannedResult],
  );
  const transferTarget = useMemo(
    () => (scannedResult ? getTransferTarget(scannedResult) : null),
    [scannedResult],
  );

  const startCamera = async () => {
    const Detector = getBarcodeDetectorCtor();
    if (!Detector) {
      setCameraError(
        "This browser does not expose a QR scanning engine yet. Use a browser with BarcodeDetector support to scan QR codes.",
      );
      setState("error");
      return;
    }

    try {
      setCameraError(null);
      detectorRef.current = new Detector({ formats: ["qr_code"] });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 320, height: 320 },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState("scanning");
    } catch (err) {
      setCameraError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access in your browser settings to scan QR codes."
          : "Unable to access camera. Ensure your device has a camera available."
      );
      setState("error");
    }
  };

  const stopCamera = () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    scanInFlightRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  /* Clean up the MediaStream on unmount so we don't leak the camera
     after navigation. */
  useEffect(() => {
    return () => stopCamera();
  }, []);

  const handleCopy = async () => {
    if (scannedResult) {
      await copy(scannedResult, "result");
    }
  };

  const handleScanAgain = () => {
    setScannedResult(null);
    resetCopy();
    startCamera();
  };

  const handleReset = () => {
    stopCamera();
    setScannedResult(null);
    setCameraError(null);
    resetCopy();
    setState("idle");
  };

  useEffect(() => {
    if (state !== "scanning") {
      return;
    }

    let cancelled = false;

    const scanFrame = async () => {
      if (cancelled) return;

      const detector = detectorRef.current;
      const video = videoRef.current;

      if (
        detector &&
        video &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !scanInFlightRef.current
      ) {
        scanInFlightRef.current = true;
        try {
          const matches = await detector.detect(video);
          const rawValue = matches.find((match) => match.rawValue?.trim())?.rawValue?.trim();
          if (rawValue) {
            setScannedResult(rawValue);
            stopCamera();
            setState("result");
            return;
          }
        } catch (error) {
          setCameraError(
            error instanceof Error
              ? error.message
              : "Unable to decode a QR code from the camera stream.",
          );
          stopCamera();
          setState("error");
          return;
        } finally {
          scanInFlightRef.current = false;
        }
      }

      frameRef.current = requestAnimationFrame(() => {
        void scanFrame();
      });
    };

    frameRef.current = requestAnimationFrame(() => {
      void scanFrame();
    });

    return () => {
      cancelled = true;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [state]);

  return (
    <div className="view-padded">
      {/* ═════ Hero adapts to state ═════ */}
      {state === "idle" && (
        <div className="qr-hero">
          <div className="qr-hero-icon">
            <Scan size={20} strokeWidth={2.3} />
          </div>
          <div className="qr-hero-body">
            <span className="qr-hero-label">QR SCANNER</span>
            <strong className="qr-hero-title">Scan to verify</strong>
            <span className="qr-hero-sub">Addresses · Payment requests · dApp links</span>
          </div>
        </div>
      )}

      {state === "result" && detectedType && (
        <div className="qr-result-hero">
          <div className="qr-result-check">
            <Check size={22} strokeWidth={3} />
          </div>
          <div className="qr-result-info">
            <span className="qr-result-label">QR CODE DETECTED</span>
            <strong style={{ color: TYPE_META[detectedType].color }}>
              {TYPE_META[detectedType].label}
            </strong>
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="qr-error-hero">
          <div className="qr-error-icon">
            <AlertTriangle size={20} strokeWidth={2.3} />
          </div>
          <div className="qr-error-body">
            <strong>Camera unavailable</strong>
            <span>{cameraError}</span>
          </div>
        </div>
      )}

      {/* ═════ Viewfinder (always visible frame, content swaps) ═════ */}
      <div className={`qr-frame qr-frame-${state}`}>
        {/* Idle: static illustration */}
        {state === "idle" && (
          <div className="qr-view-idle">
            <QrCode size={56} strokeWidth={1.3} className="qr-view-idle-icon" />
            <span className="qr-view-idle-label">Ready to scan</span>
          </div>
        )}

        {/* Scanning: live video + scan line animation */}
        {state === "scanning" && (
          <>
            <video
              ref={videoRef}
              className="qr-frame-video"
              playsInline
              muted
            />
            <div className="qr-scan-line" />
            <div className="qr-frame-hint">Position QR code in frame</div>
          </>
        )}

        {/* Result: dimmed frame with success icon */}
        {state === "result" && (
          <div className="qr-view-result">
            <div className="qr-view-result-burst">
              <Check size={48} strokeWidth={3} />
            </div>
          </div>
        )}

        {/* Error: dimmed frame with warning */}
        {state === "error" && (
          <div className="qr-view-idle">
            <CameraOff size={48} strokeWidth={1.3} className="qr-view-idle-icon" />
            <span className="qr-view-idle-label">Camera blocked</span>
          </div>
        )}

        {/* Corner brackets — always rendered, animate in scanning mode */}
        <div className="qr-corners">
          <span className="qr-corner tl" />
          <span className="qr-corner tr" />
          <span className="qr-corner bl" />
          <span className="qr-corner br" />
        </div>
      </div>

      {/* ═════ Result content + actions ═════ */}
      {state === "result" && scannedResult && detectedType && (
        <div className="qr-result-card">
          <span className="qr-result-field-label">Content</span>
          <code className="qr-result-value">{scannedResult}</code>
        </div>
      )}

      {/* ═════ Action buttons ═════ */}
      <div className="qr-actions">
        {state === "idle" && (
          <button className="qr-btn primary" onClick={startCamera} type="button">
            <Camera size={15} strokeWidth={2.3} />
            Open Camera
          </button>
        )}

        {state === "scanning" && (
          <>
            <button className="qr-btn secondary" onClick={handleReset} type="button">
              <CameraOff size={14} strokeWidth={2.3} />
              Stop
            </button>
          </>
        )}

        {state === "result" && (
          <>
            {transferTarget ? (
              <button
                className="qr-btn primary"
                onClick={() => navigate("send", { recipient: transferTarget })}
                type="button"
              >
                <Send size={14} strokeWidth={2.3} />
                Transfer
                <ArrowRight size={13} strokeWidth={2.6} />
              </button>
            ) : (
              <button className="qr-btn primary" disabled type="button">
                <Send size={14} strokeWidth={2.3} />
                Transfer unavailable
              </button>
            )}
            <button className="qr-btn secondary" onClick={() => void handleCopy()} type="button">
              {copied === "result" ? <Check size={14} strokeWidth={2.6} /> : <Copy size={14} strokeWidth={2.3} />}
              {copied === "result" ? "Copied" : "Copy"}
            </button>
            <button className="qr-btn secondary" onClick={handleScanAgain} type="button">
              <Scan size={14} strokeWidth={2.3} />
              Rescan
            </button>
          </>
        )}

        {state === "error" && (
          <button className="qr-btn primary" onClick={startCamera} type="button">
            <Camera size={15} strokeWidth={2.3} />
            Try Again
          </button>
        )}
      </div>

      {state === "result" && copyError ? (
        <div className="form-error" role="alert">Unable to copy QR content to the clipboard.</div>
      ) : null}

      {/* ═════ Use case chips (idle only, as subtle guidance) ═════ */}
      {state === "idle" && (
        <>
          <div className="qr-usecase-label">WHAT YOU CAN SCAN</div>
          <div className="qr-usecases">
            <div className="qr-usecase">
              <div className="qr-usecase-icon" style={{ background: "linear-gradient(135deg, #14b8a6 0%, #2dd4bf 100%)" }}>
                <Wallet size={12} strokeWidth={2.3} />
              </div>
              <span>Wallet addresses</span>
            </div>
            <div className="qr-usecase">
              <div className="qr-usecase-icon" style={{ background: "linear-gradient(135deg, #34c759 0%, #30d158 100%)" }}>
                <Send size={12} strokeWidth={2.3} />
              </div>
              <span>Payment requests</span>
            </div>
            <div className="qr-usecase">
              <div className="qr-usecase-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
                <Link2 size={12} strokeWidth={2.3} />
              </div>
              <span>dApp connections</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
