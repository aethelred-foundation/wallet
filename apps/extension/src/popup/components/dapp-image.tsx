import { memo } from "react";

/**
 * DappImage
 * ─────────
 * A thin `<picture>` wrapper that prefers WebP when available and falls
 * back to the original raster (PNG/JPG) when the browser can't decode
 * WebP — i.e. nothing current; this is mostly about shipping a smaller
 * primary asset. Every modern Chrome/Edge/Safari/Firefox build we care
 * about decodes WebP, but the `<source type="image/webp">` + nested
 * `<img src="...">` pattern costs nothing and protects us from surprise
 * (corporate IE, Chromium forks that disabled WebP, etc.).
 *
 * Why the new wrapper (vs. scattering `<img>` tags):
 *   1. **Single-source lazy-load** — every dapp image we ship is "below
 *      the fold" from a browser perspective (dApp cards load after the
 *      shell renders), so `loading="lazy"` + `decoding="async"` is the
 *      right default everywhere. A wrapper ensures we don't forget it on
 *      new call-sites.
 *   2. **CLS protection** — `width` + `height` are required props.
 *      They're rendered as HTML attributes so the browser reserves
 *      pixel-accurate space before the asset streams in, stopping the
 *      page from jumping as each row loads.
 *   3. **WebP preference** — `scripts/optimize-images.mjs` emits a
 *      `<name>.webp` sibling next to every PNG/JPG under `public/`. The
 *      wrapper points the `<source>` at the WebP path and the `<img>` at
 *      the original raster. If a WebP sibling is missing (e.g. the opt-in
 *      script hasn't been run locally), browsers simply skip the
 *      `<source>` and serve the original — nothing breaks.
 *
 * Asset naming convention (maps `name="dapp-zeroid"` → `/dapp-zeroid.png`):
 *   - Raster:     /public/<name>.<ext>  (ext defaults to png)
 *   - WebP:       /public/<name>.webp
 *   - Retina 2x:  /public/<name>@2x.<ext>  and  /public/<name>@2x.webp
 *
 * @example
 *   <DappImage name="dapp-zeroid" width={56} height={56} alt="ZeroID" />
 *
 * Retina (Retina / HiDPI) pairs are wired through `srcset` so browsers
 * pick the right density automatically. No JS DPR detection needed.
 */
export interface DappImageProps {
  /** Base filename under /public/ without extension (e.g. "dapp-zeroid"). */
  name: string;
  /** Required — displayed pixel width. Prevents layout shift. */
  width: number;
  /** Required — displayed pixel height. Prevents layout shift. */
  height: number;
  /** Alt text for accessibility. Use "" for decorative images. */
  alt: string;
  /** Base extension of the fallback raster. Default: "png". */
  ext?: "png" | "jpg" | "jpeg";
  /** Pass-through className on the <img> element. */
  className?: string;
  /** Optional inline style override. */
  style?: React.CSSProperties;
  /** Override lazy loading if this image IS the hero (rare). */
  eager?: boolean;
}

function DappImageImpl({
  name,
  width,
  height,
  alt,
  ext = "png",
  className,
  style,
  eager = false,
}: DappImageProps) {
  const base = `/${name}`;
  const webp1x = `${base}.webp`;
  const webp2x = `${base}@2x.webp`;
  const raster1x = `${base}.${ext}`;
  const raster2x = `${base}@2x.${ext}`;

  return (
    <picture>
      <source
        type="image/webp"
        srcSet={`${webp1x} 1x, ${webp2x} 2x`}
      />
      <img
        src={raster1x}
        srcSet={`${raster1x} 1x, ${raster2x} 2x`}
        width={width}
        height={height}
        alt={alt}
        className={className}
        style={style}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
      />
    </picture>
  );
}

export const DappImage = memo(DappImageImpl);
