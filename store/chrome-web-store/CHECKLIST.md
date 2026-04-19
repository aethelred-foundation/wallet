# Chrome Web Store Submission Checklist — Aethelred Wallet

A human walks through this checklist BEFORE opening the Chrome Web
Store Developer Dashboard. Every checkbox must be ticked. Do not skip
items — the checklist exists so the same person can sign off on both
engineering and compliance aspects of the release.

Copy this file into a pull request titled `Release: CWS vX.Y.Z` when
starting a submission run; the PR reviewer ticks each box as the owner
completes it.

---

## Pre-submit — engineering

- [ ] Version bumped in `apps/extension/public/manifest.json` (and
      `apps/extension/package.json`) per SemVer. Patch for bugfix-only,
      Minor for new features, Major for breaking UX.
- [ ] `CHANGELOG.md` entry written under a new version heading with
      human-readable release notes (not just a commit log).
- [ ] `npm run type-check` passes across the workspace.
- [ ] `npm run test:run --workspace @aethelred/wallet-extension`
      passes.
- [ ] `npx vitest run manifest --reporter=basic` (in
      `apps/extension/`) passes — the manifest contract test is green.
- [ ] `npm run build --workspace @aethelred/wallet-extension` succeeds.
- [ ] `npm run package:extension` succeeds and emits
      `releases/aethelred-wallet-v<version>.zip` under 10 MB.
- [ ] The emitted ZIP loads cleanly in Chrome as an unpacked
      extension (test via `chrome://extensions` → "Load unpacked",
      pointed at `apps/extension/dist/`).
- [ ] A fresh Chrome profile can install the ZIP via drag-and-drop
      onto `chrome://extensions`. Popup, options, background worker
      and content-script injection all work.
- [ ] `dist/SHA256SUMS` was produced alongside the ZIP; the hash
      values are attached to the release notes for public
      verification.
- [ ] Re-running `npm run package:extension` on a clean checkout of
      the tagged commit produces IDENTICAL file hashes (proves build
      determinism). If it does not, open a blocker investigation
      before submitting.

## Pre-submit — compliance & legal

- [ ] `PERMISSION_JUSTIFICATIONS.md` lists every permission and host
      permission that `manifest.json` declares. The manifest contract
      test enforces this, but re-read the doc once more — the review
      team reads the words, not just the presence.
- [ ] `PRIVACY_POLICY.md` has been re-read by the privacy counsel
      designated in the release ticket. Effective / revised dates are
      current.
- [ ] Privacy policy is live at https://aethelred.org/privacy. Fetch
      the URL and confirm it matches `PRIVACY_POLICY.md` byte for
      byte (or a counsel-approved derivation thereof).
- [ ] `SINGLE_PURPOSE.md` still accurately describes what the
      extension does — no scope creep has happened since last release.
- [ ] `DATA_USAGE_DISCLOSURE.md` matches current data practices. If
      the extension now handles a data category it did not handle
      before, this document MUST be updated before submission.
- [ ] SOC-2 scope has been reviewed this week. Confirm against
      `docs/compliance/SOC2_SCOPE.md` (to be added once compliance
      team stands the document up). If no policy change has happened
      the review may be a rubber-stamp; the point is that someone
      looked.

## Pre-submit — visual assets

- [ ] `store/chrome-web-store/assets/store-icon-128.png` delivered.
- [ ] `store/chrome-web-store/assets/promo-tile-440x280.png`
      delivered.
- [ ] At least one `screenshot-NN-*.png` at 1280x800 delivered (up to
      five).
- [ ] `promo-large-920x680.png` delivered (optional but recommended).
- [ ] `promo-marquee-1400x560.png` delivered if submitting for
      Featured consideration.
- [ ] Every asset has a `REVIEWED_BY` entry in its design ticket with
      brand + legal sign-off.

## Pre-submit — Dashboard

- [ ] Developer publisher account is active and the $5 registration
      fee has been paid.
- [ ] Publisher account email (`publisher@aethelred.org` or the
      current designated inbox) is verified on the dashboard.
- [ ] 2-factor authentication is enabled on the Google account used
      for publisher access.
- [ ] The submitting operator has write access to the item in the
      dashboard (not just read).

## Submit

- [ ] Upload ZIP to "Package" tab.
- [ ] Paste copy from `LISTING.md` into "Store listing" tab.
- [ ] Paste each permission block from `PERMISSION_JUSTIFICATIONS.md`
      into the corresponding "Permissions" field.
- [ ] Paste `SINGLE_PURPOSE.md` into the single-purpose field.
- [ ] Complete "Privacy practices" tab using `DATA_USAGE_DISCLOSURE.md`.
- [ ] Confirm the privacy-policy URL in the dashboard matches the
      publicly hosted URL.
- [ ] Upload visual assets; confirm Chrome accepts every file
      (rejects on size mismatch are common; re-produce if rejected).
- [ ] Preview the store listing and sanity-check for typos.
- [ ] Hit **Submit for review**.

## Post-submit

- [ ] Tag the release in git: `git tag -s v<version> -m "CWS release
      v<version>"`. Push the signed tag.
- [ ] Attach `releases/aethelred-wallet-v<version>.zip` and the
      corresponding `SHA256SUMS` content to the GitHub release.
- [ ] Post the submission timestamp in the #release Slack channel
      with the expected review window.
- [ ] File a followup calendar event for 72 hours to check the review
      state.
- [ ] If Chrome requests changes, open a new branch `cws/<item-id>-
      response-N`, address the feedback, and re-run this checklist
      from the top.

## Rollback

If Chrome rejects the submission AND the previous version must be
re-published urgently:

- [ ] Identify the last known-good submission ZIP
      (`releases/aethelred-wallet-v<previous>.zip`).
- [ ] Confirm its `SHA256SUMS` match the published hash attached to
      the prior GitHub release.
- [ ] Upload that ZIP as a fresh package version (Chrome does not
      allow re-submitting the exact same version number; bump patch).
- [ ] File a postmortem ticket with the rejection reason so the next
      release does not repeat the mistake.
