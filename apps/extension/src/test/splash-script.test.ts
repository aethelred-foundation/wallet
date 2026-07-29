import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

function findSplashScript(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const monorepoPath = resolve(
      dir,
      "apps",
      "extension",
      "public",
      "splash.js",
    );
    if (existsSync(monorepoPath)) return monorepoPath;

    const extensionPath = resolve(dir, "public", "splash.js");
    if (existsSync(extensionPath)) return extensionPath;
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate apps/extension/public/splash.js");
}

const SPLASH_SCRIPT = readFileSync(findSplashScript(), "utf8");
const SPLASH_SESSION_KEY = "aethelred:splash-seen";

function executeSplashScript(storage: Pick<Storage, "getItem" | "setItem">) {
  runInNewContext(SPLASH_SCRIPT, {
    document,
    sessionStorage: storage,
  });
}

describe("packaged popup splash script", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="splash-screen"></div>';
    sessionStorage.clear();
  });

  it("marks the first popup opening as seen without skipping the splash", () => {
    executeSplashScript(sessionStorage);

    expect(sessionStorage.getItem(SPLASH_SESSION_KEY)).toBe("1");
    expect(document.getElementById("splash-screen")).not.toHaveClass("skip");
  });

  it("skips the splash after it has already been seen this session", () => {
    sessionStorage.setItem(SPLASH_SESSION_KEY, "1");

    executeSplashScript(sessionStorage);

    expect(document.getElementById("splash-screen")).toHaveClass("skip");
  });

  it("falls back to showing the splash when session storage is unavailable", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
      setItem: vi.fn(),
    };

    expect(() => executeSplashScript(storage)).not.toThrow();
    expect(document.getElementById("splash-screen")).not.toHaveClass("skip");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("is a no-op when the popup has no splash element", () => {
    document.body.innerHTML = "";

    expect(() => executeSplashScript(sessionStorage)).not.toThrow();
    expect(sessionStorage.getItem(SPLASH_SESSION_KEY)).toBeNull();
  });
});
