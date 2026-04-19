import Foundation
import SwiftData

/// Persisted counterpart of ``WalletAccount``.
///
/// SwiftData stores the hardware-policy + label + subject fields so the
/// wallet can present the account list before Keychain is unlocked
/// (with addresses masked, of course).
@Model
public final class StoredAccount {

    @Attribute(.unique) public var id: String
    public var label: String
    public var address: String
    public var namespace: String
    public var custodyMode: String
    public var devicePolicy: String
    public var biometricGate: String
    public var subjectId: String
    public var assuranceLevel: String
    public var createdAt: Int64
    public var updatedAt: Int64

    public init(
        id: String,
        label: String,
        address: String,
        namespace: String,
        custodyMode: String,
        devicePolicy: String,
        biometricGate: String,
        subjectId: String,
        assuranceLevel: String,
        createdAt: Int64,
        updatedAt: Int64
    ) {
        self.id = id
        self.label = label
        self.address = address
        self.namespace = namespace
        self.custodyMode = custodyMode
        self.devicePolicy = devicePolicy
        self.biometricGate = biometricGate
        self.subjectId = subjectId
        self.assuranceLevel = assuranceLevel
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
