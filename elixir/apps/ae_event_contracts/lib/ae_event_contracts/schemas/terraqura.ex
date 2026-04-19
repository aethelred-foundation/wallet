defmodule AeEventContracts.Schemas.TerraQura do
  @moduledoc """
  TerraQura event schemas — 13 events covering verification lifecycle,
  minting, KYC/sanctions, anomaly detection, and notifications.

  Maps directly from BullMQ QUEUE_NAMES and job data types in
  dApps/terraqura/packages/queue/src/queues.ts.
  """

  defmodule VerificationBatchSubmitted do
    use AeEventContracts.Schema,
      required: [:batch_id, :dac_unit_id, :period_start, :period_end],
      optional: [:sensor_count, :data_hash, :submitter]
  end

  defmodule VerificationSourceCheckCompleted do
    use AeEventContracts.Schema,
      required: [:batch_id, :dac_unit_id, :result, :checks_passed, :checks_total],
      optional: [:failures, :duration_ms]
  end

  defmodule VerificationLogicCheckCompleted do
    use AeEventContracts.Schema,
      required: [:batch_id, :dac_unit_id, :result, :co2_captured, :efficiency_factor],
      optional: [:anomalies, :confidence_score, :duration_ms]
  end

  defmodule VerificationFailed do
    use AeEventContracts.Schema,
      required: [:batch_id, :dac_unit_id, :failure_phase, :failure_reason],
      optional: [:retry_eligible, :remediation_steps, :error_code]
  end

  defmodule MintReadinessConfirmed do
    use AeEventContracts.Schema,
      required: [:batch_id, :dac_unit_id, :co2_captured, :data_hash, :merkle_root],
      optional: [:operator_address, :ipfs_cid]
  end

  defmodule MintSucceeded do
    use AeEventContracts.Schema,
      required: [:batch_id, :token_id, :tx_hash, :minted_amount],
      optional: [:block_number, :gas_used, :operator_address]
  end

  defmodule MintFailed do
    use AeEventContracts.Schema,
      required: [:batch_id, :failure_reason, :retry_count],
      optional: [:tx_hash, :error_code, :will_retry]
  end

  defmodule KycCheckRequested do
    @moduledoc "Maps from BullMQ KYC_CHECK queue job data (KycCheckJobData)."
    use AeEventContracts.Schema,
      required: [:user_id, :wallet_address, :applicant_id, :provider, :check_type],
      optional: [:priority]
  end

  defmodule KycCheckCompleted do
    use AeEventContracts.Schema,
      required: [:user_id, :applicant_id, :provider, :result, :check_type],
      optional: [:risk_level, :flags, :expires_at]
  end

  defmodule SanctionsScreeningCompleted do
    use AeEventContracts.Schema,
      required: [:user_id, :screening_id, :result, :lists_checked],
      optional: [:matches, :provider, :confidence]
  end

  defmodule AnomalyDetected do
    use AeEventContracts.Schema,
      required: [:anomaly_id, :dac_unit_id, :anomaly_type, :severity, :detected_value],
      optional: [:expected_range, :sensor_id, :timestamp]
  end

  defmodule ReviewAssigned do
    use AeEventContracts.Schema,
      required: [:review_id, :review_type, :assigned_to, :entity_id],
      optional: [:priority, :sla_deadline, :context]
  end

  defmodule NotificationRequested do
    @moduledoc "Maps from BullMQ NOTIFICATIONS queue job data (NotificationJobData)."
    use AeEventContracts.Schema,
      required: [:notification_type, :recipient, :template],
      optional: [:user_id, :data, :priority]
  end
end
