import XCTest
@testable import AethelredWallet

final class DeepLinkTests: XCTestCase {

    private let service = DeepLinkService()

    func testUniversalLinkWithHTTPS() {
        guard let url = URL(string: "https://aethelred.network/hub") else { return XCTFail("url") }
        if case .universal(let path) = service.parse(url) {
            XCTAssertEqual(path, "/hub")
        } else {
            XCTFail("expected universal")
        }
    }

    func testAethelredHubRoute() {
        guard let url = URL(string: "aethelred://hub") else { return XCTFail("url") }
        if case .openHub = service.parse(url) {
            // pass
        } else {
            XCTFail("expected openHub")
        }
    }

    func testAethelredReceiveRoute() {
        guard let url = URL(string: "aethelred://receive") else { return XCTFail("url") }
        if case .aethelredReceive = service.parse(url) {
            // pass
        } else {
            XCTFail("expected aethelredReceive")
        }
    }

    func testWalletConnectNestedParameter() {
        let wcUri = "wc:abc123%40bridge.example"
        let encoded = wcUri.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? wcUri
        guard let url = URL(string: "aethelred://wc?uri=\(encoded)") else { return XCTFail("url") }
        if case .walletConnect(let uri) = service.parse(url) {
            XCTAssertTrue(uri.hasPrefix("wc"))
        } else {
            XCTFail("expected walletConnect")
        }
    }

    func testApprovalExtractsId() {
        guard let url = URL(string: "aethelred://approval/abc-42") else { return XCTFail("url") }
        if case .aethelredApproval(let id) = service.parse(url) {
            XCTAssertEqual(id, "abc-42")
        } else {
            XCTFail("expected aethelredApproval")
        }
    }

    func testUnknownSchemeFallsBack() {
        guard let url = URL(string: "fake://something") else { return XCTFail("url") }
        if case .unrecognized(let raw) = service.parse(url) {
            XCTAssertEqual(raw, "fake://something")
        } else {
            XCTFail("expected unrecognized")
        }
    }
}
