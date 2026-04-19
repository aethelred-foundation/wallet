package xyz.aethelred.wallet

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.fragment.app.FragmentActivity
import dagger.hilt.android.AndroidEntryPoint
import xyz.aethelred.wallet.ui.AethelredWalletApp

/**
 * Single-activity host for the Aethelred Wallet UI.
 *
 * The app follows the one-activity Compose pattern. All navigation is
 * driven by [AethelredWalletApp] through Jetpack Navigation's Compose
 * integration. This class stays deliberately tiny — it is little more than
 * an enable-edge-to-edge shim and a [setContent] invocation.
 *
 * Extends [FragmentActivity] (not plain `ComponentActivity`) because
 * `androidx.biometric.BiometricPrompt` requires a FragmentActivity host
 * so it can pop its internal DialogFragment.
 *
 * Process-lifecycle wiring (app-lock on background, passkey re-auth on
 * foreground) lives in [AethelredWalletApplication] so it stays intact
 * across configuration changes that recreate the activity.
 */
@AndroidEntryPoint
public class MainActivity : FragmentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Draw behind the system bars — the Compose theme handles inset
        // padding everywhere visible content lives.
        enableEdgeToEdge()

        setContent {
            AethelredWalletApp()
        }
    }
}
