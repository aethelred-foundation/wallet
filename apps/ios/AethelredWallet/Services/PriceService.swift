import Foundation

/// Price snapshot for a single asset.
public struct PriceSnapshot: Sendable, Equatable, Codable {
    public let symbol: String
    public let usdPrice: Double
    public let change24h: Double
    public let fetchedAt: Date

    public init(symbol: String, usdPrice: Double, change24h: Double, fetchedAt: Date) {
        self.symbol = symbol
        self.usdPrice = usdPrice
        self.change24h = change24h
        self.fetchedAt = fetchedAt
    }
}

/// Abstract price service.
public protocol PriceServing: Sendable {
    func prices(for symbols: [String]) async throws -> [PriceSnapshot]
    func spot(_ symbol: String) async throws -> PriceSnapshot
}

/// HTTP-backed implementation. Calls CoinGecko's simple price endpoint.
/// Not wired to a real API key — hit `api.coingecko.com` for dev.
///
/// Symbol → CoinGecko ID mapping is handled through a static table so
/// the caller can pass through our internal symbols.
public actor PriceService: PriceServing {

    private struct CacheEntry {
        let snapshot: PriceSnapshot
        let fetchedAt: Date
    }

    private var cache: [String: CacheEntry] = [:]
    private let ttl: TimeInterval
    private let transport: HTTPTransport
    private let endpoint: URL
    private let now: @Sendable () -> Date

    public init(
        transport: HTTPTransport = URLSession.shared,
        ttl: TimeInterval = 60,
        endpoint: URL = URL(string: "https://api.coingecko.com/api/v3/simple/price")!,  // swiftlint:disable:this force_unwrapping
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.transport = transport
        self.ttl = ttl
        self.endpoint = endpoint
        self.now = now
    }

    public func spot(_ symbol: String) async throws -> PriceSnapshot {
        let snapshots = try await prices(for: [symbol])
        guard let first = snapshots.first else {
            throw PriceServiceError.symbolNotFound(symbol)
        }
        return first
    }

    public func prices(for symbols: [String]) async throws -> [PriceSnapshot] {
        var unresolved: [String] = []
        var resolved: [PriceSnapshot] = []
        for symbol in symbols {
            if let cached = cache[symbol.uppercased()], now().timeIntervalSince(cached.fetchedAt) < ttl {
                resolved.append(cached.snapshot)
            } else {
                unresolved.append(symbol)
            }
        }
        guard !unresolved.isEmpty else { return resolved }

        let ids = unresolved.compactMap { symbol in Self.coinGeckoId[symbol.uppercased()] }
        guard !ids.isEmpty else {
            throw PriceServiceError.noKnownSymbols(unresolved)
        }

        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "ids", value: ids.joined(separator: ",")),
            URLQueryItem(name: "vs_currencies", value: "usd"),
            URLQueryItem(name: "include_24hr_change", value: "true")
        ]
        guard let url = components?.url else {
            throw PriceServiceError.invalidEndpoint
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await transport.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw PriceServiceError.transport((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        let payload = try JSONDecoder().decode([String: SimplePrice].self, from: data)
        for symbol in unresolved {
            let upper = symbol.uppercased()
            guard let id = Self.coinGeckoId[upper], let price = payload[id] else { continue }
            let snapshot = PriceSnapshot(
                symbol: upper,
                usdPrice: price.usd,
                change24h: (price.usd_24h_change ?? 0) / 100,
                fetchedAt: now()
            )
            cache[upper] = CacheEntry(snapshot: snapshot, fetchedAt: now())
            resolved.append(snapshot)
        }
        return resolved
    }

    /// Tiny static map of the symbols we care about.
    internal static let coinGeckoId: [String: String] = [
        "ETH": "ethereum",
        "USDC": "usd-coin",
        "USDT": "tether",
        "DAI": "dai",
        "BTC": "bitcoin",
        "WBTC": "wrapped-bitcoin",
        "MATIC": "matic-network",
        "SOL": "solana",
        "AVAX": "avalanche-2",
        "BNB": "binancecoin",
        "ARB": "arbitrum",
        "OP": "optimism",
        "LINK": "chainlink",
        "UNI": "uniswap",
        "AAVE": "aave"
    ]

    private struct SimplePrice: Codable {
        let usd: Double
        let usd_24h_change: Double?
    }
}

/// Errors emitted by ``PriceService``.
public enum PriceServiceError: LocalizedError, Sendable {
    case symbolNotFound(String)
    case noKnownSymbols([String])
    case invalidEndpoint
    case transport(Int)

    public var errorDescription: String? {
        switch self {
        case .symbolNotFound(let symbol):
            return "No price data available for \(symbol)."
        case .noKnownSymbols(let symbols):
            return "Unknown symbols: \(symbols.joined(separator: ", "))."
        case .invalidEndpoint:
            return "Invalid price-service endpoint."
        case .transport(let code):
            return "Price fetch failed with HTTP \(code)."
        }
    }
}

/// Deterministic test double.
public actor StubPriceService: PriceServing {
    private let fixture: [String: PriceSnapshot]

    public init(fixture: [String: PriceSnapshot] = [:]) {
        self.fixture = fixture
    }

    public func prices(for symbols: [String]) async throws -> [PriceSnapshot] {
        symbols.compactMap { fixture[$0.uppercased()] }
    }

    public func spot(_ symbol: String) async throws -> PriceSnapshot {
        guard let value = fixture[symbol.uppercased()] else {
            throw PriceServiceError.symbolNotFound(symbol)
        }
        return value
    }
}
