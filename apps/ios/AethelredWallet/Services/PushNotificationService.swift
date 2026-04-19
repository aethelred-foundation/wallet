import Foundation
import UserNotifications
import UIKit

/// Typed payload we dispatch on remote notification delivery.
public enum PushPayload: Sendable, Equatable {
    case approvalRequest(id: String, dappName: String, chainId: Int)
    case txConfirmed(hash: String, chainId: Int)
    case securityAlert(severity: String, message: String)
    case unknown(raw: [String: String])
}

/// Service that registers the device with APNs and routes inbound
/// payloads into structured ``PushPayload`` values. The actual device
/// token is surfaced through an `AsyncStream` so the control plane can
/// be notified exactly once per rotation.
public final class PushNotificationService: NSObject, @unchecked Sendable {

    private let center: UNUserNotificationCenter
    private let tokensContinuation: AsyncStream<String>.Continuation
    public let tokens: AsyncStream<String>

    private let payloadsContinuation: AsyncStream<PushPayload>.Continuation
    public let payloads: AsyncStream<PushPayload>

    public init(center: UNUserNotificationCenter = .current()) {
        self.center = center
        let (tokensStream, tokensContinuation) = AsyncStream<String>.makeStream()
        self.tokens = tokensStream
        self.tokensContinuation = tokensContinuation

        let (payloadsStream, payloadsContinuation) = AsyncStream<PushPayload>.makeStream()
        self.payloads = payloadsStream
        self.payloadsContinuation = payloadsContinuation
        super.init()
        center.delegate = self
    }

    /// Request user permission + register with APNs. The caller must
    /// wire `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`
    /// back into ``registered(token:)``.
    @MainActor
    public func bootstrap() async throws {
        let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
        guard granted else {
            throw PushNotificationError.permissionDenied
        }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// Called by the app delegate with the APNs token.
    public func registered(token: Data) {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        tokensContinuation.yield(hex)
    }

    /// Called by the app delegate on delivery.
    public func received(userInfo: [AnyHashable: Any]) {
        let payload = Self.decode(userInfo: userInfo)
        payloadsContinuation.yield(payload)
    }

    /// Pure decoding so tests can exercise the routing without touching UNUserNotificationCenter.
    internal static func decode(userInfo: [AnyHashable: Any]) -> PushPayload {
        let string: (String) -> String? = { key in userInfo[key] as? String }
        let kind = string("kind") ?? ""
        switch kind {
        case "approval-request":
            return .approvalRequest(
                id: string("id") ?? "",
                dappName: string("dappName") ?? "",
                chainId: Int(string("chainId") ?? "") ?? 0
            )
        case "tx-confirmed":
            return .txConfirmed(
                hash: string("hash") ?? "",
                chainId: Int(string("chainId") ?? "") ?? 0
            )
        case "security-alert":
            return .securityAlert(
                severity: string("severity") ?? "info",
                message: string("message") ?? ""
            )
        default:
            var raw: [String: String] = [:]
            for (key, value) in userInfo {
                if let key = key as? String, let value = value as? String {
                    raw[key] = value
                }
            }
            return .unknown(raw: raw)
        }
    }
}

/// Errors surfaced during bootstrap.
public enum PushNotificationError: LocalizedError, Sendable {
    case permissionDenied

    public var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "Notifications are required to receive approval alerts."
        }
    }
}

extension PushNotificationService: UNUserNotificationCenterDelegate {
    public nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        received(userInfo: userInfo)
        completionHandler()
    }

    public nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }
}
