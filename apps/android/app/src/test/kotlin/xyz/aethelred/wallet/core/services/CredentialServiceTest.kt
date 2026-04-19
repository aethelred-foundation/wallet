package xyz.aethelred.wallet.core.services

import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import xyz.aethelred.wallet.core.identity.Credential
import xyz.aethelred.wallet.core.identity.CredentialStore
import xyz.aethelred.wallet.core.identity.CredentialType

/** Tests for [CredentialService]. */
public class CredentialServiceTest {

    @Test
    public fun presentationEnvelopeContainsMatchingCredentials() {
        val store = mockk<CredentialStore>()
        val sample = Credential(
            id = "cred-1",
            subjectId = "sub-1",
            type = CredentialType.VERIFIABLE,
            label = "KYC",
            issuedAt = 0,
        )
        every { store.list() } returns listOf(sample)

        val service = CredentialService(store)
        val request = PresentationRequest(
            id = "pres-1",
            audience = "exchange.example",
            reason = "regulatory",
            requestedTypes = listOf(CredentialType.VERIFIABLE),
            expiresAt = System.currentTimeMillis() + 60_000,
        )

        val result = service.buildPresentation(request)
        assertEquals(listOf("cred-1"), result.credentialsSubmitted)
        assertTrue(result.envelopeJson.contains("cred-1"))
    }

    @Test
    public fun nonMatchingTypesAreExcluded() {
        val store = mockk<CredentialStore>()
        val sample = Credential(
            id = "cred-passkey",
            subjectId = "sub-1",
            type = CredentialType.PASSKEY,
            label = "Passkey",
            issuedAt = 0,
        )
        every { store.list() } returns listOf(sample)

        val service = CredentialService(store)
        val request = PresentationRequest(
            id = "pres-2",
            audience = "exchange",
            reason = "kyc",
            requestedTypes = listOf(CredentialType.VERIFIABLE),
            expiresAt = System.currentTimeMillis() + 60_000,
        )

        val result = service.buildPresentation(request)
        assertTrue(result.credentialsSubmitted.isEmpty())
    }
}
