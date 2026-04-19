package xyz.aethelred.wallet.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Thin wrapper over [EncryptedSharedPreferences]. All values are AES-256
 * encrypted using a master key generated inside the AndroidKeyStore
 * (hardware-backed where possible — see [StrongBoxKeyStore]).
 *
 * Callers should treat `SecureStore` as write-through: every mutation
 * hits disk synchronously so a process kill right after a mutation
 * doesn't leave the on-device state inconsistent.
 */
@Singleton
public class SecureStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    private val prefs: SharedPreferences by lazy {
        val masterKey: MasterKey = MasterKey.Builder(context, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            PREFS_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /** Persist a string atomically. */
    public fun writeString(key: String, value: String) {
        prefs.edit().putString(key, value).commit()
    }

    /** Read a previously stored string. */
    public fun readString(key: String): String? = prefs.getString(key, null)

    /** Persist a boolean atomically. */
    public fun writeBoolean(key: String, value: Boolean) {
        prefs.edit().putBoolean(key, value).commit()
    }

    /** Read a boolean, defaulting to [default] when absent. */
    public fun readBoolean(key: String, default: Boolean = false): Boolean =
        prefs.getBoolean(key, default)

    /** Delete a key. No-op if the key does not exist. */
    public fun delete(key: String) {
        prefs.edit().remove(key).commit()
    }

    /** Drop every stored key. Used during a "forget this device" flow. */
    public fun clear() {
        prefs.edit().clear().commit()
    }

    private companion object {
        private const val PREFS_FILE = "aethelred_wallet_secure_prefs"
    }
}
