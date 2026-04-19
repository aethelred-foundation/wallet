defmodule NoblepayAuditIngest do
  @moduledoc """
  Facade for ingesting NoblePay audit events.

  Persists workflow transition audit events to the audit_events table,
  maintaining the hash chain (previous_hash -> event_hash) per the
  AuditEvent type from the TypeScript audit package.
  """

  alias NoblepayAuditIngest.EventHandler

  @doc "Ingest a workflow transition as an audit event."
  @spec ingest_transition(map()) :: {:ok, map()} | {:error, term()}
  def ingest_transition(transition) do
    EventHandler.persist_audit_event(transition)
  end

  @doc "Get the latest audit event for hash chain continuity."
  @spec latest_event() :: {:ok, map()} | {:error, :no_events}
  def latest_event do
    EventHandler.get_latest_event()
  end

  @doc "Verify the hash chain integrity for the last N events."
  @spec verify_chain(pos_integer()) :: {:ok, :valid} | {:error, term()}
  def verify_chain(count \\ 100) do
    EventHandler.verify_chain(count)
  end
end
