defmodule AeEventContracts.Registry do
  @moduledoc """
  Maps {product, event_type, schema_version} tuples to schema modules.
  Used by event_ingestion to route and validate incoming events.
  """

  alias AeEventContracts.Schemas

  @registry %{
    # NoblePay — 13 events
    {:noblepay, "payment.created", 1} => Schemas.NoblePay.PaymentCreated,
    {:noblepay, "payment.screening_started", 1} => Schemas.NoblePay.PaymentScreeningStarted,
    {:noblepay, "payment.flagged", 1} => Schemas.NoblePay.PaymentFlagged,
    {:noblepay, "payment.approved", 1} => Schemas.NoblePay.PaymentApproved,
    {:noblepay, "payment.settled", 1} => Schemas.NoblePay.PaymentSettled,
    {:noblepay, "payment.rejected", 1} => Schemas.NoblePay.PaymentRejected,
    {:noblepay, "compliance.case_opened", 1} => Schemas.NoblePay.ComplianceCaseOpened,
    {:noblepay, "compliance.escalated", 1} => Schemas.NoblePay.ComplianceEscalated,
    {:noblepay, "compliance.resolved", 1} => Schemas.NoblePay.ComplianceResolved,
    {:noblepay, "treasury.rebalance_triggered", 1} => Schemas.NoblePay.TreasuryRebalanceTriggered,
    {:noblepay, "treasury.liquidity_alert", 1} => Schemas.NoblePay.TreasuryLiquidityAlert,
    {:noblepay, "streaming.payment_created", 1} => Schemas.NoblePay.StreamingPaymentCreated,
    {:noblepay, "crosschain.transfer_state_changed", 1} => Schemas.NoblePay.CrosschainTransferStateChanged,

    # TerraQura — 13 events
    {:terraqura, "verification.batch_submitted", 1} => Schemas.TerraQura.VerificationBatchSubmitted,
    {:terraqura, "verification.source_check_completed", 1} => Schemas.TerraQura.VerificationSourceCheckCompleted,
    {:terraqura, "verification.logic_check_completed", 1} => Schemas.TerraQura.VerificationLogicCheckCompleted,
    {:terraqura, "verification.failed", 1} => Schemas.TerraQura.VerificationFailed,
    {:terraqura, "mint.readiness_confirmed", 1} => Schemas.TerraQura.MintReadinessConfirmed,
    {:terraqura, "mint.succeeded", 1} => Schemas.TerraQura.MintSucceeded,
    {:terraqura, "mint.failed", 1} => Schemas.TerraQura.MintFailed,
    {:terraqura, "kyc.check_requested", 1} => Schemas.TerraQura.KycCheckRequested,
    {:terraqura, "kyc.check_completed", 1} => Schemas.TerraQura.KycCheckCompleted,
    {:terraqura, "sanctions.screening_completed", 1} => Schemas.TerraQura.SanctionsScreeningCompleted,
    {:terraqura, "anomaly.detected", 1} => Schemas.TerraQura.AnomalyDetected,
    {:terraqura, "review.assigned", 1} => Schemas.TerraQura.ReviewAssigned,
    {:terraqura, "notification.requested", 1} => Schemas.TerraQura.NotificationRequested,

    # ZeroID — 10 events
    {:zeroid, "credential.issue_requested", 1} => Schemas.ZeroID.CredentialIssueRequested,
    {:zeroid, "credential.issued", 1} => Schemas.ZeroID.CredentialIssued,
    {:zeroid, "credential.revocation_requested", 1} => Schemas.ZeroID.CredentialRevocationRequested,
    {:zeroid, "credential.revoked", 1} => Schemas.ZeroID.CredentialRevoked,
    {:zeroid, "verification.requested", 1} => Schemas.ZeroID.VerificationRequested,
    {:zeroid, "verification.completed", 1} => Schemas.ZeroID.VerificationCompleted,
    {:zeroid, "verification.anomaly_detected", 1} => Schemas.ZeroID.VerificationAnomalyDetected,
    {:zeroid, "identity.review_required", 1} => Schemas.ZeroID.IdentityReviewRequired,
    {:zeroid, "identity.status_changed", 1} => Schemas.ZeroID.IdentityStatusChanged,
    {:zeroid, "identity.exception_detected", 1} => Schemas.ZeroID.IdentityExceptionDetected,

    # Cruzible — 9 events
    {:cruzible, "reconciliation.tick_started", 1} => Schemas.Cruzible.ReconciliationTickStarted,
    {:cruzible, "reconciliation.drift_detected", 1} => Schemas.Cruzible.ReconciliationDriftDetected,
    {:cruzible, "reconciliation.completed", 1} => Schemas.Cruzible.ReconciliationCompleted,
    {:cruzible, "alert.created", 1} => Schemas.Cruzible.AlertCreated,
    {:cruzible, "alert.acknowledged", 1} => Schemas.Cruzible.AlertAcknowledged,
    {:cruzible, "alert.resolved", 1} => Schemas.Cruzible.AlertResolved,
    {:cruzible, "incident.created", 1} => Schemas.Cruzible.IncidentCreated,
    {:cruzible, "incident.escalated", 1} => Schemas.Cruzible.IncidentEscalated,
    {:cruzible, "incident.resolved", 1} => Schemas.Cruzible.IncidentResolved
  }

  @doc "Look up the schema module for a given product, event type, and version."
  def lookup(product, type, version) do
    case Map.get(@registry, {product, type, version}) do
      nil -> {:error, {:unknown_event, product, type, version}}
      mod -> {:ok, mod}
    end
  end

  @doc "Returns all registered event type keys."
  def all_keys, do: Map.keys(@registry)

  @doc "Returns all registered event types for a given product."
  def keys_for_product(product) do
    @registry
    |> Map.keys()
    |> Enum.filter(fn {p, _, _} -> p == product end)
  end

  @doc "Returns all NATS subjects for a given product."
  def nats_subjects(product) do
    product
    |> keys_for_product()
    |> Enum.map(fn {p, t, _v} -> AeEventContracts.nats_subject(p, t) end)
    |> Enum.uniq()
  end
end
