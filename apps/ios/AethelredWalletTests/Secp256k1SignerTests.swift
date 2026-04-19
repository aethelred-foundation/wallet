import LocalAuthentication
import XCTest
@testable import AethelredWallet

/// Tests for the signer surface.
///
/// We can't exercise the actual Secure Enclave from a unit-test bundle
/// (it requires hardware) so the production signer is covered by the
/// app target's integration tests on-device. Here we verify:
///  1. The DER → raw (r||s) conversion produces 64-byte output and
///     strips DER leading zeros correctly against a known vector.
///  2. The deterministic stub produces the fixed signature and accepts
///     the digest length contract.
final class Secp256k1SignerTests: XCTestCase {

    func testDerConversionHandlesMinLengthIntegers() throws {
        // Synthetic DER: SEQUENCE(INT(0x01), INT(0x02)) — r and s are
        // single bytes. After normalization each should left-pad to 32
        // zeros followed by the single byte.
        let der = Data([
            0x30, 0x06,
            0x02, 0x01, 0x01,
            0x02, 0x01, 0x02
        ])
        let raw = try SecureEnclaveSignerP256.convertDerSignatureToRawRS(der)
        XCTAssertEqual(raw.count, 64)
        XCTAssertEqual(raw[0..<32], Data([UInt8](repeating: 0, count: 31) + [0x01]))
        XCTAssertEqual(raw[32..<64], Data([UInt8](repeating: 0, count: 31) + [0x02]))
    }

    func testDerConversionStripsLeadingZeros() throws {
        // 33-byte r/s with a leading zero (a common DER quirk when the
        // high bit of the actual value is set). Normalization should
        // drop the 0x00 and return 32 + 32 raw bytes.
        let rBody = [UInt8](repeating: 0xAA, count: 32)
        let sBody = [UInt8](repeating: 0xBB, count: 32)
        let der = Data([0x30, 0x46, 0x02, 0x21, 0x00] + rBody + [0x02, 0x21, 0x00] + sBody)
        let raw = try SecureEnclaveSignerP256.convertDerSignatureToRawRS(der)
        XCTAssertEqual(raw.count, 64)
        XCTAssertEqual(Array(raw[0..<32]), rBody)
        XCTAssertEqual(Array(raw[32..<64]), sBody)
    }

    func testDeterministicStubReturnsFixedSignature() async throws {
        let signer = DeterministicStubSigner(fixedSignature: Data(repeating: 0x12, count: 64))
        let account = WalletAccount.make(
            label: "test",
            publicKey: Data([UInt8](repeating: 0x01, count: 33)),
            devicePolicy: .softwareOnly,
            gate: .everySignature
        )
        let result = try await signer.sign(
            digest: Data(repeating: 0x7E, count: 32),
            with: account,
            authentication: LAContext()
        )
        XCTAssertEqual(result.count, 64)
        XCTAssertEqual(result, Data(repeating: 0x12, count: 64))
    }

    func testEvmAddressDerivationMatchesFormat() {
        // Address derivation uses keccak256, not SHA-256 — guard the
        // construction by asserting the output shape (hex, 42 chars,
        // "0x" prefix) against arbitrary input.
        let pubkey = Data([UInt8](repeating: 0x04, count: 65))
        let address = WalletAccount.deriveEvmAddress(from: pubkey)
        XCTAssertTrue(address.hasPrefix("0x"))
        XCTAssertEqual(address.count, 42)
    }
}
