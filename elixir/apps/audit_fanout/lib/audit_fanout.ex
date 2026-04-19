defmodule AuditFanout do
  @moduledoc """
  Tamper-evident audit trail mirroring the AuditEvent type from
  `wallet/packages/audit/src/types.ts`.

  Maintains a SHA-256 hash chain across all audit events, ensuring
  append-only integrity. Supports timeline reconstruction, evidence
  export packaging, and chain verification.
  """

  alias AuditFanout.Capture
  alias AuditFanout.Timeline
  alias AuditFanout.Export

  @doc """
  Captures and persists an audit event.

  Normalizes the event, computes the hash chain link, and persists
  to the `audit_events` table.

  ## Required params
  - `:kind` - event kind (e.g., "payment.created", "credential.issued")
  - `:subject_id` - primary entity ID
  - `:workspace_id` - workspace/tenant ID
  - `:detail` - event detail map

  ## Optional params
  - `:app_id`, `:session_id`, `:intent_id`
  """
  def capture(params) when is_map(params) do
    Capture.capture(params)
  end

  @doc """
  Reconstructs a chronological timeline of audit events for a subject
  within a workspace.

  ## Options
  - `:from` - start timestamp (DateTime)
  - `:to` - end timestamp (DateTime)
  - `:kinds` - list of event kinds to filter
  - `:limit` - max events (default 1000)
  """
  def build_timeline(subject_id, opts \\ []) do
    Timeline.build(subject_id, opts)
  end

  @doc """
  Creates an evidence export package for a subject or workspace.

  Returns an ExportPackage struct with integrity_hash, chain_start_sequence,
  chain_end_sequence, and the collected events.

  ## Options
  - `:workspace_id` - scope to workspace
  - `:from` / `:to` - time range
  - `:format` - output format (:json or :csv, default :json)
  """
  def export_package(subject_id, opts \\ []) do
    Export.create_package(subject_id, opts)
  end

  @doc """
  Validates the integrity of the hash chain for a sequence of audit events.

  Returns `{:ok, :valid}` if the chain is intact, or
  `{:error, {:broken_at, sequence_number}}` if a break is detected.
  """
  def verify_chain(opts \\ []) do
    Capture.verify_chain(opts)
  end
end
