import XCTest
@testable import AethelredWallet

/// RLP golden vectors from the Ethereum Yellow Paper / EIP-2718 test
/// suite. Failures here indicate an incompatible encoding that would
/// produce malformed transactions.
final class RLPTests: XCTestCase {

    func testSingleByteBelow128() {
        XCTAssertEqual(
            RLP.encode(bytes: Data([0x7F])),
            Data([0x7F])
        )
    }

    func testEmptyString() {
        XCTAssertEqual(
            RLP.encode(bytes: Data()),
            Data([0x80])
        )
    }

    func testShortString() {
        let input = Data("dog".utf8)
        let expected = Data([0x83]) + input
        XCTAssertEqual(RLP.encode(bytes: input), expected)
    }

    func testCanonicalIntegerStripsLeadingZeros() {
        XCTAssertEqual(RLP.canonicalBytes(from: 0), Data())
        XCTAssertEqual(RLP.canonicalBytes(from: 0x80), Data([0x80]))
        XCTAssertEqual(
            RLP.canonicalBytes(from: 0x0102030405),
            Data([0x01, 0x02, 0x03, 0x04, 0x05])
        )
    }

    func testListOfStrings() {
        let cat = RLP.encode(bytes: Data("cat".utf8))
        let dog = RLP.encode(bytes: Data("dog".utf8))
        let encoded = RLP.encode(list: [cat, dog])
        // 0xC8 == 0xC0 + 0x08 (list length); each string encodes to 4 bytes.
        XCTAssertEqual(encoded.first, 0xC8)
        XCTAssertEqual(encoded.count, 9)
    }

    func testLongStringUsesLongForm() {
        // 56-byte payload crosses the 55-byte threshold.
        let input = Data([UInt8](repeating: 0xAA, count: 56))
        let encoded = RLP.encode(bytes: input)
        XCTAssertEqual(encoded[0], 0xB8) // 0xB7 + 1
        XCTAssertEqual(encoded[1], 56)
        XCTAssertEqual(encoded.count, 58)
    }

    func testBigIntHexEncoding() {
        // 0x1bc16d674ec80000 == 2 ether
        let encoded = RLPBigInt.encode(hexNumber: "0x1bc16d674ec80000")
        // 8 bytes of value → 0x88 prefix.
        XCTAssertEqual(encoded[0], 0x88)
        XCTAssertEqual(encoded.count, 9)
    }
}
