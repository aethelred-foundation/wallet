defmodule ZeroidAuditIngest.EventHandler do
  @moduledoc """
  GenServer that subscribes to ZeroID workflow transitions via PubSub
  and persists audit events with a cryptographic hash chain for tamper evidence.

  Each audit event contains a SHA-256 hash of its payload concatenated with
  the previous event's hash, forming an append-only verifiable chain.
  """

  use GenServer
  require Logger

  alias AeShared.Repo

  # --- Client API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Persist an audit event (called internally and exposed for direct ingestion)."
  @spec persist_audit_event(map()) :: {:ok, map()} | {:error, term()}
  def persist_audit_event(event) do
    GenServer.call(__MODULE__, {:persist, event})
  end

  # --- Server Callbacks ---

  @impl true
  def init(_opts) do
    Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "workflow:zeroid")
    Logger.info("ZeroidAuditIngest.EventHandler started, subscribed to workflow:zeroid")
    {:ok, %{events_persisted: 0}}
  end

  @impl true
  def handle_info({:workflow_transition, transition}, state) do
    audit_event = build_audit_event(transition)

    case do_persist(audit_event) do
      {:ok, _record} ->
        {:noreply, %{state | events_persisted: state.events_persisted + 1}}

      {:error, reason} ->
        Logger.error("Failed to persist audit event for #{transition.entity_id}: #{inspect(reason)}")
        {:noreply, state}
    end
  end

  @impl true
  def handle_info(_msg, state), do: {:noreply, state}

  @impl true
  def handle_call({:persist, event}, _from, state) do
    case do_persist(event) do
      {:ok, record} ->
        {:reply, {:ok, record}, %{state | events_persisted: state.events_persisted + 1}}

      {:error, _} = error ->
        {:reply, error, state}
    end
  end

  # --- Private ---

  defp build_audit_event(transition) do
    %{
      entity_id: transition.entity_id,
      event_type: to_string(transition.event),
      payload: %{
        "workflow_type" => to_string(transition.workflow_type),
        "from_state" => to_string(transition.from),
        "to_state" => to_string(transition.to),
        "context" => transition.context
      }
    }
  end

  defp do_persist(event) do
    entity_id = Map.get(event, :entity_id) || Map.get(event, "entity_id")
    {previous_hash, sequence_number} = get_chain_head(entity_id)

    payload_json = Jason.encode!(Map.get(event, :payload) || Map.get(event, "payload", %{}))
    hash = compute_hash(payload_json, previous_hash)

    record = %{
      id: generate_id(),
      entity_id: entity_id,
      event_type: Map.get(event, :event_type) || Map.get(event, "event_type"),
      payload: Map.get(event, :payload) || Map.get(event, "payload", %{}),
      hash: hash,
      previous_hash: previous_hash,
      sequence_number: sequence_number,
      recorded_at: DateTime.utc_now()
    }

    case Repo.insert_all("zeroid_audit_events", [record], on_conflict: :nothing) do
      {1, _} -> {:ok, record}
      {0, _} -> {:error, :conflict}
      error -> {:error, error}
    end
  end

  defp get_chain_head(entity_id) do
    import Ecto.Query

    case Repo.one(
           from(a in "zeroid_audit_events",
             where: a.entity_id == ^entity_id,
             order_by: [desc: a.sequence_number],
             limit: 1,
             select: {a.hash, a.sequence_number}
           )
         ) do
      {hash, seq} -> {hash, seq + 1}
      nil -> {"genesis", 1}
    end
  end

  defp compute_hash(payload_json, previous_hash) do
    :crypto.hash(:sha256, previous_hash <> payload_json)
    |> Base.encode16(case: :lower)
  end

  defp generate_id do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end
end
