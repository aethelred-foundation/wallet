import CoreBluetooth
import Foundation

/// Typed hardware wallet device entry surfaced to the UI.
public struct HardwareWalletDevice: Sendable, Equatable, Hashable, Identifiable {
    public enum Vendor: String, Sendable, CaseIterable, Codable {
        case ledger, trezor, other
    }

    public let id: UUID
    public let name: String
    public let vendor: Vendor
    public let isPaired: Bool

    public init(id: UUID, name: String, vendor: Vendor, isPaired: Bool) {
        self.id = id
        self.name = name
        self.vendor = vendor
        self.isPaired = isPaired
    }
}

/// Outcome of asking the device to sign a digest.
public struct HardwareSignatureResult: Sendable, Equatable {
    public let signatureRS: Data
    public let yParity: Int

    public init(signatureRS: Data, yParity: Int) {
        self.signatureRS = signatureRS
        self.yParity = yParity
    }
}

/// Bluetooth-bridge abstraction for hardware wallets.
///
/// PRODUCTION FOLLOW-UP: wiring up the real Ledger BLE protocol
/// requires the vendor SDK. This bridge publishes the discovery /
/// signing interface the app compiles against today and performs a
/// scan via ``CBCentralManager`` so the surface is real.
public final class HardwareWalletBridge: NSObject, @unchecked Sendable {

    public private(set) var discovered: [HardwareWalletDevice] = []
    private let centralManager: CBCentralManager
    private let discoveriesContinuation: AsyncStream<HardwareWalletDevice>.Continuation
    public let discoveries: AsyncStream<HardwareWalletDevice>

    public override init() {
        let (stream, continuation) = AsyncStream<HardwareWalletDevice>.makeStream()
        self.discoveries = stream
        self.discoveriesContinuation = continuation
        self.centralManager = CBCentralManager()
        super.init()
        centralManager.delegate = self
    }

    /// Begin a BLE scan for hardware wallets. Stops automatically
    /// after the given duration.
    public func startScan(timeout: TimeInterval = 15) {
        guard centralManager.state == .poweredOn else { return }
        centralManager.scanForPeripherals(withServices: nil)
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            self?.stopScan()
        }
    }

    public func stopScan() {
        centralManager.stopScan()
    }

    /// Request a signature on the given 32-byte digest from the paired
    /// device. The real implementation issues a GetAddress + Sign
    /// APDU pair; here we throw explicitly so the path exercises the
    /// error surface the UI uses.
    public func sign(
        device _: HardwareWalletDevice,
        derivationPath _: String,
        digest _: Data
    ) async throws -> HardwareSignatureResult {
        throw HardwareWalletError.notImplemented
    }
}

extension HardwareWalletBridge: CBCentralManagerDelegate {
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        // No-op — start-scan guards on state.
    }

    public func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        let name = (peripheral.name ?? "Unknown BLE device")
        let vendor = HardwareWalletDevice.Vendor.fromName(name)
        let device = HardwareWalletDevice(
            id: peripheral.identifier,
            name: name,
            vendor: vendor,
            isPaired: peripheral.state == .connected
        )
        if !discovered.contains(where: { $0.id == device.id }) {
            discovered.append(device)
            discoveriesContinuation.yield(device)
        }
    }
}

private extension HardwareWalletDevice.Vendor {
    static func fromName(_ name: String) -> HardwareWalletDevice.Vendor {
        let lower = name.lowercased()
        if lower.contains("ledger") { return .ledger }
        if lower.contains("trezor") { return .trezor }
        return .other
    }
}

/// Errors emitted by ``HardwareWalletBridge``.
public enum HardwareWalletError: LocalizedError, Sendable {
    case bluetoothUnavailable
    case deviceUnavailable
    case notImplemented

    public var errorDescription: String? {
        switch self {
        case .bluetoothUnavailable:
            return "Bluetooth is unavailable."
        case .deviceUnavailable:
            return "The paired hardware wallet could not be reached."
        case .notImplemented:
            return "Hardware wallet signing is not yet wired up. Install the Ledger SDK to enable."
        }
    }
}
