import SwiftUI

/// Small pill that conveys one of a fixed set of status states.
///
/// Example:
/// ```swift
/// StatusBadge(state: .verified)
/// ```
public struct StatusBadge: View {

    public enum State: Sendable, Equatable {
        case verified
        case pending
        case expired
        case revoked
        case success
        case failed
        case draft
        case custom(label: String, tint: Color)
    }

    @Environment(\.themePalette) private var palette
    private let state: State

    public init(state: State) { self.state = state }

    public var body: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .bold))
            Text(label)
                .font(.system(size: 10, weight: .semibold))
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(background, in: Capsule(style: .continuous))
    }

    private var label: String {
        switch state {
        case .verified: return "Verified"
        case .pending: return "Pending"
        case .expired: return "Expired"
        case .revoked: return "Revoked"
        case .success: return "Completed"
        case .failed: return "Failed"
        case .draft: return "Draft"
        case .custom(let label, _): return label
        }
    }

    private var symbol: String {
        switch state {
        case .verified: return Icons.verified
        case .pending: return Icons.pending
        case .expired: return Icons.warning
        case .revoked: return Icons.revoked
        case .success: return Icons.success
        case .failed: return Icons.failed
        case .draft: return Icons.text
        case .custom: return Icons.info
        }
    }

    private var foreground: Color {
        switch state {
        case .verified, .success: return palette.success
        case .pending, .draft: return palette.info
        case .expired: return palette.warning
        case .revoked, .failed: return palette.danger
        case .custom(_, let tint): return tint
        }
    }

    private var background: Color {
        switch state {
        case .verified, .success: return palette.successSoft
        case .pending, .draft: return palette.infoSoft
        case .expired: return palette.warningSoft
        case .revoked, .failed: return palette.dangerSoft
        case .custom(_, let tint): return tint.opacity(0.14)
        }
    }
}
