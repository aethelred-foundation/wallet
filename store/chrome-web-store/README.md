# Chrome Web Store — Aethelred Wallet Submission Bundle

This directory contains every artifact needed to submit the Aethelred
Wallet Chrome extension to the Chrome Web Store. The bundle is
version-controlled so reviewers can see exactly what was submitted at
any point in time, and so the submitted metadata never drifts from the
code that ships.

## Contents

| File | Purpose |
|---|---|
| `LISTING.md` | Store-listing copy: name, summary, full description, category, language. |
| `PERMISSION_JUSTIFICATIONS.md` | Plain-English explanation of every permission the manifest declares. Chrome review reads this verbatim. |
| `PRIVACY_POLICY.md` | Public privacy policy that will be hosted at `https://aethelred.org/privacy`. |
| `SINGLE_PURPOSE.md` | The Chrome Web Store "single purpose" statement. |
| `DATA_USAGE_DISCLOSURE.md` | The exact table Chrome asks developers to fill in. |
| `CHECKLIST.md` | Ordered pre-submit checklist — a human walks through this before hitting Submit. |
| `assets/README.md` | Visual asset specifications for the design team to produce. |

## Submission flow

1. **Developer account**
   - URL: https://chrome.google.com/webstore/devconsole/
   - Publisher: Aethelred Foundation (entity owning the Chrome Web
     Store developer account).
   - One-time $5 USD developer registration fee (per Google account).

2. **Build the submission artifact**
   ```sh
   npm run package:extension
   ```
   Produces `releases/aethelred-wallet-v<version>.zip` plus a
   `dist/SHA256SUMS` manifest of file hashes.

3. **Pre-submit walk-through**
   Run the checklist in `CHECKLIST.md`. Every box must be ticked.

4. **Upload**
   - Developer Dashboard → "Add new item" → upload the ZIP.
   - Paste content from `LISTING.md` into the Store listing tab.
   - Paste content from `PERMISSION_JUSTIFICATIONS.md` into the
     "Permissions" justification fields (one per permission).
   - Paste `SINGLE_PURPOSE.md` into the single-purpose statement field.
   - Fill in `DATA_USAGE_DISCLOSURE.md` under "Privacy practices".
   - Upload the visuals listed in `assets/README.md`.

5. **Review timeline**
   - Initial review: typically 1–3 business days for a well-documented
     submission.
   - Updates: 1–2 business days for minor updates; longer for permission
     changes or major UX changes.
   - Extensions that interact with crypto/finance are often reviewed by
     a specialist team — budget an extra 1–2 days.

## Audit trail

Any change to this bundle must be paired with either:
- a change to the submitted manifest (permissions, scopes, description),
  or
- a legal/compliance review (privacy policy, data usage).

See `CHECKLIST.md` — the bundle is considered out-of-date if the
manifest has changed since `PERMISSION_JUSTIFICATIONS.md` was last
reviewed.
