package xyz.aethelred.wallet.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Invariants on the design-system token catalogues.
 *
 * These aren't visual regressions — they guard the *shape* of the tokens
 * so a refactor can't accidentally drop a level from the ramp without the
 * build screaming.
 */
public class DesignSystemTests {

    @Test
    public fun spacingExposesMonotonicValues() {
        val scale = AethelredSpacing().values.map { it.value }
        for (i in 1 until scale.size) {
            assertTrue(
                "Spacing step must be strictly increasing ($i: ${scale[i - 1]} -> ${scale[i]})",
                scale[i] > scale[i - 1],
            )
        }
    }

    @Test
    public fun spacingGrid4IsOnFigmaGrid() {
        val scale = AethelredSpacing().values.map { it.value }
        scale.forEach { value ->
            assertTrue("Spacing must be multiple of 2: $value", value % 2f == 0f)
        }
    }

    @Test
    public fun radiiCatalogueHasEverySize() {
        val radii = AethelredRadii()
        assertNotNull(radii.xs)
        assertNotNull(radii.sm)
        assertNotNull(radii.md)
        assertNotNull(radii.lg)
        assertNotNull(radii.xl)
        assertNotNull(radii.xxl)
        assertNotNull(radii.pill)
    }

    @Test
    public fun motionDurationsAreOrdered() {
        val motion = AethelredMotion()
        assertTrue(motion.microDurationMs < motion.shortDurationMs)
        assertTrue(motion.shortDurationMs < motion.mediumDurationMs)
        assertTrue(motion.mediumDurationMs < motion.longDurationMs)
        assertTrue(motion.longDurationMs < motion.heroDurationMs)
    }

    @Test
    public fun elevationRampIsMonotonic() {
        val elevation = AethelredElevation()
        val levels = listOf(
            elevation.level0.value,
            elevation.level1.value,
            elevation.level2.value,
            elevation.level3.value,
            elevation.level4.value,
            elevation.level5.value,
        )
        for (i in 1 until levels.size) {
            assertTrue("Elevation must be non-decreasing", levels[i] >= levels[i - 1])
        }
    }

    @Test
    public fun hapticVocabularyCoversAllCallSites() {
        // NoopHaptics must implement every method — smoke check.
        val haptics = NoopHaptics
        haptics.press()
        haptics.segmentedChange()
        haptics.success()
        haptics.error()
        haptics.longPress()
    }

    @Test
    public fun spacingHasCanonicalSize() {
        assertEquals(11, AethelredSpacing().values.size)
    }
}
