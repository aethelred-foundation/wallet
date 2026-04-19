package xyz.aethelred.wallet.core.services

import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * URI-parser tests for [DeepLinkService]. Uses Robolectric so `Uri.parse`
 * resolves against a real implementation instead of the JVM stub.
 */
@RunWith(RobolectricTestRunner::class)
public class DeepLinkTest {

    private val service = DeepLinkService()

    @Test
    public fun parsesWalletConnectPairing() {
        val uri = Uri.parse("wc:abc123@2?relay-protocol=irn&symKey=xyz")
        val target = service.parse(uri)
        assertTrue(target is DeepLinkTarget.WalletConnect)
    }

    @Test
    public fun parsesSendWithRecipientQuery() {
        val uri = Uri.parse("aethelred://wallet/send?recipient=0xdead&amount=1.5")
        val target = service.parse(uri)
        assertTrue(target is DeepLinkTarget.Send)
        val send = target as DeepLinkTarget.Send
        assertEquals("0xdead", send.recipient)
        assertEquals("1.5", send.amount)
    }

    @Test
    public fun parsesApprovalWithId() {
        val uri = Uri.parse("aethelred://wallet/approval/approval-123")
        val target = service.parse(uri)
        assertTrue(target is DeepLinkTarget.Approval)
        assertEquals("approval-123", (target as DeepLinkTarget.Approval).id)
    }

    @Test
    public fun parsesAccountDetail() {
        val uri = Uri.parse("aethelred://wallet/account/acct-1")
        val target = service.parse(uri)
        assertTrue(target is DeepLinkTarget.Account)
        assertEquals("acct-1", (target as DeepLinkTarget.Account).accountId)
    }

    @Test
    public fun unknownSchemeFallsBack() {
        val uri = Uri.parse("https://example.com")
        val target = service.parse(uri)
        assertTrue(target is DeepLinkTarget.Unknown)
    }

    @Test
    public fun nullUriFallsBack() {
        val target = service.parse(uri = null)
        assertTrue(target is DeepLinkTarget.Unknown)
    }

    @Test
    public fun aethelredWcHostDecodesUri() {
        val uri = Uri.parse("aethelred://wc?uri=wc:abc@2")
        val target = service.parse(uri)
        assertTrue(target is DeepLinkTarget.WalletConnect)
        assertEquals("wc:abc@2", (target as DeepLinkTarget.WalletConnect).uri)
    }
}
