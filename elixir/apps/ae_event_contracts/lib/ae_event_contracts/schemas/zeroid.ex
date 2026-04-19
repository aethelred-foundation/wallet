defmodule AeEventContracts.Schemas.ZeroID do
  @moduledoc """
  ZeroID event schemas — 10 events covering credential lifecycle,
  verification, and identity exception handling.

  Elixir orchestrates around the cryptographic trust boundary
  but never touches KMS signing, TEE services, or ZK proof generation.
  """

  defmodule CredentialIssueRequested do
    use AeEventContracts.Schema,
      required: [:request_id, :subject_id, :credential_type, :issuer_id],
      optional: [:claims, :expiry_requested, :workspace_id]
  end

  defmodule CredentialIssued do
    use AeEventContracts.Schema,
      required: [:credential_id, :request_id, :subject_id, :credential_type, :issuer_id, :issued_at],
      optional: [:expiry, :proof_type, :schema_url]
  end

  defmodule CredentialRevocationRequested do
    use AeEventContracts.Schema,
      required: [:credential_id, :requested_by, :reason],
      optional: [:effective_at, :replacement_credential_id]
  end

  defmodule CredentialRevoked do
    use AeEventContracts.Schema,
      required: [:credential_id, :revoked_by, :revoked_at, :reason],
      optional: [:propagation_targets, :status_list_updated]
  end

  defmodule VerificationRequested do
    use AeEventContracts.Schema,
      required: [:verification_id, :credential_id, :verifier_id, :verification_type],
      optional: [:challenge, :presentation_context]
  end

  defmodule VerificationCompleted do
    use AeEventContracts.Schema,
      required: [:verification_id, :credential_id, :result, :verifier_id],
      optional: [:proof_valid, :revocation_checked, :duration_ms]
  end

  defmodule VerificationAnomalyDetected do
    use AeEventContracts.Schema,
      required: [:verification_id, :credential_id, :anomaly_type, :severity],
      optional: [:details, :recommended_action]
  end

  defmodule IdentityReviewRequired do
    use AeEventContracts.Schema,
      required: [:review_id, :subject_id, :review_type, :trigger_reason],
      optional: [:priority, :assigned_to, :deadline]
  end

  defmodule IdentityStatusChanged do
    use AeEventContracts.Schema,
      required: [:subject_id, :previous_status, :new_status, :changed_by],
      optional: [:reason, :effective_at]
  end

  defmodule IdentityExceptionDetected do
    use AeEventContracts.Schema,
      required: [:exception_id, :subject_id, :exception_type, :severity],
      optional: [:details, :credential_ids, :recommended_action]
  end
end
