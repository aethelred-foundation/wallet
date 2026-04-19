import XCTest
@testable import AethelredWallet

/// Numeric invariants on the design-system tokens. If these shift
/// unintentionally, every screen drifts with them — so fail loud.
final class DesignSystemTests: XCTestCase {

    func testSpacingTokensAreMonotonic() {
        let tokens: [CGFloat] = [
            Spacing.xxs, Spacing.xs, Spacing.sm, Spacing.md,
            Spacing.mdLarge, Spacing.lg, Spacing.xl, Spacing.xxl,
            Spacing.xxxl, Spacing.huge
        ]
        for index in 1..<tokens.count {
            XCTAssertGreaterThan(tokens[index], tokens[index - 1], "spacing[\(index)] must be > spacing[\(index - 1)]")
        }
    }

    func testRadiiTokensAreMonotonicThroughHero() {
        let tokens: [CGFloat] = [Radii.sm, Radii.md, Radii.lg, Radii.xl, Radii.xxl, Radii.hero]
        for index in 1..<tokens.count {
            XCTAssertGreaterThan(tokens[index], tokens[index - 1])
        }
    }

    func testPillRadiusIsEffectivelyInfinite() {
        XCTAssertGreaterThan(Radii.pill, 100, "pill radius is the catch-all for fully-rounded capsules")
    }

    func testElevationPresetsAreZeroAtLevelZero() {
        let preset = Elevation.level0.preset(for: .dark)
        XCTAssertEqual(preset.radius, 0)
        XCTAssertEqual(preset.x, 0)
        XCTAssertEqual(preset.y, 0)
    }

    func testElevationRadiusIsMonotonic() {
        let radii = Elevation.allCases.map { $0.preset(for: .light).radius }
        for index in 1..<radii.count {
            XCTAssertGreaterThanOrEqual(radii[index], radii[index - 1])
        }
    }

    func testSpacingNearestClampsToToken() {
        XCTAssertEqual(Spacing.nearest(to: 5), Spacing.xxs)
        XCTAssertEqual(Spacing.nearest(to: 15), Spacing.md)
        XCTAssertEqual(Spacing.nearest(to: 70), Spacing.huge)
    }

    func testTypographyPairsExist() {
        XCTAssertNotNil(Typography.hero)
        XCTAssertNotNil(Typography.display)
        XCTAssertNotNil(Typography.title)
        XCTAssertNotNil(Typography.body)
        XCTAssertNotNil(Typography.caption)
        XCTAssertNotNil(Typography.monoCompact)
    }
}
