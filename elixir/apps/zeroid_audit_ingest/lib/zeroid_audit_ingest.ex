defmodule ZeroidAuditIngest do
  @moduledoc """
  Facade for the ZeroID audit event ingestion pipeline.

  Provides an API for querying audit events and verifying hash chain integrity.
  """

  alias ZeroidAuditIngest.EventHandler
  alias AeShared.Repo

  import Ecto.Query

  @doc "Manually ingest an audit event (primarily for testing)."
  @spec ingest(map()) :: {:ok, map()} | {:error, term()}
  def ingest(event) do
    EventHandler.persist_audit_event(event)
  end

  @doc "Query audit events for a given entity."
  @spec events_for(String.t(), keyword()) :: [map()]
  def events_for(entity_id, opts \\ []) do
    limit = Keyword.get(opts, :limit, 100)

    from(a in "zeroid_audit_events",
      where: a.entity_id == ^entity_id,
      order_by: [desc: a.sequence_number],
      limit: ^limit,
      select: map(a, [:id, :entity_id, :event_type, :payload, :hash, :previous_hash, :sequence_number, :recorded_at])
    )
    |> Repo.all()
  end

  @doc "Verify the hash chain integrity for a given entity."
  @spec verify_chain(String.t()) :: :ok | {:error, {:broken_chain, non_neg_integer()}}
  def verify_chain(entity_id) do
    events =
      from(a in "zeroid_audit_events",
        where: a.entity_id == ^entity_id,
        order_by: [asc: a.sequence_number],
        select: map(a, [:hash, :previous_hash, :sequence_number])
      )
      |> Repo.all()

    verify_chain_links(events)
  end

  defp verify_chain_links([]), do: :ok
  defp verify_chain_links([_single]), do: :ok

  defp verify_chain_links([prev, current | rest]) do
    if current.previous_hash == prev.hash do
      verify_chain_links([current | rest])
    else
      {:error, {:broken_chain, current.sequence_number}}
    end
  end
end
