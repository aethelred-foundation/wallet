import XCTest
@testable import AethelredWallet

final class CredentialServiceTests: XCTestCase {

    private func stubAccount() -> WalletAccount {
        WalletAccount.make(
            label: "Test",
            publicKey: Data(repeating: 0x04, count: 65),
            devicePolicy: .softwareOnly,
            gate: .everySignature
        )
    }

    private func record(id: String, schema: String) -> VerifiableCredentialRecord {
        VerifiableCredentialRecord(
            id: id,
            issuer: "issuer-1",
            subject: "subject-1",
            schema: schema,
            payload: "{}",
            issuedAt: 1_713_000_000_000
        )
    }

    func testAddListRemoveRoundTrip() async throws {
        let service = CredentialService()
        try await service.add(record(id: "c1", schema: "kyc"))
        try await service.add(record(id: "c2", schema: "aml"))
        var listed = try await service.list()
        XCTAssertEqual(listed.count, 2)
        try await service.remove(id: "c1")
        listed = try await service.list()
        XCTAssertEqual(listed.count, 1)
        XCTAssertEqual(listed.first?.id, "c2")
    }

    func testBuildPresentationReferencesRequested() async throws {
        let service = CredentialService()
        try await service.add(record(id: "c1", schema: "kyc"))
        try await service.add(record(id: "c2", schema: "aml"))
        let descriptor = PresentationDescriptor(id: "desc-1", requested: ["kyc", "aml"], challenge: "chal")
        let presentation = try await service.buildPresentation(for: descriptor, wallet: stubAccount())
        XCTAssertEqual(presentation.descriptorId, descriptor.id)
        XCTAssertEqual(Set(presentation.selectedCredentials), Set(["c1", "c2"]))
        XCTAssertFalse(presentation.proof.isEmpty)
    }

    func testBuildPresentationIsDeterministicForSameInputs() async throws {
        let service = CredentialService()
        try await service.add(record(id: "c1", schema: "kyc"))
        let wallet = stubAccount()
        let descriptor = PresentationDescriptor(id: "d", requested: ["kyc"], challenge: "x")
        let first = try await service.buildPresentation(for: descriptor, wallet: wallet)
        let second = try await service.buildPresentation(for: descriptor, wallet: wallet)
        XCTAssertEqual(first.proof, second.proof)
    }
}
