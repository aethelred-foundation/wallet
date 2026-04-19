# Aethelred Wallet Android Design System

## Token inventory

All tokens live under `ui/theme` and are surfaced through
`AethelredTheme`'s `CompositionLocal` bindings. Screens never hard-code
`dp` or hex literals — they read from the locals.

### Colour

| Role           | Light     | Dark      | Notes                              |
| -------------- | --------- | --------- | ---------------------------------- |
| Background     | `#FFFFFF` | `#121212` | Scaffold base.                     |
| Surface        | `#ECECF0` | `#1E1E20` | Cards + sheets.                    |
| Surface var.   | `#DCDCE5` | `#2A2A2D` | Raised rails.                      |
| Ink primary    | `#1C1C1E` | `#E5E5E7` | Headlines + body.                  |
| Ink soft       | `#5F5F66` | `#8E8E93` | Captions, labels.                  |
| Accent         | `#C41E1E` | `#C41E1E` | Brand red — never remapped.        |
| Success        | `#2EA144` | `#34C759` | Confirmations, positive deltas.    |
| Warning        | `#FF9F0A` | `#FF9F0A` | Elevated risk.                     |
| Danger         | `#D92D20` | `#FF3B30` | Denials, revokes.                  |
| Outline        | `#C6C6CC` | `#3C3C3E` | Card border.                       |

### Spacing

`AethelredSpacing` exposes: `hair (2)`, `xxs (4)`, `xs (8)`, `sm (12)`,
`md (16)`, `lg (20)`, `xl (24)`, `xxl (32)`, `xxxl (40)`, `gigantic (48)`,
`hero (64)`. All values are on a 4 dp baseline.

### Radii

`AethelredRadii` exposes shapes for `xs (4)`, `sm (8)`, `md (12)`,
`lg (16)`, `xl (20)`, `xxl (24)`, and `pill` (`CircleShape`).

### Motion

`AethelredMotion` exposes durations (`75`, `150`, `250`, `400`, `600` ms)
plus `FastOutSlowInEasing`, `LinearOutSlowInEasing`, and a custom
`emphasized` CubicBezier. Springs: `springMedium` (medium-bouncy) and
`springStiff`.

### Elevation

Six-level ramp from `level0 (0)` to `level5 (16)`. Tonal + shadow
elevation stay in lockstep.

### Haptics

`AethelredHaptics` is a semantic vocabulary:
* `press()` — soft tap on primary CTAs.
* `segmentedChange()` — subtle tick on toggles / segmented pills.
* `success()` — `HapticFeedbackConstants.CONFIRM` (API 30+).
* `error()` — `HapticFeedbackConstants.REJECT` (API 30+).
* `longPress()` — long-press confirmation.

### Icon tokens

`IconTokens` re-exports `androidx.compose.material.icons` vectors under
semantic names (`IconTokens.Send`, `IconTokens.Shield`, etc.). Screens
reference tokens, not raw Material icons.

### Typography

`AethelredTypography.Material` defines the Material 3 scale plus two
extras:
* `Address` — monospace, 14 sp, tight tracking.
* `HeroAmount` — 44 sp semibold, -0.5 sp tracking — used for the
  portfolio hero and send review totals.

## Component catalogue

| Component           | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `CurrencyText`      | Split-symbol currency hero.                        |
| `GlassCard`         | Soft card background with gradient border.         |
| `TokenRow`          | Logo + symbol + name + price + change row.         |
| `SparklineChart`    | Canvas-based price sparkline.                      |
| `AllocationRing`    | Donut chart for portfolio allocation.              |
| `SegmentedPillBar`  | Animated segmented control.                        |
| `StatusBadge`       | Verified / pending / expired / revoked pill.       |
| `RiskIndicator`     | Traffic-light risk dot + long-form label.          |
| `BottomSheet`       | Brand-styled wrapper over Material3.               |
| `AddressField`      | ENS + address input with paste affordance.         |
| `AmountInput`       | Amount + MAX + USD toggle.                         |
| `Skeleton`          | Shimmer-loading placeholder.                       |
| `EmptyState`        | Icon + title + description + optional CTA.         |
| `InlineAlert`       | Info / success / warning / danger banner.          |
| `ActionTile`        | Gradient-icon action tile.                         |
| `TransactionRow`    | Direction-tinted tx row.                           |
| `HapticPressButton` | Button with scale + haptic press.                  |
| `AnimatedCounter`   | Count-up value.                                    |
| `BottomNavBar`      | 5-tab nav with active pill.                        |
| `AppTopBar`         | Reusable TopAppBar with back button.               |

## Accessibility

* Every interactive element carries a `Modifier.semantics` block with
  `contentDescription` / `role` / `selected`.
* Text styles inherit `LocalDensity` so font scaling respects user
  settings automatically.
* Contrast: ink on background achieves ≥ 7:1 in both light and dark.
* Reduced-animations: motion tokens are overridable per-CompositionLocal
  so a future "reduced motion" toggle can swap them out.
