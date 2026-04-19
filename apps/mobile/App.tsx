import { useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Platform,
  TextInput,
  Keyboard,
} from "react-native";
import { WebView } from "react-native-webview";

// Public Vite tunnel URL (via cloudflared). Lets a teammate on a
// different network/country fetch the popup HTML+JS through Cloudflare's
// edge instead of needing direct LAN access.
//
// To rotate this URL after restarting cloudflared:
//   1. cloudflared tunnel --url http://localhost:3301
//   2. Copy the printed `https://*.trycloudflare.com` URL
//   3. Replace the value below
//
// To use a local LAN preview instead, override at runtime via the
// address bar input field inside the Expo shell, or temporarily set:
//   const DEFAULT_URL = "http://<your-LAN-IP>:3301/popup.html";
const DEFAULT_URL =
  "https://savannah-mathematical-performer-neck.trycloudflare.com/popup.html";

/**
 * CSS + viewport overrides injected into the WebView on every load.
 *
 * The real Chrome extension popup is sized for a desktop Chrome popup
 * (`width: 420px`, `min-height: 640px`, `.canvas { max-height: 640px }`).
 * On a phone those rules leave the popup stranded in the top-left with
 * dead space below, so we override them with !important rules that only
 * run inside the mobile WebView. The real extension's stylesheet is
 * untouched — these rules never ship to production.
 *
 * Also sets a proper viewport meta + `prefers-color-scheme: dark` so the
 * popup renders in the right theme on first paint without a flash.
 */
const INJECTED_CSS = `
  (() => {
    // 1. Viewport — force device-width, disable user zoom so taps feel native
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'viewport');
      document.head.appendChild(meta);
    }
    meta.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
    );

    // 2. Force dark theme — the popup supports both themes via data-theme
    document.documentElement.setAttribute('data-theme', 'dark');

    // 3. Stretch the popup shell + canvas to fill the phone viewport.
    //    The canvas normally has max-height: 640px which caps the view
    //    at 640px on a tall phone — we remove that cap here.
    const style = document.createElement('style');
    style.setAttribute('data-source', 'aethelred-mobile-preview');
    style.textContent = \`
      html, body, #root {
        width: 100% !important;
        min-height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #000 !important;
      }
      .shell.popup-shell {
        width: 100vw !important;
        max-width: 100vw !important;
        min-width: 0 !important;
        min-height: 100vh !important;
        padding: 0 !important;
        display: block !important;
      }
      .canvas {
        max-height: none !important;
        min-height: 100vh !important;
        height: 100vh !important;
        width: 100% !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
      }
      /* Hide browser scrollbars — the popup's own scroll containers
       * already handle overflow cleanly. */
      ::-webkit-scrollbar { width: 0; height: 0; }
    \`;
    document.head.appendChild(style);
    true;
  })();
`;

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [url, setUrl] = useState(DEFAULT_URL);
  const [inputUrl, setInputUrl] = useState(DEFAULT_URL);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /* When false, the address bar collapses to a thin 18 px strip so the
   * WebView gets every available pixel. Tap the thin strip (or the
   * "A" logo) to toggle. This is the main UX knob for "give me more
   * vertical space to review the popup." */
  const [barExpanded, setBarExpanded] = useState(true);

  const handleGo = () => {
    setUrl(inputUrl.trim());
    setError(null);
    Keyboard.dismiss();
    // Collapse the bar after submitting so the user can immediately
    // review the freshly-loaded page without tapping again.
    setBarExpanded(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />

      {/* Address bar — expanded (full URL + reload) or collapsed (18 px strip).
       * Collapsing hands the ~44 px it occupies back to the WebView, which
       * on a phone with ~800 px usable height is a ~5 % review-space gain.
       * Tapping the thin strip re-expands it. */}
      {barExpanded ? (
        <View style={styles.bar}>
          <View style={styles.urlRow}>
            <TouchableOpacity
              onPress={() => setBarExpanded(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.logo}>A</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.urlInput}
              value={inputUrl}
              onChangeText={setInputUrl}
              onSubmitEditing={handleGo}
              returnKeyType="go"
              autoCapitalize="none"
              autoCorrect={false}
              selectTextOnFocus
              placeholderTextColor="#666"
            />
            <TouchableOpacity
              style={styles.reloadBtn}
              onPress={() => webViewRef.current?.reload()}
            >
              <Text style={styles.reloadText}>↻</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.collapseBtn}
              onPress={() => setBarExpanded(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.collapseText}>▲</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.barCollapsed}
          onPress={() => setBarExpanded(true)}
          activeOpacity={0.7}
        >
          <View style={styles.barCollapsedHandle} />
        </TouchableOpacity>
      )}

      {/* WebView */}
      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠</Text>
          <Text style={styles.errorTitle}>Cannot reach wallet</Text>
          <Text style={styles.errorDetail}>{error}</Text>
          <Text style={styles.errorHint}>
            Make sure the Vite dev server is running:{"\n"}
            cd wallet && npm run dev:extension
          </Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              setError(null);
              setLoading(true);
            }}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <WebView
          ref={webViewRef}
          source={{ uri: url }}
          style={styles.webview}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={(e) =>
            setError(e.nativeEvent.description || "Failed to load")
          }
          onHttpError={(e) =>
            setError(`HTTP ${e.nativeEvent.statusCode}: ${e.nativeEvent.description}`)
          }
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          scalesPageToFit={false}
          // Override the popup's desktop-sized CSS so it fills the phone
          // viewport in full (see INJECTED_CSS definition above).
          injectedJavaScript={INJECTED_CSS}
        />
      )}

      {loading && !error && (
        <View style={styles.loadingOverlay}>
          <Text style={styles.loadingText}>Loading Aethelred Wallet...</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#121212",
  },
  bar: {
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 10,
    paddingTop: Platform.OS === "android" ? 28 : 2,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#2c2c2e",
  },
  /* Collapsed 16 px strip that replaces the address bar. Tap to expand.
   * Keeping some visible surface area (not 0) gives the user an obvious
   * re-expand affordance and covers the Android status bar area. */
  barCollapsed: {
    height: Platform.OS === "android" ? 18 : 8,
    backgroundColor: "#0a0a0a",
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  barCollapsedHandle: {
    width: 40,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#3a3a3c",
  },
  urlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  logo: {
    color: "#c41e1e",
    fontSize: 16,
    fontWeight: "800",
    width: 22,
    textAlign: "center",
  },
  urlInput: {
    flex: 1,
    backgroundColor: "#2c2c2e",
    color: "#e5e5e7",
    fontSize: 11,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  reloadBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: "#2c2c2e",
    alignItems: "center",
    justifyContent: "center",
  },
  reloadText: {
    color: "#e5e5e7",
    fontSize: 15,
  },
  collapseBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: "#2c2c2e",
    alignItems: "center",
    justifyContent: "center",
  },
  collapseText: {
    color: "#8e8e93",
    fontSize: 10,
    lineHeight: 12,
  },
  webview: {
    flex: 1,
    backgroundColor: "#121212",
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#121212",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: "#8e8e93",
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: "#121212",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  errorIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  errorTitle: {
    color: "#e5e5e7",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  errorDetail: {
    color: "#ff453a",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 16,
  },
  errorHint: {
    color: "#8e8e93",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 20,
  },
  retryBtn: {
    backgroundColor: "#c41e1e",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
