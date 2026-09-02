/**
 * Apply the popup splash state before the React application loads.
 *
 * This intentionally remains a tiny, dependency-free external script so it
 * executes immediately after the splash element is parsed. Manifest V3 blocks
 * inline JavaScript; `script-src 'self'` permits this packaged file.
 */
(function initializeSplashSession() {
  const splash = document.getElementById("splash-screen");
  if (!splash) return;

  try {
    const sessionKey = "aethelred:splash-seen";
    if (sessionStorage.getItem(sessionKey)) {
      splash.classList.add("skip");
      return;
    }

    sessionStorage.setItem(sessionKey, "1");
  } catch {
    // Restricted/private contexts can deny storage. Showing the splash is the
    // safe visual fallback for that opening.
  }
})();
