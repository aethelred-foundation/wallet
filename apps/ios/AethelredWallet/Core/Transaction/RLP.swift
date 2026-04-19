import Foundation

/// Recursive Length Prefix encoder used for EVM transaction hashing and
/// broadcasting.
///
/// The RLP grammar is defined in the Ethereum Yellow Paper, Appendix B.
/// This implementation handles the three leaf types we actually need:
/// byte strings, integers (encoded as their canonical big-endian byte
/// representation), and lists of previously encoded items.
///
/// Integers are serialized canonically — leading zero bytes are stripped
/// and the value `0` encodes as the empty byte string, matching the
/// Ethereum specification.
public enum RLP {

    // MARK: Public API

    /// Encode a single byte string.
    public static func encode(bytes: Data) -> Data {
        if bytes.count == 1 && bytes[0] < 0x80 {
            return bytes
        }
        return lengthPrefix(0x80, 0xB7, bytes.count) + bytes
    }

    /// Encode an unsigned integer using the canonical (stripped) form.
    public static func encode(integer value: UInt64) -> Data {
        encode(bytes: Self.canonicalBytes(from: value))
    }

    /// Encode a Swift string — bytes are the UTF-8 representation.
    public static func encode(string: String) -> Data {
        encode(bytes: Data(string.utf8))
    }

    /// Encode an already-encoded list of RLP items.
    public static func encode(list items: [Data]) -> Data {
        let joined = items.reduce(Data(), +)
        return lengthPrefix(0xC0, 0xF7, joined.count) + joined
    }

    /// Encode a list of heterogeneous raw data components — convenience
    /// used by the EIP-1559 transaction encoder so callers don't have to
    /// call `encode(bytes:)` on each entry manually.
    public static func encode(bytesList bytesArray: [Data]) -> Data {
        encode(list: bytesArray.map(encode(bytes:)))
    }

    // MARK: Internals

    /// Return a length prefix per RLP rules. `short` is the short-form
    /// base (0x80 for strings, 0xC0 for lists). `longBase` is the
    /// long-form base (0xB7 for strings, 0xF7 for lists).
    private static func lengthPrefix(
        _ short: UInt8,
        _ longBase: UInt8,
        _ length: Int
    ) -> Data {
        if length <= 55 {
            return Data([short + UInt8(length)])
        }
        let lengthBytes = canonicalBytes(from: UInt64(length))
        return Data([longBase + UInt8(lengthBytes.count)]) + lengthBytes
    }

    /// Canonical big-endian representation of an unsigned integer with
    /// leading zeroes stripped.
    public static func canonicalBytes(from value: UInt64) -> Data {
        if value == 0 { return Data() }
        var bytes: [UInt8] = []
        var remaining = value
        while remaining > 0 {
            bytes.insert(UInt8(remaining & 0xFF), at: 0)
            remaining >>= 8
        }
        return Data(bytes)
    }
}

/// Helpers for encoding arbitrary-precision integers as RLP byte
/// strings. EIP-1559 fields like `maxFeePerGas` are `uint256`, which
/// exceeds `UInt64` — we accept their hex-string form (`"0x..."`) to
/// avoid pulling in a big-int dependency for a phase-0 scaffold.
public enum RLPBigInt {

    /// Decode a canonical hex-prefixed integer string (`"0x1234"` or
    /// `"0x"`) into its RLP byte-string representation.
    public static func bytes(fromHexNumber hex: String) -> Data {
        var trimmed = hex.hasPrefix("0x") ? String(hex.dropFirst(2)) : hex
        if trimmed.isEmpty { return Data() }
        // Ensure even length.
        if trimmed.count % 2 != 0 { trimmed = "0" + trimmed }
        var bytes = Data()
        bytes.reserveCapacity(trimmed.count / 2)
        var index = trimmed.startIndex
        while index < trimmed.endIndex {
            let next = trimmed.index(index, offsetBy: 2)
            let pair = String(trimmed[index..<next])
            guard let byte = UInt8(pair, radix: 16) else { return Data() }
            bytes.append(byte)
            index = next
        }
        // Strip leading zero bytes to match RLP canonicalization.
        while bytes.first == 0x00 { bytes.removeFirst() }
        return bytes
    }

    /// Encode a hex-number input as an RLP byte string.
    public static func encode(hexNumber hex: String) -> Data {
        RLP.encode(bytes: bytes(fromHexNumber: hex))
    }
}
