package xyz.aethelred.wallet.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import xyz.aethelred.wallet.core.crypto.KeyStoreSecp256k1Signer
import xyz.aethelred.wallet.core.crypto.Secp256k1Signer
import javax.inject.Singleton

/**
 * Binds the production [Secp256k1Signer] to the keystore-backed impl.
 *
 * Swap the binding in a test module if you need a deterministic signer
 * (Hilt `@TestInstallIn` is the canonical approach).
 */
@Module
@InstallIn(SingletonComponent::class)
public abstract class CryptoModule {

    @Binds
    @Singleton
    public abstract fun bindSigner(impl: KeyStoreSecp256k1Signer): Secp256k1Signer
}
