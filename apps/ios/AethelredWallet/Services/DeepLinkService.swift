import Foundation

/// Typed routing destination produced from an inbound URL.
public enum DeepLinkRoute: Sendable, Equatable {
    case walletConnect(uri: String)
    case aethelredSend(address: String, amount: String?, chainId: Int?)
    case aethelredReceive
    case aethelredActivity
    case aethelredApproval(id: String)
    case openHub
    case universal(path: String)
    case unrecognized(raw: String)
}

/// Service that parses inbound URLs (wc://, aethelred://, universal
/// `https://aethelred.network/...`) into structured routes.
///
/// Stateless and trivially testable — unit tests can call ``parse``
/// directly with any URL string.
public struct DeepLinkService: Sendable {

    public init() {}

    /// Parse a URL into a ``DeepLinkRoute``. Unknown schemes fall back
    /// to `.unrecognized`.
    public func parse(_ url: URL) -> DeepLinkRoute {
        if url.scheme == "wc" {
            return .walletConnect(uri: url.absoluteString)
        }
        if url.scheme == "aethelred" {
            return parseAethelred(url)
        }
        if url.scheme == "https", url.host == "aethelred.network" {
            return .universal(path: url.path)
        }
        return .unrecognized(raw: url.absoluteString)
    }

    private func parseAethelred(_ url: URL) -> DeepLinkRoute {
        guard let host = url.host else {
            return .unrecognized(raw: url.absoluteString)
        }

        switch host {
        case "wc":
            guard let raw = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "uri" })?.value else {
                return .walletConnect(uri: url.absoluteString)
            }
            return .walletConnect(uri: raw)
        case "send":
            return parseSend(url)
        case "receive":
            return .aethelredReceive
        case "activity":
            return .aethelredActivity
        case "approval":
            if let id = url.pathComponents.dropFirst().first {
                return .aethelredApproval(id: id)
            }
            return .unrecognized(raw: url.absoluteString)
        case "hub":
            return .openHub
        default:
            return .unrecognized(raw: url.absoluteString)
        }
    }

    private func parseSend(_ url: URL) -> DeepLinkRoute {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let items = components?.queryItems ?? []
        let address = url.pathComponents.dropFirst().first ?? ""
        let amount = items.first(where: { $0.name == "amount" })?.value
        let chainIdString = items.first(where: { $0.name == "chainId" })?.value
        let chainId = chainIdString.flatMap(Int.init)
        return .aethelredSend(address: address, amount: amount, chainId: chainId)
    }
}
