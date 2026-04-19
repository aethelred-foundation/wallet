defmodule AeEventContracts.Schemas.Shiora do
  @moduledoc """
  Shiora discovery event schemas — 8 candidate events.

  These are defined for taxonomy completeness and contract testing,
  but Shiora has no runtime Elixir services. The schemas support
  the Week 6 decision on whether Shiora graduates to workflow adoption.
  """

  defmodule AlertCreated do
    use AeEventContracts.Schema,
      required: [:alert_id, :alert_type, :severity, :patient_context],
      optional: [:description, :source, :care_team_ids]
  end

  defmodule AlertAcknowledged do
    use AeEventContracts.Schema,
      required: [:alert_id, :acknowledged_by, :role],
      optional: [:notes, :escalation_prevented]
  end

  defmodule ComplianceCheckTriggered do
    use AeEventContracts.Schema,
      required: [:check_id, :check_type, :subject_id, :regulation],
      optional: [:jurisdiction, :triggered_by]
  end

  defmodule ConsentUpdated do
    use AeEventContracts.Schema,
      required: [:consent_id, :patient_id, :consent_type, :new_status],
      optional: [:grantor, :scope, :effective_at, :expires_at]
  end

  defmodule EmergencyEscalated do
    use AeEventContracts.Schema,
      required: [:emergency_id, :severity, :patient_id, :escalated_to],
      optional: [:location, :vitals_snapshot, :care_team_notified]
  end

  defmodule RecordsAccessRequested do
    use AeEventContracts.Schema,
      required: [:request_id, :patient_id, :requester_id, :access_type, :record_types],
      optional: [:purpose, :consent_reference]
  end

  defmodule CareEscalationTriggered do
    use AeEventContracts.Schema,
      required: [:escalation_id, :patient_id, :trigger_reason, :severity, :escalated_to],
      optional: [:clinical_context, :recommended_action]
  end

  defmodule ClinicalInsightGenerated do
    use AeEventContracts.Schema,
      required: [:insight_id, :patient_id, :insight_type, :confidence],
      optional: [:source_model, :recommendations, :supporting_data_refs]
  end
end
