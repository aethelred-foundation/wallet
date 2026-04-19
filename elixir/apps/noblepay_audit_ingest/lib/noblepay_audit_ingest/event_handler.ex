defmodule NoblepayAuditIngest.EventHandler do
  @moduledoc """
  Subscribes to NoblePay workflow transitions and persists audit events to the
  audit_events table, maintaining a cryptographic hash chain.

  Each audit event contains:
  - sequence_number: monotonically increasing per workspace
  - previous_hash: hash of the prior event (or genesis hash for the first)
  - event_hash: SHA-256 of (previous_hash + event content)

  This mirrors the AuditEvent type from wallet/packages/audit/src/types.ts.
  """

  use GenServer
  require Logger

  alias AeShared.Repo

  import Ecto.Query

  @genesis_hash "0000000000000000000000000000000000000000000000000000000000000000"
  @workspace_id "noblepay"

  # --- Client API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Persist a workflow transition as an audit event (synchronous)."
  @spec persist_audit_event(map()) :: {:ok, map()} | {:error, term()}
  def persist_audit_event(transition) do
    GenServer.call(__MODULE__, {:persist, transition})
  end

  @doc "Get the latest audit event."
  @spec get_latest_event() :: {:ok, map()} | {:error, :no_events}
  def get_latest_event do
    query =
      from(a in "audit_events",
        where: a.workspace_id == ^@workspace_id,
        order_by: [desc: a.sequence_number],
        limit: 1,
        select: map(a, [:id, :sequence_number, :timestamp, :kind, :subject_id,
                         :workspace_id, :event_hash, :previous_hash, :detail])
      )

    case Repo.one(query) do
      nil -> {:error, :no_events}
      event -> {:ok, event}
    end
  end

  @doc "Verify the hash chain integrity for the last N events."
  @spec verify_chain(pos_integer()) :: {:ok, :valid} | {:error, term()}
  def verify_chain(count) do
    query =
      from(a in "audit_events",
        where: a.workspace_id == ^@workspace_id,
        order_by: [asc: a.sequence_number],
        limit: ^count,
        select: map(a, [:id, :sequence_number, :event_hash, :previous_hash,
                         :timestamp, :kind, :subject_id, :workspace_id, :detail])
      )

    events = Repo.all(query)
    verify_chain_links(events, @genesis_hash)
  end

  # --- Server Callbacks ---

  @impl true
  def init(_opts) do
    Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "workflow:noblepay")

    Logger.info("NoblepayAuditIngest.EventHandler started, subscribed to workflow:noblepay")
    {:ok, %{events_ingested: 0}}
  end

  @impl true
  def handle_call({:persist, transition}, _from, state) do
    case do_persist(transition) do
      {:ok, event} ->
        {:reply, {:ok, event}, %{state | events_ingested: state.events_ingested + 1}}

      {:error, reason} = err ->
        Logger.error("Failed to persist audit event: #{inspect(reason)}")
        {:reply, err, state}
    end
  end

  @impl true
  def handle_info({:workflow_transition, transition}, state) do
    case do_persist(transition) do
      {:ok, _event} ->
        {:noreply, %{state | events_ingested: state.events_ingested + 1}}

      {:error, reason} ->
        Logger.error("Failed to auto-persist audit event: #{inspect(reason)}")
        {:noreply, state}
    end
  end

  @impl true
  def handle_info(_msg, state), do: {:noreply, state}

  # --- Private ---

  defp do_persist(transition) do
    Repo.transaction(fn ->
      {prev_hash, prev_seq} = get_chain_tip()

      seq = prev_seq + 1
      now_ms = System.system_time(:millisecond)

      kind = build_kind(transition)
      subject_id = Map.get(transition, :entity_id, "unknown")

      detail = %{
        "workflow_type" => to_string(Map.get(transition, :workflow_type)),
        "event" => to_string(Map.get(transition, :event)),
        "from_state" => to_string(Map.get(transition, :from)),
        "to_state" => to_string(Map.get(transition, :to))
      }

      event_hash = compute_hash(prev_hash, seq, now_ms, kind, subject_id, detail)

      event = %{
        id: generate_id(),
        sequence_number: seq,
        timestamp: now_ms,
        kind: kind,
        subject_id: subject_id,
        workspace_id: @workspace_id,
        app_id: "noblepay",
        session_id: nil,
        intent_id: Map.get(transition, :entity_id),
        detail: detail,
        previous_hash: prev_hash,
        event_hash: event_hash
      }

      {1, _} = Repo.insert_all("audit_events", [event])
      event
    end)
  end

  defp get_chain_tip do
    query =
      from(a in "audit_events",
        where: a.workspace_id == ^@workspace_id,
        order_by: [desc: a.sequence_number],
        limit: 1,
        select: {a.event_hash, a.sequence_number}
      )

    case Repo.one(query) do
      nil -> {@genesis_hash, 0}
      {hash, seq} -> {hash, seq}
    end
  end

  defp compute_hash(previous_hash, sequence_number, timestamp, kind, subject_id, detail) do
    payload =
      [
        previous_hash,
        Integer.to_string(sequence_number),
        Integer.to_string(timestamp),
        kind,
        subject_id,
        Jason.encode!(detail)
      ]
      |> Enum.join("|")

    :crypto.hash(:sha256, payload)
    |> Base.encode16(case: :lower)
  end

  defp build_kind(%{workflow_type: wt, event: event}) do
    "workflow.#{wt}.#{event}"
  end

  defp build_kind(_), do: "workflow.unknown"

  defp verify_chain_links([], _expected_prev), do: {:ok, :valid}

  defp verify_chain_links([event | rest], expected_prev) do
    if event.previous_hash == expected_prev do
      verify_chain_links(rest, event.event_hash)
    else
      {:error,
       {:broken_chain,
        sequence: event.sequence_number,
        expected_previous: expected_prev,
        actual_previous: event.previous_hash}}
    end
  end

  defp generate_id do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end
end
