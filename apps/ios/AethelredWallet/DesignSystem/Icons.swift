import SwiftUI

/// Semantic icon names backed by SF Symbols.
///
/// Screens reference `Icons.send` rather than raw strings so rebrands
/// only happen in one place. The full catalog here matches the
/// browser extension's icon registry used across the 34 popup views.
///
/// Example:
/// ```swift
/// Image(systemName: Icons.send).foregroundStyle(.primary)
/// ```
public enum Icons {

    // MARK: Core navigation
    public static let home = "house.fill"
    public static let portfolio = "chart.pie.fill"
    public static let markets = "chart.line.uptrend.xyaxis"
    public static let payments = "creditcard.fill"
    public static let hub = "square.grid.2x2.fill"
    public static let settings = "gearshape.fill"
    public static let activity = "clock.arrow.circlepath"

    // MARK: Primary actions
    public static let send = "paperplane.fill"
    public static let receive = "qrcode"
    public static let swap = "arrow.2.squarepath"
    public static let stake = "lock.fill"
    public static let settle = "checkmark.seal.fill"
    public static let scan = "camera.viewfinder"
    public static let copy = "doc.on.doc.fill"
    public static let share = "square.and.arrow.up"
    public static let refresh = "arrow.clockwise"
    public static let search = "magnifyingglass"
    public static let filter = "line.3.horizontal.decrease.circle"
    public static let sort = "arrow.up.arrow.down"

    // MARK: Security
    public static let shield = "shield.lefthalf.filled"
    public static let lock = "lock.fill"
    public static let unlock = "lock.open.fill"
    public static let passkey = "key.fill"
    public static let faceid = "faceid"
    public static let touchid = "touchid"
    public static let hardwareWallet = "memorychip.fill"
    public static let biometric = "faceid"
    public static let keystore = "cpu.fill"

    // MARK: Identity / compliance
    public static let credential = "person.badge.key.fill"
    public static let passport = "rectangle.and.text.magnifyingglass"
    public static let kyc = "person.text.rectangle.fill"
    public static let verified = "checkmark.seal.fill"
    public static let unverified = "questionmark.circle.fill"

    // MARK: Account
    public static let person = "person.crop.circle"
    public static let personAdd = "person.crop.circle.badge.plus"
    public static let personSwitch = "person.2.circle.fill"
    public static let wallet = "wallet.pass.fill"

    // MARK: Status
    public static let success = "checkmark.circle.fill"
    public static let warning = "exclamationmark.triangle.fill"
    public static let danger = "xmark.octagon.fill"
    public static let info = "info.circle.fill"
    public static let pending = "hourglass"
    public static let failed = "xmark.octagon.fill"
    public static let revoked = "nosign"

    // MARK: Network / chain
    public static let network = "network"
    public static let testnet = "ladybug.fill"
    public static let mainnet = "globe"
    public static let chainEvm = "cube.fill"
    public static let chainBitcoin = "bitcoinsign.circle.fill"
    public static let chainSolana = "circle.hexagongrid.fill"

    // MARK: Transaction detail
    public static let incoming = "arrow.down.left.circle.fill"
    public static let outgoing = "arrow.up.right.circle.fill"
    public static let contract = "doc.richtext"
    public static let approve = "checkmark.circle"
    public static let reject = "xmark.circle"
    public static let deny = "hand.raised.fill"
    public static let revoke = "nosign"
    public static let gas = "fuelpump.fill"
    public static let explorer = "safari.fill"

    // MARK: Connectivity
    public static let connected = "antenna.radiowaves.left.and.right"
    public static let disconnected = "antenna.radiowaves.left.and.right.slash"
    public static let walletconnect = "link.circle.fill"
    public static let dapp = "globe.americas.fill"

    // MARK: Developer / debug
    public static let debug = "ladybug"
    public static let flag = "flag.fill"
    public static let terminal = "terminal.fill"
    public static let network2 = "network.badge.shield.half.filled"

    // MARK: Miscellaneous
    public static let plus = "plus.circle.fill"
    public static let minus = "minus.circle.fill"
    public static let ellipsis = "ellipsis.circle.fill"
    public static let chevronRight = "chevron.right"
    public static let chevronDown = "chevron.down"
    public static let chevronUp = "chevron.up"
    public static let back = "chevron.left"
    public static let close = "xmark"
    public static let download = "arrow.down.circle.fill"
    public static let upload = "arrow.up.circle.fill"
    public static let notification = "bell.fill"
    public static let notificationOff = "bell.slash.fill"
    public static let star = "star.fill"
    public static let starOutline = "star"

    // MARK: Machine delegation / AI
    public static let delegation = "person.line.dotted.person.fill"
    public static let machine = "server.rack"
    public static let autonomous = "sparkles"

    // MARK: Content
    public static let nft = "photo.stack.fill"
    public static let image = "photo.fill"
    public static let text = "text.alignleft"
    public static let code = "chevron.left.forwardslash.chevron.right"
    public static let receipt = "doc.plaintext.fill"
    public static let clipboard = "list.clipboard.fill"

    // MARK: Layout
    public static let grid = "square.grid.2x2.fill"
    public static let list = "list.bullet"
    public static let map = "map.fill"
    public static let trash = "trash.fill"
    public static let pin = "pin.fill"
}
