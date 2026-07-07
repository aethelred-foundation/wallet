# Permission Justifications — Aethelred Wallet

Chrome Web Store requires a plain-English justification for every
permission and every host permission a Manifest V3 extension requests.
This document is the canonical source of truth: it is pasted verbatim
into the dashboard during submission, and the automated manifest test
in `apps/extension/src/test/manifest.test.ts` asserts that every
permission the manifest declares is present in this file.

If you add a permission to the manifest you MUST also add an entry
here. The test will fail until you do.

---

## Format

Each permission block follows the same three-part structure that
Chrome review looks for:

1. **Why it's needed** — the feature that requires this permission.
2. **What it's used for** — the concrete API calls and data flows.
3. **What it's NOT used for** — an explicit anti-misuse statement.

---

## permissions

### Permission: `storage`

- **Why it's needed**: Aethelred Wallet must persist encrypted wallet
  state — accounts, policies, audit log, session metadata — across
  browser sessions. If storage were not available the user would have
  to re-import their wallet every time they closed the browser.
- **What it's used for**: `chrome.storage.local` writes of the
  encrypted wallet vault, the policy bundle, the active network
  selection, the append-only audit log, and UI preferences (theme,
  language).
- **What it's NOT used for**: NOT used to sync data to any remote
  server. NOT used to read cookies or browser history. `chrome.storage.sync`
  is NOT used — keys and vaults never leave the device via Google
  account sync.

### Permission: `activeTab`

- **Why it's needed**: When the user invokes the wallet from a dapp,
  Aethelred needs to read the origin of the current tab to confirm
  which dapp is requesting a signature, render the correct approval
  context, and apply origin-specific policies.
- **What it's used for**: Reading the URL / origin of the currently-
  active tab when the user clicks the wallet action button or
  approves a dapp request. Used to attach origin metadata to audit log
  entries.
- **What it's NOT used for**: NOT used to scrape page content, read
  form fields, capture screenshots, or track browsing behavior across
  tabs. NOT used to access tabs the user has not explicitly activated.

### Permission: `scripting`

- **Why it's needed**: Aethelred injects a minimal provider shim
  (`inpage.js`) into dapp origins so dapps can call
  `window.ethereum.request(...)` according to the EIP-1193 standard.
  Without `scripting`, the EVM provider interface cannot be exposed
  and dapp compatibility is impossible.
- **What it's used for**: Registering the content script declared in
  the manifest, which in turn injects `inpage.js` to provide the
  EIP-1193 provider. The injected script only exchanges signing
  requests with the background service worker via `window.postMessage`.
- **What it's NOT used for**: NOT used to execute arbitrary scripts
  on user request. NOT used to modify page content beyond the provider
  injection. NOT used to exfiltrate page data — the content script
  only brokers messages between the page and the wallet.

---

## host_permissions

The manifest enumerates specific HTTPS RPC endpoints rather than using
`<all_urls>` or `*://*/*`. This is a deliberate CWS-hardening choice:
every host permission corresponds to a chain we officially support, an
auxiliary market-data endpoint, or an IPFS gateway for NFT metadata.

### Host: `https://eth.llamarpc.com/*`, `https://ethereum-rpc.publicnode.com/*`, `https://cloudflare-eth.com/*`

- **Why needed**: Ethereum mainnet JSON-RPC endpoints (public tier).
  Used to read balances, estimate gas, and submit signed transactions.
- **Not used for**: NOT used for analytics, tracking, or sending any
  user-identifying information. Only standard Ethereum JSON-RPC
  method calls (`eth_call`, `eth_getBalance`, `eth_sendRawTransaction`,
  etc.) are issued.

### Host: `https://rpc.ankr.com/*`

- **Why needed**: Ankr hosts public RPC tiers for multiple chains the
  wallet supports (Ethereum, Polygon, BSC, Avalanche, Arbitrum,
  Optimism, Scroll, Mantle, Celo, Fantom, Blast, etc.) via path-based
  subdomain routing. Using a single wildcard for `rpc.ankr.com` is
  narrower than adding a separate entry per chain.
- **Not used for**: NOT used with any API key — only the free public
  tier is hit. NOT used to post user data.

### Host: `https://polygon.llamarpc.com/*`, `https://polygon-bor-rpc.publicnode.com/*`

- **Why needed**: Polygon PoS JSON-RPC. Same read/write pattern as the
  Ethereum endpoints above.
- **Not used for**: NOT used for analytics or tracking.

### Host: `https://base.llamarpc.com/*`, `https://base-rpc.publicnode.com/*`

- **Why needed**: Base (Coinbase L2) JSON-RPC.
- **Not used for**: NOT used for analytics or tracking.

### Host: `https://optimism.llamarpc.com/*`, `https://optimism-rpc.publicnode.com/*`

- **Why needed**: Optimism JSON-RPC.
- **Not used for**: NOT used for analytics or tracking.

### Host: `https://arbitrum.llamarpc.com/*`, `https://arbitrum-one-rpc.publicnode.com/*`

- **Why needed**: Arbitrum One JSON-RPC.
- **Not used for**: NOT used for analytics or tracking.

### Host: `https://avalanche-c-chain-rpc.publicnode.com/*`

- **Why needed**: Avalanche C-Chain JSON-RPC.
- **Not used for**: NOT used for analytics or tracking.

### Host: `https://bsc.llamarpc.com/*`, `https://bsc-rpc.publicnode.com/*`

- **Why needed**: BNB Smart Chain JSON-RPC.
- **Not used for**: NOT used for analytics or tracking.

### Host: `https://gnosis-rpc.publicnode.com/*`

- **Why needed**: Gnosis Chain JSON-RPC.
- **Not used for**: NOT used for analytics or tracking.

### Host: `https://linea-rpc.publicnode.com/*`

- **Why needed**: Linea JSON-RPC.
- **Not used for**: NOT used for analytics or tracking.

### Host: `https://mantle-rpc.publicnode.com/*`

- **Why needed**: Mantle JSON-RPC.
- **Not used for**: NOT used for analytics or tracking.

### Host: `https://fantom-rpc.publicnode.com/*`

- **Why needed**: Fantom Opera JSON-RPC.
- **Not used for**: NOT used for analytics or tracking.

### Host: `https://blast-rpc.publicnode.com/*`

- **Why needed**: Blast JSON-RPC.
- **Not used for**: NOT used for analytics or tracking.

### Host: `https://opbnb-rpc.publicnode.com/*`

- **Why needed**: opBNB JSON-RPC.
- **Not used for**: NOT used for analytics or tracking.

### Host: `https://rpc.aethelred.network/*`

- **Why needed**: Aethelred sovereign-network JSON-RPC. First-party
  chain whose node infrastructure is operated by the Aethelred
  Foundation.
- **Not used for**: NOT used for analytics or tracking. Same JSON-RPC
  surface as the public chains above.

### Host: `https://ethereum-sepolia-rpc.publicnode.com/*`, `https://polygon-amoy-bor-rpc.publicnode.com/*`, `https://base-sepolia-rpc.publicnode.com/*`

- **Why needed**: Testnets that users explicitly opt into for testing.
  Gated behind a "testnets enabled" toggle in the options page, so the
  hosts are never contacted on a fresh install.
- **Not used for**: NOT used for analytics or tracking.

### Host: `https://api.coingecko.com/*`

- **Why needed**: Price quotes for supported assets (displayed as
  informational fiat-equivalent values next to balances) and trending-
  news cards on the Markets view.
- **Not used for**: NOT used for any user-identifying request. Only
  the free public `/api/v3/simple/price`, `/api/v3/global`, and
  `/api/v3/search/trending` endpoints are called with static query
  parameters.

### Host: `https://ipfs.io/*`

- **Why needed**: Default IPFS gateway for fetching NFT metadata
  (images, JSON descriptors) from URIs that start with `ipfs://`. The
  user can change the gateway in settings; the manifest declares the
  default so a fresh install can render NFTs without opening options.
- **Not used for**: NOT used to upload data, only GET requests for
  content-addressed (hash-keyed) assets referenced by the user's
  tokens.

### Aethelred public-testnet endpoints (`http://` validator IPs)

- **Hosts** (EVM JSON-RPC `:8545`, Cosmos LCD REST `:1317`):
  - `http://54.165.44.130:8545`, `http://54.165.44.130:1317`
  - `http://35.255.95.138:8545`, `http://35.255.95.138:1317`
  - `http://35.253.47.12:8545`, `http://35.253.47.12:1317`
  - `http://34.44.135.107:8545`, `http://34.44.135.107:1317`
  - `http://35.232.198.204:8545`, `http://35.232.198.204:1317`
  - `http://127.0.0.1:8545`, `http://127.0.0.1:1317` (local development)
- **Why**: the Aethelred testnet validators expose JSON-RPC and REST
  over plain `http` at raw IPs during the pre-DNS phase. The wallet
  reads chain state (balances, nonces, gas) and broadcasts transactions
  through these endpoints, so they must be present in both
  `host_permissions` and the `connect-src` CSP directive.
- **Not used for**: read/broadcast only; no user data is sent beyond the
  transactions and queries the user initiates.
- **Removal plan**: replaced by a single `https://rpc.testnet.aethelred.io`
  (already permitted) once the load-balanced DNS endpoint with TLS is
  provisioned; the raw-IP `http` entries are then dropped.

---

## Anti-misuse summary

Aethelred Wallet never:

- Collects, stores, or transmits user browsing history.
- Sends any user data to Aethelred or a third party unless the user
  explicitly initiates an RPC call, a WalletConnect session, or a
  support-bundle export.
- Injects ads, content scripts unrelated to the provider shim, or any
  remote-code-loaded script.
- Uses `chrome.storage.sync`, `chrome.identity`, `chrome.cookies`, or
  any permission not declared in the manifest.
