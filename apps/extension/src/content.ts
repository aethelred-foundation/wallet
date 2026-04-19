/**
 * Content script entry point.
 * Injects the inpage provider into the page's main world and
 * sets up the message bridge between page and background.
 */

import { initContentBridge } from "./content-bridge";

// Inject inpage.js into the page's main world
function injectProvider(): void {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("inpage.js");
  script.type = "module";
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

injectProvider();
initContentBridge();

console.info("[Aethelred Wallet content] Provider injected and bridge active");
