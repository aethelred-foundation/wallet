defmodule AeShared.Repo.Migrations.CreatePlatformTables do
  use Ecto.Migration

  def change do
    # --- Workflow schema ---

    create table(:workflow_instances, primary_key: false) do
      add :id, :string, primary_key: true
      add :workflow_type, :string, null: false
      add :product, :string, null: false
      add :entity_id, :string, null: false
      add :current_state, :string, null: false
      add :context, :map, default: %{}
      add :started_at, :utc_datetime_usec, null: false
      add :updated_at, :utc_datetime_usec, null: false
      add :completed_at, :utc_datetime_usec
    end

    create index(:workflow_instances, [:entity_id, :workflow_type], unique: true)
    create index(:workflow_instances, [:product])
    create index(:workflow_instances, [:current_state])

    create table(:workflow_transitions, primary_key: false) do
      add :id, :string, primary_key: true
      add :workflow_instance_id, :string, null: false
      add :from_state, :string, null: false
      add :to_state, :string, null: false
      add :event, :string, null: false
      add :context_snapshot, :map, default: %{}
      add :transitioned_at, :utc_datetime_usec, null: false
    end

    create index(:workflow_transitions, [:workflow_instance_id])
    create index(:workflow_transitions, [:transitioned_at])

    # --- Event store ---

    create table(:event_store, primary_key: false) do
      add :id, :string, primary_key: true
      add :type, :string, null: false
      add :schema_version, :integer, null: false
      add :product, :string, null: false
      add :subject, :string, null: false
      add :data, :map, null: false
      add :correlation_id, :string
      add :causation_id, :string
      add :source, :string, null: false
      add :occurred_at, :utc_datetime_usec, null: false
      add :ingested_at, :utc_datetime_usec, null: false
    end

    create index(:event_store, [:product, :type])
    create index(:event_store, [:subject])
    create index(:event_store, [:correlation_id])
    create index(:event_store, [:ingested_at])

    # --- Case queue ---

    create table(:case_queue, primary_key: false) do
      add :id, :string, primary_key: true
      add :product, :string, null: false
      add :queue_name, :string, null: false
      add :case_type, :string, null: false
      add :entity_id, :string, null: false
      add :status, :string, null: false, default: "pending"
      add :assigned_to, :string
      add :priority, :integer, default: 0
      add :escalation_level, :integer, default: 0
      add :context, :map, default: %{}
      add :created_at, :utc_datetime_usec, null: false
      add :updated_at, :utc_datetime_usec, null: false
      add :resolved_at, :utc_datetime_usec
    end

    create index(:case_queue, [:product, :queue_name])
    create index(:case_queue, [:status])
    create index(:case_queue, [:assigned_to])
    create index(:case_queue, [:priority])

    # --- Notifications ---

    create table(:notifications, primary_key: false) do
      add :id, :string, primary_key: true
      add :product, :string, null: false
      add :channel, :string, null: false
      add :recipient, :string, null: false
      add :template, :string, null: false
      add :data, :map, default: %{}
      add :status, :string, null: false, default: "pending"
      add :attempts, :integer, default: 0
      add :last_attempted_at, :utc_datetime_usec
      add :delivered_at, :utc_datetime_usec
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:notifications, [:product, :status])
    create index(:notifications, [:recipient])

    # --- Audit events (mirrors wallet/packages/audit/src/types.ts AuditEvent) ---

    create table(:audit_events, primary_key: false) do
      add :id, :string, primary_key: true
      add :sequence_number, :bigint, null: false
      add :timestamp, :bigint, null: false
      add :kind, :string, null: false
      add :subject_id, :string, null: false
      add :workspace_id, :string, null: false
      add :app_id, :string
      add :session_id, :string
      add :intent_id, :string
      add :detail, :map, default: %{}
      add :previous_hash, :string, null: false
      add :event_hash, :string, null: false
    end

    create index(:audit_events, [:subject_id])
    create index(:audit_events, [:workspace_id])
    create index(:audit_events, [:kind])
    create index(:audit_events, [:sequence_number], unique: true)

    # --- Dead letter queue ---

    create table(:dead_letters, primary_key: false) do
      add :id, :string, primary_key: true
      add :original_event, :map, null: false
      add :error_reason, :string, null: false
      add :attempts, :integer, default: 1
      add :product, :string
      add :created_at, :utc_datetime_usec, null: false
      add :reviewed_at, :utc_datetime_usec
      add :reviewed_by, :string
    end

    create index(:dead_letters, [:product])
    create index(:dead_letters, [:created_at])

    # --- Approval requests (mirrors wallet/packages/approval/src/types.ts) ---

    create table(:approval_requests, primary_key: false) do
      add :id, :string, primary_key: true
      add :title, :string, null: false
      add :summary, :text
      add :workspace_id, :string, null: false
      add :requester_id, :string, null: false
      add :app_id, :string, null: false
      add :intent_id, :string, null: false
      add :intent_kind, :string, null: false
      add :quorum_type, :string, null: false
      add :quorum_threshold, :integer
      add :quorum_total, :integer
      add :status, :string, null: false, default: "pending"
      add :escalation_trigger, :string
      add :escalation_timeout_minutes, :integer
      add :escalation_max, :integer, default: 3
      add :escalation_current_level, :integer, default: 0
      add :context, :map, default: %{}
      add :created_at, :utc_datetime_usec, null: false
      add :expires_at, :utc_datetime_usec, null: false
      add :resolved_at, :utc_datetime_usec
    end

    create index(:approval_requests, [:workspace_id])
    create index(:approval_requests, [:status])

    create table(:approval_decisions, primary_key: false) do
      add :id, :string, primary_key: true
      add :approval_request_id, references(:approval_requests, type: :string, on_delete: :delete_all)
      add :reviewer_id, :string, null: false
      add :reviewer_name, :string, null: false
      add :decision, :string, null: false
      add :reason, :text
      add :decided_at, :utc_datetime_usec, null: false
    end

    create index(:approval_decisions, [:approval_request_id])

    # --- Cruzible alerts (durable store replacing in-memory) ---

    create table(:alerts, primary_key: false) do
      add :id, :string, primary_key: true
      add :product, :string, null: false
      add :alert_type, :string, null: false
      add :severity, :string, null: false
      add :title, :string, null: false
      add :description, :text
      add :source, :string, null: false
      add :entity_id, :string
      add :dedup_key, :string
      add :status, :string, null: false, default: "open"
      add :acknowledged_by, :string
      add :resolved_by, :string
      add :resolution, :string
      add :context, :map, default: %{}
      add :created_at, :utc_datetime_usec, null: false
      add :acknowledged_at, :utc_datetime_usec
      add :resolved_at, :utc_datetime_usec
    end

    create index(:alerts, [:product, :alert_type])
    create index(:alerts, [:severity])
    create index(:alerts, [:status])
    create index(:alerts, [:dedup_key])

    # --- Incidents ---

    create table(:incidents, primary_key: false) do
      add :id, :string, primary_key: true
      add :product, :string, null: false
      add :incident_type, :string, null: false
      add :severity, :string, null: false
      add :title, :string, null: false
      add :description, :text
      add :alert_ids, {:array, :string}, default: []
      add :status, :string, null: false, default: "open"
      add :assigned_to, :string
      add :escalation_level, :integer, default: 0
      add :root_cause, :string
      add :resolution, :string
      add :context, :map, default: %{}
      add :created_at, :utc_datetime_usec, null: false
      add :updated_at, :utc_datetime_usec, null: false
      add :resolved_at, :utc_datetime_usec
    end

    create index(:incidents, [:product])
    create index(:incidents, [:status])
    create index(:incidents, [:severity])
  end
end
