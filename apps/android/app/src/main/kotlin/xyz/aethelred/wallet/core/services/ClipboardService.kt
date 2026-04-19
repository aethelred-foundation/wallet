package xyz.aethelred.wallet.core.services

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Safer clipboard wrapper.
 *
 * Sensitive payloads (recovery phrases, private keys) shouldn't sit in
 * the system clipboard indefinitely. This service auto-clears after
 * [SENSITIVE_CLEAR_MS] so a dormant wallet doesn't leak the seed into
 * a screenshot share menu two hours later.
 *
 * On Android 13+ the `ClipData` is tagged sensitive so the system UI
 * obscures it in the clipboard preview.
 */
@Singleton
public class ClipboardService @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    /** Read the current clipboard contents as plain text. */
    public fun read(): String? {
        val manager = clipboardManager() ?: return null
        val item = manager.primaryClip?.getItemAt(0) ?: return null
        return item.text?.toString()
    }

    /** Write plain text to the clipboard without auto-clear. */
    public fun writePlain(label: String, text: String) {
        val manager = clipboardManager() ?: return
        manager.setPrimaryClip(ClipData.newPlainText(label, text))
    }

    /**
     * Write a sensitive payload. Tags the clip as sensitive on Android
     * 13+ so the system UI obscures it; schedules a clear after
     * [SENSITIVE_CLEAR_MS].
     */
    public fun writeSensitive(label: String, text: String) {
        val manager = clipboardManager() ?: return
        val clip = ClipData.newPlainText(label, text).apply {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                description.extras = PersistableBundle().apply {
                    putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
                }
            }
        }
        manager.setPrimaryClip(clip)
        scope.launch {
            delay(SENSITIVE_CLEAR_MS)
            // Best-effort clear — check what's on the clipboard; only
            // clear if our payload is still the primary clip.
            val current = manager.primaryClip
            val matches = current?.getItemAt(0)?.text?.toString() == text
            if (matches) manager.clearPrimaryClip()
        }
    }

    /** Clear the clipboard immediately. */
    public fun clear() {
        clipboardManager()?.clearPrimaryClip()
    }

    private fun clipboardManager(): ClipboardManager? =
        context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager

    internal companion object {
        internal const val SENSITIVE_CLEAR_MS: Long = 60_000L
    }
}
