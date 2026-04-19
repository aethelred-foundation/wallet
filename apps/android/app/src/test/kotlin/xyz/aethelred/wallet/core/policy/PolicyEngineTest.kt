package xyz.aethelred.wallet.core.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import xyz.aethelred.wallet.ui.components.RiskLevel

/**
 * Unit tests for [PolicyEngine]. Guards the rule semantics documented
 * in the engine's KDoc so the Android team doesn't accidentally regress
 * a policy decision during a refactor.
 */
class PolicyEngineTest {

    private val engine = PolicyEngine()

    @Test
    fun readOnlyMethod_isLowRiskAndAllowed() {
        val verdict = engine.evaluate(
            PolicyContext(
                originator = "app.example",
                intent = "eth_chainId",
                amountUsd = null,
                chainId = 1,
                timestampMs = 0,
            ),
        )
        assertTrue(verdict.allowed)
        assertEquals(RiskLevel.Low, verdict.riskLevel)
    }

    @Test
    fun rawSignMethod_isMediumRiskButAllowed() {
        val verdict = engine.evaluate("app.example", "personal_sign", amount = 0.0)
        assertTrue(verdict.allowed)
        assertEquals(RiskLevel.Medium, verdict.riskLevel)
    }

    @Test
    fun highValueTransfer_isDeniedAsHighRisk() {
        val verdict = engine.evaluate("app.example", "eth_sendTransaction", amount = 50_000.0)
        assertFalse(verdict.allowed)
        assertEquals(RiskLevel.High, verdict.riskLevel)
    }

    @Test
    fun smallTransfer_isAllowed() {
        val verdict = engine.evaluate("app.example", "eth_sendTransaction", amount = 100.0)
        assertTrue(verdict.allowed)
        assertEquals(RiskLevel.Low, verdict.riskLevel)
    }
}
