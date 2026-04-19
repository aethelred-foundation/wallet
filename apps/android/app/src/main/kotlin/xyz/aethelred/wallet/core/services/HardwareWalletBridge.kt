package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Identifier for a discovered hardware wallet device.
 *
 * @property id Opaque per-device identifier (USB vendor/product + serial
 *              for USB, BLE MAC address for Bluetooth).
 * @property displayName Vendor + model ("Ledger Nano S Plus").
 * @property transport Physical transport carrying the device.
 * @property firmwareVersion Firmware string (best-effort — may be null
 *                           until a session opens).
 */
public data class HardwareWalletDevice(
    public val id: String,
    public val displayName: String,
    public val transport: Transport,
    public val firmwareVersion: String? = null,
) {
    /** Physical transport connecting the phone to the device. */
    public enum class Transport { Usb, BluetoothLe }
}

/** Open session with a hardware wallet. */
public data class HardwareWalletSession(
    public val deviceId: String,
    public val app: String,
    public val openedAt: Long,
)

/**
 * Abstraction over Ledger USB + BLE stacks.
 *
 * FOLLOW-UP(android-team): wire Ledger's official SDK
 * (`com.ledger.live.android.sdk`) for framing / APDU over the actual
 * transport. Until then this class surfaces the interface wallet screens
 * integrate against.
 *
 * Concretely, the production implementation will:
 *  1. Enumerate USB devices via `android.hardware.usb.UsbManager`.
 *  2. Request permission via `PendingIntent` + intent filter.
 *  3. For BLE: scan via `BluetoothLeScanner`, pair on tap, open GATT.
 *  4. Wrap the transport in Ledger's HW transport API for APDU framing.
 *  5. Expose `getAddress()` and `signTransaction()` over `HardwareWalletSession`.
 */
@Singleton
public class HardwareWalletBridge @Inject constructor() {

    private val _discovered = MutableStateFlow<List<HardwareWalletDevice>>(emptyList())
    private val _session = MutableStateFlow<HardwareWalletSession?>(null)

    /** Live list of devices returned from the last scan. */
    public val discovered: StateFlow<List<HardwareWalletDevice>> = _discovered.asStateFlow()

    /** Active hardware session, null when no device is connected. */
    public val session: StateFlow<HardwareWalletSession?> = _session.asStateFlow()

    /**
     * Kick off a scan. The SDK wiring subscribes to USB + BLE events and
     * emits discovered devices. For now this stubs an empty list to keep
     * screens rendering without hardware.
     */
    public fun beginScan() {
        _discovered.value = emptyList()
    }

    /** Stop an in-flight scan. */
    public fun endScan() {
        // No-op in the stub.
    }

    /**
     * Open a session against [device] and select the Ethereum app on the
     * device. Throws [HardwareWalletError] when the device refuses.
     */
    public suspend fun openSession(device: HardwareWalletDevice): HardwareWalletSession {
        val session = HardwareWalletSession(
            deviceId = device.id,
            app = "Ethereum",
            openedAt = System.currentTimeMillis(),
        )
        _session.value = session
        return session
    }

    /** Derive the EVM address for [bip32Path] on the currently-open session. */
    public suspend fun address(bip32Path: String): String {
        @Suppress("UNUSED_PARAMETER") val path = bip32Path
        // FOLLOW-UP(android-team): implement once Ledger SDK is wired.
        throw HardwareWalletError.NotImplemented("address derivation requires Ledger SDK.")
    }

    /**
     * Sign an EIP-1559 transaction using the open session.
     *
     * @param bip32Path Derivation path on the device.
     * @param rlpEncoded RLP of the unsigned transaction.
     * @return `r || s || v` hex.
     */
    public suspend fun signTransaction(bip32Path: String, rlpEncoded: ByteArray): String {
        @Suppress("UNUSED_PARAMETER") val path = bip32Path
        @Suppress("UNUSED_PARAMETER") val rlp = rlpEncoded
        throw HardwareWalletError.NotImplemented("tx signing requires Ledger SDK.")
    }

    /** Close the session and release the transport. */
    public fun closeSession() {
        _session.value = null
    }
}

/** Closed hierarchy of hardware-wallet errors. */
public sealed class HardwareWalletError(message: String) : RuntimeException(message) {
    /** User rejected the operation on the device. */
    public class UserRejected : HardwareWalletError("User rejected on device.")

    /** Device returned an APDU error. */
    public class DeviceError(public val statusWord: Int) :
        HardwareWalletError("Device error 0x${Integer.toHexString(statusWord)}.")

    /** Transport (USB/BLE) dropped mid-APDU. */
    public class TransportFailure(cause: String) : HardwareWalletError("Transport failure: $cause")

    /** Feature not yet wired — call-site should surface a friendly message. */
    public class NotImplemented(detail: String) : HardwareWalletError(detail)
}
