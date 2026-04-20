# Commit signing — contributor setup

> **Status:** Documented only. Branch protection does NOT currently require
> signed commits on `main`. The enforcement flip is deferred until every
> active contributor has a verified signing key registered on GitHub —
> turning it on sooner would block agent-generated automation commits that
> lack signing keys and would fail CI for no security benefit.

## 1. Why we sign commits

A git commit records the author name and email the committer types into
their local config. Those fields are unauthenticated — any contributor
could author a commit that *looks* like it came from the repo owner.
Signed commits attach a cryptographic signature that GitHub validates
against a public key the contributor has registered on their account.

The Aethelred Wallet handles signing material, audit chains, and
compliance records. A compromised contributor laptop that can author but
not sign commits is trivially detectable; a compromised laptop that can
also forge signatures is the problem we're preventing.

## 2. Choose GPG or SSH

Both produce cryptographic signatures GitHub validates against keys on
your account. Pick whichever fits your local workflow:

- **GPG** — traditional choice; integrates with hardware keys (YubiKey,
  Nitrokey) via OpenPGP card mode.
- **SSH** — newer (git 2.34+); convenient if you already use an SSH key
  for git over SSH or for YubiKey FIDO2.

The sections below cover both.

## 3a. GPG setup

### Generate a key (if you don't already have one)

```bash
gpg --full-generate-key
```

- Key kind: `(1) RSA and RSA` or `(9) ECC and ECC` (ed25519).
- Key size: 4096 for RSA, or accept the default for ed25519.
- Expiry: 2 years is reasonable — you can extend later.
- Email: use the email you've registered on GitHub.

### Export your public key

```bash
gpg --list-secret-keys --keyid-format=long
# Note the key ID after `sec   ed25519/` — e.g. `ABCD1234EF567890`.

gpg --armor --export ABCD1234EF567890 > aethelred-signing.pub
```

### Register the key on GitHub

1. Open `https://github.com/settings/keys`.
2. Click **New GPG key**.
3. Paste the contents of `aethelred-signing.pub` and save.

### Configure git

```bash
git config --global user.signingkey ABCD1234EF567890
git config --global commit.gpgsign true
git config --global tag.gpgsign true
```

### Hardware key (optional, strongly recommended)

If you have a YubiKey or Nitrokey in OpenPGP mode, move the key to the
device instead of keeping it on disk. Once the key is on the device,
commits require a touch / PIN to sign — an attacker with filesystem
access cannot forge signatures.

## 3b. SSH setup

### Generate a signing key

```bash
ssh-keygen -t ed25519 -C "aethelred-signing" -f ~/.ssh/aethelred-signing
```

Keep this key separate from your auth SSH key so a compromised auth key
does not also sign commits.

### Register the key on GitHub as a signing key

1. Open `https://github.com/settings/keys`.
2. Click **New SSH key**.
3. Set **Key type** to `Signing Key` (not `Authentication Key`).
4. Paste the contents of `~/.ssh/aethelred-signing.pub` and save.

### Configure git

```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/aethelred-signing.pub
git config --global commit.gpgsign true
git config --global tag.gpgsign true
```

## 4. Verify signing works

```bash
git commit --allow-empty -m "chore: verify commit signing"
git log --show-signature -1
```

You should see `gpg: Good signature` or `Good "git" signature` in the
log. Push the commit and confirm the `Verified` badge appears on
GitHub.

## 5. Troubleshooting

- **"error: gpg failed to sign the data"** — typically `GPG_TTY` is not
  exported. Add `export GPG_TTY=$(tty)` to your shell profile.
- **"signing failed: No pinentry"** — install `pinentry-mac` (macOS) or
  `pinentry-tty` (Linux) and configure `gpg-agent` to use it.
- **Signature verifies locally but GitHub shows "Unverified"** — the
  email on the commit does not match an email on your GitHub account.
  Add the email at `https://github.com/settings/emails`.

## 6. Migration plan

When we flip the enforcement switch on `main`:

1. Every active contributor must have a verified key on their GitHub
   account, confirmed by a test commit to a scratch branch.
2. Automated agent commits (if any remain) must be routed through a
   build account with its own verified key, OR replaced by PR-based
   workflows where a human signs the merge commit.
3. Update `.github/settings.yml` (or the branch protection API) to set
   `required_signatures: true` on `main`.
4. Announce the change in the repo README and `docs/security/`.

Until that day, sign anyway — the `Verified` badge is a useful signal
even when it's not enforced.
