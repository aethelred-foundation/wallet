import CommonCrypto
import CryptoKit
import Foundation

/// Keccak-256 hasher for EVM transaction signing.
///
/// ### Why the split implementation
///
/// The EVM requires **Keccak-256**, which is *not* the same as the
/// NIST-finalized SHA3-256. CommonCrypto ships SHA3-256 on iOS 13+
/// (`CC_SHA3_256_DIGEST_LENGTH`) but exposes no Keccak variant. CryptoKit
/// only exposes SHA-2 / SHA-3 finalists as well.
///
/// For phase-0 scaffolding we ship a pure-Swift Keccak-f[1600]
/// implementation below. It is adapted from the FIPS 202 draft /
/// Ethereum yellow paper specifications and verified against the known
/// test vectors `keccak256("") == c5d2460186f7233c927e7db2dcc703c0` (and
/// equivalents) in ``KeccakTests``.
///
/// The implementation is intentionally compact and readable — we prefer
/// auditability over throughput for a wallet. An optimized accelerated
/// path through swift-crypto or a wrapped-C implementation is a clear
/// production follow-up but is NOT required for correctness. See the
/// README "production follow-ups" list.
public enum Keccak256 {

    /// Return `keccak256(bytes)` as a 32-byte buffer.
    public static func hash(_ bytes: Data) -> Data {
        var state = KeccakState()
        state.absorb(bytes)
        return state.squeeze()
    }

    /// Variant convenience for arbitrary `Sequence<UInt8>` inputs —
    /// mostly useful for RLP encoders that build the digest buffer from
    /// small appends.
    public static func hash<S: Sequence>(_ seq: S) -> Data where S.Element == UInt8 {
        hash(Data(seq))
    }
}

// MARK: - Keccak-f[1600] core

/// Direct port of the Keccak-f[1600] permutation. 24 rounds, state is a
/// 5x5 matrix of 64-bit lanes. Kept file-private to ``Keccak256``.
private struct KeccakState {

    private static let roundConstants: [UInt64] = [
        0x0000000000000001, 0x0000000000008082, 0x800000000000808A,
        0x8000000080008000, 0x000000000000808B, 0x0000000080000001,
        0x8000000080008081, 0x8000000000008009, 0x000000000000008A,
        0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
        0x000000008000808B, 0x800000000000008B, 0x8000000000008089,
        0x8000000000008003, 0x8000000000008002, 0x8000000000000080,
        0x000000000000800A, 0x800000008000000A, 0x8000000080008081,
        0x8000000000008080, 0x0000000080000001, 0x8000000080008008
    ]

    private static let rotationOffsets: [Int] = [
        0,  1, 62, 28, 27,
        36, 44,  6, 55, 20,
        3, 10, 43, 25, 39,
        41, 45, 15, 21,  8,
        18,  2, 61, 56, 14
    ]

    /// 25 lanes of 64-bit state.
    private var lanes: [UInt64] = Array(repeating: 0, count: 25)

    private let rate: Int = 136 // (1600 - 512) / 8 bytes, for Keccak-256
    private let outputLength: Int = 32

    mutating func absorb(_ input: Data) {
        var padded = Data(input)
        // Keccak (not SHA3) pad: append 0x01 then zero-fill to rate, set
        // high bit of final byte.
        padded.append(0x01)
        while padded.count % rate != 0 {
            padded.append(0x00)
        }
        padded[padded.count - 1] |= 0x80

        var offset = 0
        while offset < padded.count {
            for laneIndex in 0..<(rate / 8) {
                let laneStart = offset + laneIndex * 8
                var word: UInt64 = 0
                for byteIdx in 0..<8 {
                    word |= UInt64(padded[laneStart + byteIdx]) << (8 * byteIdx)
                }
                lanes[laneIndex] ^= word
            }
            offset += rate
            permute()
        }
    }

    mutating func squeeze() -> Data {
        var output = Data()
        while output.count < outputLength {
            for laneIndex in 0..<(rate / 8) where output.count < outputLength {
                let word = lanes[laneIndex]
                for byteIdx in 0..<8 where output.count < outputLength {
                    output.append(UInt8((word >> (8 * byteIdx)) & 0xFF))
                }
            }
            if output.count < outputLength {
                permute()
            }
        }
        return output
    }

    private mutating func permute() {
        for round in 0..<24 {
            theta()
            rhoPi()
            chi()
            // Iota step
            lanes[0] ^= Self.roundConstants[round]
        }
    }

    private mutating func theta() {
        var columnParity = [UInt64](repeating: 0, count: 5)
        for x in 0..<5 {
            columnParity[x] =
                lanes[x] ^ lanes[x + 5] ^ lanes[x + 10] ^ lanes[x + 15] ^ lanes[x + 20]
        }
        for x in 0..<5 {
            let d = columnParity[(x + 4) % 5] ^ Self.rotl(columnParity[(x + 1) % 5], 1)
            for y in 0..<5 {
                lanes[x + 5 * y] ^= d
            }
        }
    }

    private mutating func rhoPi() {
        var rotated = [UInt64](repeating: 0, count: 25)
        for x in 0..<5 {
            for y in 0..<5 {
                let index = x + 5 * y
                let newIndex = y + 5 * ((2 * x + 3 * y) % 5)
                rotated[newIndex] = Self.rotl(lanes[index], Self.rotationOffsets[index])
            }
        }
        lanes = rotated
    }

    private mutating func chi() {
        for y in 0..<5 {
            var row = [UInt64](repeating: 0, count: 5)
            for x in 0..<5 {
                row[x] = lanes[x + 5 * y]
            }
            for x in 0..<5 {
                lanes[x + 5 * y] = row[x] ^ (~row[(x + 1) % 5] & row[(x + 2) % 5])
            }
        }
    }

    private static func rotl(_ value: UInt64, _ by: Int) -> UInt64 {
        let shift = by % 64
        if shift == 0 { return value }
        return (value &<< shift) | (value &>> (64 - shift))
    }
}
