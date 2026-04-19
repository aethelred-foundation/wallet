package xyz.aethelred.wallet.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import xyz.aethelred.wallet.core.network.RpcClient
import javax.inject.Singleton

/**
 * Hilt module supplying the OkHttp client used by [RpcClient].
 *
 * Kept separate from other modules so a downstream test can swap the
 * client for a `MockWebServer` without touching unrelated bindings.
 */
@Module
@InstallIn(SingletonComponent::class)
public object NetworkModule {

    @Provides
    @Singleton
    public fun provideOkHttpClient(): OkHttpClient = RpcClient.defaultHttpClient()
}
