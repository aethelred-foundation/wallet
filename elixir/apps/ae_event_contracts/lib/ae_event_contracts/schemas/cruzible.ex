defmodule AeEventContracts.Schemas.Cruzible do
  @moduledoc """
  Cruzible event schemas — 9 events covering reconciliation,
  alerts, and incident lifecycle.

  Maps existing AlertType enums (RECONCILIATION_MISMATCH, EXCHANGE_RATE_DRIFT,
  TVL_ANOMALY, EPOCH_STALE, VALIDATOR_COUNT_DROP, STABLECOIN_CIRCUIT_BREAKER,
  STABLECOIN_RESERVE_DRIFT, STABLECOIN_CONFIG_MISMATCH) to Elixir atoms.
  """

  defmodule ReconciliationTickStarted do
    use AeEventContracts.Schema,
      required: [:tick_id, :reconciliation_type, :started_at],
      optional: [:scope, :previous_tick_id]
  end

  defmodule ReconciliationDriftDetected do
    use AeEventContracts.Schema,
      required: [:tick_id, :drift_type, :expected_value, :actual_value, :severity],
      optional: [:asset, :chain, :pool_id, :drift_percentage]
  end

  defmodule ReconciliationCompleted do
    use AeEventContracts.Schema,
      required: [:tick_id, :result, :duration_ms, :checks_performed],
      optional: [:drifts_found, :auto_resolved]
  end

  defmodule AlertCreated do
    use AeEventContracts.Schema,
      required: [:alert_id, :alert_type, :severity, :title, :source],
      optional: [:description, :entity_id, :threshold, :current_value, :dedup_key]
  end

  defmodule AlertAcknowledged do
    use AeEventContracts.Schema,
      required: [:alert_id, :acknowledged_by],
      optional: [:notes, :escalation_prevented]
  end

  defmodule AlertResolved do
    use AeEventContracts.Schema,
      required: [:alert_id, :resolved_by, :resolution],
      optional: [:notes, :root_cause, :duration_ms]
  end

  defmodule IncidentCreated do
    use AeEventContracts.Schema,
      required: [:incident_id, :alert_ids, :severity, :title, :incident_type],
      optional: [:description, :assigned_to, :runbook_url]
  end

  defmodule IncidentEscalated do
    use AeEventContracts.Schema,
      required: [:incident_id, :escalation_level, :escalated_to, :reason],
      optional: [:previous_assignee, :sla_breached]
  end

  defmodule IncidentResolved do
    use AeEventContracts.Schema,
      required: [:incident_id, :resolved_by, :resolution, :root_cause],
      optional: [:notes, :duration_ms, :follow_up_actions]
  end
end
