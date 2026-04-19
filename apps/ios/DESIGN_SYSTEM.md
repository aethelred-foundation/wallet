# Aethelred iOS Wallet — Design System

The design system lives in `AethelredWallet/DesignSystem/` and is
documented here so new screens stay consistent.

## Tokens

### Spacing (`Spacing.swift`)
| Token | Points | Use |
| --- | --- | --- |
| `xxs` | 4 | Stacked icon + label pairs |
| `xs` | 8 | Baseline row gap |
| `sm` | 12 | Card internals |
| `md` | 16 | Default card padding |
| `mdLarge` | 20 | Loose row gap |
| `lg` | 24 | Section spacing |
| `xl` | 32 | Hero offsets |
| `xxl` | 40 | Top-of-screen |
| `xxxl` | 48 | Biggest heroes |
| `huge` | 64 | Lock screen |

### Radii (`Radii.swift`)
`sm 8 / md 12 / lg 16 / xl 20 / xxl 24 / hero 32 / pill 999`.

### Typography (`Typography.swift`)
Semantic roles — never pass a raw size. Includes SF Pro Display,
SF Pro Text, and SF Mono variants at 48 / 36 / 28 / 22 / 20 / 17 / 16 / 15 / 13 / 12 / 11 / 10 / 9 pt.

### Motion (`Motion.swift`)
Durations `75 / 150 / 250 / 400 ms`. Animations include `micro`,
`standard`, `pressed` (spring 0.25/0.85), `emphasized` (spring 0.4/0.8),
`bouncy`, `slow`.

### Haptics (`Haptics.swift`)
Semantic calls: `selection`, `success`, `warning`, `error`, `click`,
`heavy`, `soft`, `rigid`.

### Shadows (`Shadows.swift`)
Elevation levels 0-5 with dark/light presets. Apply via
`.elevation(.level2)`.

### Gradients (`GradientSet.swift`)
Named brand gradients: `hero`, `balance`, `accentSweep`, `muted`,
`success`, `warning`, `danger`, `lockBackdrop`, `heroGlow`.

### Icons (`Icons.swift`)
60+ SF Symbols mapped to semantic names — `Icons.send`, `Icons.passkey`,
etc.

### Palette (`ThemePalette.swift`)
Expanded token palette with 30+ named colors: backgrounds, text, status,
borders, chain pills, risk levels, skeleton states.

## Components

Located in `Views/Components/`:

- `GlassCard` — blurred surface with accent border.
- `TokenRow`, `TransactionRow`, `ActionTile`.
- `SparklineChart`, `AllocationRing`.
- `SegmentedPillBar`, `StatusBadge`, `RiskIndicator`.
- `BottomSheet`, `AddressField`, `AmountInput`.
- `Skeleton`, `EmptyState`, `InlineAlert`.
- `HapticPressButton` (ButtonStyle), `AnimatedNumber`.
- `TabBar`, `NavigationHeader`.
- `CurrencyText` (split-style + compact mode).

## Accessibility

- Every interactive element has an `.accessibilityLabel`.
- `@ScaledMetric` via `scaledFont(size:weight:design:)` so Dynamic
  Type works everywhere.
- `@Environment(\.accessibilityReduceMotion)` guards non-essential
  animations (Skeleton, AnimatedNumber).
- WCAG AA contrast holds in both dark and light palettes.

## Usage pattern

```swift
struct MyView: View {
    @Environment(\.themePalette) private var palette

    var body: some View {
        VStack(spacing: Spacing.md) {
            Text("Hello")
                .font(Typography.title3)
                .foregroundStyle(palette.textPrimary)
        }
        .padding(Spacing.md)
        .background(palette.surfaceBase, in: RoundedRectangle(cornerRadius: Radii.lg))
        .elevation(.level2)
    }
}
```

Wire the palette in at the root:

```swift
RootView().withDesignSystem()
```
