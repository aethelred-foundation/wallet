import XCTest
@testable import AethelredWallet

final class PushPayloadTests: XCTestCase {

    func testApprovalRequestPayload() {
        let payload = PushNotificationService.decode(userInfo: [
            "kind": "approval-request",
            "id": "wf-1",
            "dappName": "Uniswap",
            "chainId": "1"
        ])
        if case .approvalRequest(let id, let dapp, let chainId) = payload {
            XCTAssertEqual(id, "wf-1")
            XCTAssertEqual(dapp, "Uniswap")
            XCTAssertEqual(chainId, 1)
        } else {
            XCTFail("wrong payload")
        }
    }

    func testTxConfirmedPayload() {
        let payload = PushNotificationService.decode(userInfo: [
            "kind": "tx-confirmed",
            "hash": "0xabc",
            "chainId": "42"
        ])
        if case .txConfirmed(let hash, let chainId) = payload {
            XCTAssertEqual(hash, "0xabc")
            XCTAssertEqual(chainId, 42)
        } else {
            XCTFail("wrong payload")
        }
    }

    func testSecurityAlertPayload() {
        let payload = PushNotificationService.decode(userInfo: [
            "kind": "security-alert",
            "severity": "critical",
            "message": "Recent login from an unrecognized device."
        ])
        if case .securityAlert(let severity, let message) = payload {
            XCTAssertEqual(severity, "critical")
            XCTAssertEqual(message, "Recent login from an unrecognized device.")
        } else {
            XCTFail("wrong payload")
        }
    }

    func testUnknownPayloadKind() {
        let payload = PushNotificationService.decode(userInfo: [
            "foo": "bar"
        ])
        if case .unknown(let raw) = payload {
            XCTAssertEqual(raw["foo"], "bar")
        } else {
            XCTFail("wrong payload")
        }
    }
}
