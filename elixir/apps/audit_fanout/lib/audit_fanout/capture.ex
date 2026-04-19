defmodule AuditFanout.Capture do
  @moduledoc """
  Normalizes audit events and maintains a SHA-256 hash chain.

  Each event's `event_hash` is computed from its content concatenated with the
  `previous_hash`, creating a tamper-evident chain. The `SequenceCounter` agent
  ensures monotonically increasing sequence numbers.
  """

  alias AuditFanout.Schemas.AuditEvent
  alias AeShared.Repo
  import Ecto.Query
  require Logger

  @genesis_hash String.duplicate("0", 64)

  @doc """
  Captures and persists an audit event with hash chain linking.
  """
  def capture(params) when is_map(params) do
    sequence = __MODULE__.SequenceCounter.next()
    previous_hash = get_previous_hash()

    id = generate_id()
    timestamp = Map.get(params, :timestamp, System.system_time(:millisecond))

    event_data = %{
      id: id,
      sequence_number: sequence,
      timestamp: timestamp,
      kind: Map.fetch!(params, :kind),
      subject_id: Map.fetch!(params, :subject_id),
      workspace_id: Map.fetch!(params, :workspace_id),
      app_id: Map.get(params, :app_id),
      session_id: Map.get(params, :session_id),
      intent_id: Map.get(params, :intent_id),
      detail: Map.get(params, :detail, %{}),
      previous_hash: previous_hash
    }

    event_hash = compute_hash(event_data)
    event_data = Map.put(event_data, :event_hash, event_hash)

    changeset = AuditEvent.changeset(%AuditEvent{}, event_data)

    case Repo.insert(changeset) do
      {:ok, event} ->
        Logger.debug("Audit event captured: #{id} seq=#{sequence} kind=#{event.kind}")
        {:ok, event}

      {:error, changeset} ->
        Logger.error("Failed to capture audit event: #{inspect(changeset.errors)}")
        {:error, changeset}
    end
  end

  @doc """
  Verifies the integrity of the hash chain.

  ## Options
  - `:from` - start sequence number (default: 1)
  - `:to` - end sequence number (default: latest)
  - `:workspace_id` - scope verification to a workspace
  """
  def verify_chain(opts \\ []) do
    events = fetch_chain_events(opts)

    case events do
      [] ->
        {:ok, :valid}

      [first | rest] ->
        verify_chain_links(first, rest)
    end
  end

  # --- Internal ---

  defp get_previous_hash do
    case Repo.one(
           from(e in AuditEvent,
             order_by: [desc: e.sequence_number],
             limit: 1,
             select: e.event_hash
           )
         ) do
      nil -> @genesis_hash
      hash -> hash
    end
  end

  defp compute_hash(event_data) do
    payload =
      [
        event_data.id,
        Integer.to_string(event_data.sequence_number),
        Integer.to_string(event_data.timestamp),
        event_data.kind,
        event_data.subject_id,
        event_data.workspace_id,
        event_data.app_id || "",
        event_data.session_id || "",
        event_data.intent_id || "",
        Jason.encode!(event_data.detail || %{}),
        event_data.previous_hash
      ]
      |> Enum.join("|")

    :crypto.hash(:sha256, payload) |> Base.encode16(case: :lower)
  end

  defp fetch_chain_events(opts) do
    query = from(e in AuditEvent, order_by: [asc: e.sequence_number])

    query =
      case Keyword.get(opts, :from) do
        nil -> query
        seq -> where(query, [e], e.sequence_number >= ^seq)
      end

    query =
      case Keyword.get(opts, :to) do
        nil -> query
        seq -> where(query, [e], e.sequence_number <= ^seq)
      end

    query =
      case Keyword.get(opts, :workspace_id) do
        nil -> query
        ws -> where(query, [e], e.workspace_id == ^ws)
      end

    Repo.all(query)
  end

  defp verify_chain_links(_current, []), do: {:ok, :valid}

  defp verify_chain_links(current, [next | rest]) do
    if next.previous_hash == current.event_hash do
      # Recompute the hash to verify integrity
      recomputed =
        compute_hash(%{
          id: next.id,
          sequence_number: next.sequence_number,
          timestamp: next.timestamp,
          kind: next.kind,
          subject_id: next.subject_id,
          workspace_id: next.workspace_id,
          app_id: next.app_id,
          session_id: next.session_id,
          intent_id: next.intent_id,
          detail: next.detail,
          previous_hash: next.previous_hash
        })

      if recomputed == next.event_hash do
        verify_chain_links(next, rest)
      else
        {:error, {:hash_mismatch, next.sequence_number}}
      end
    else
      {:error, {:broken_at, next.sequence_number}}
    end
  end

  defp generate_id do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end

  # --- Sequence Counter Agent ---

  defmodule SequenceCounter do
    @moduledoc false
    use Agent

    def start_link(_opts) do
      initial = get_max_sequence()
      Agent.start_link(fn -> initial end, name: __MODULE__)
    end

    def next do
      Agent.get_and_update(__MODULE__, fn seq ->
        next_seq = seq + 1
        {next_seq, next_seq}
      end)
    end

    def current do
      Agent.get(__MODULE__, & &1)
    end

    defp get_max_sequence do
      case Repo.one(
             from(e in AuditEvent,
               select: max(e.sequence_number)
             )
           ) do
        nil -> 0
        max -> max
      end
    end
  end
end
