defmodule AuditFanout.Export do
  @moduledoc """
  Creates evidence export packages matching the TypeScript ExportPackage type.

  An export package contains a verified slice of the audit chain with
  integrity metadata, suitable for regulatory submission or compliance review.
  """

  alias AuditFanout.Schemas.{AuditEvent, ExportPackage}
  alias AeShared.Repo
  import Ecto.Query

  @doc """
  Creates an export package for a given subject.

  ## Options
  - `:workspace_id` - scope to workspace
  - `:from` - start timestamp (milliseconds)
  - `:to` - end timestamp (milliseconds)
  - `:format` - `:json` (default) or `:csv`
  """
  def create_package(subject_id, opts \\ []) do
    format = Keyword.get(opts, :format, :json)

    events = fetch_events(subject_id, opts)

    case events do
      [] ->
        {:error, :no_events}

      events ->
        first = List.first(events)
        last = List.last(events)

        integrity_hash = compute_integrity_hash(events)

        package = %ExportPackage{
          export_id: generate_id(),
          subject_id: subject_id,
          workspace_id: Keyword.get(opts, :workspace_id),
          chain_start_sequence: first.sequence_number,
          chain_end_sequence: last.sequence_number,
          integrity_hash: integrity_hash,
          exported_at: DateTime.utc_now(),
          event_count: length(events),
          events: Enum.map(events, &serialize_event/1),
          format: format
        }

        {:ok, package}
    end
  end

  @doc """
  Encodes an export package to the specified format.
  """
  def encode(%ExportPackage{format: :json} = package) do
    {:ok,
     Jason.encode!(%{
       export_id: package.export_id,
       subject_id: package.subject_id,
       workspace_id: package.workspace_id,
       chain_start_sequence: package.chain_start_sequence,
       chain_end_sequence: package.chain_end_sequence,
       integrity_hash: package.integrity_hash,
       exported_at: DateTime.to_iso8601(package.exported_at),
       event_count: package.event_count,
       events: package.events
     })}
  end

  def encode(%ExportPackage{format: :csv} = package) do
    headers = "id,sequence_number,timestamp,kind,subject_id,workspace_id,app_id,session_id,intent_id,event_hash"

    rows =
      Enum.map(package.events, fn e ->
        [
          e["id"],
          e["sequence_number"],
          e["timestamp"],
          e["kind"],
          e["subject_id"],
          e["workspace_id"],
          e["app_id"] || "",
          e["session_id"] || "",
          e["intent_id"] || "",
          e["event_hash"]
        ]
        |> Enum.map(&to_string/1)
        |> Enum.join(",")
      end)

    {:ok, Enum.join([headers | rows], "\n")}
  end

  # --- Internal ---

  defp fetch_events(subject_id, opts) do
    query =
      from(e in AuditEvent,
        where: e.subject_id == ^subject_id,
        order_by: [asc: e.sequence_number]
      )

    query =
      case Keyword.get(opts, :workspace_id) do
        nil -> query
        ws -> where(query, [e], e.workspace_id == ^ws)
      end

    query =
      case Keyword.get(opts, :from) do
        nil -> query
        from -> where(query, [e], e.timestamp >= ^from)
      end

    query =
      case Keyword.get(opts, :to) do
        nil -> query
        to -> where(query, [e], e.timestamp <= ^to)
      end

    Repo.all(query)
  end

  defp compute_integrity_hash(events) do
    payload =
      events
      |> Enum.map(& &1.event_hash)
      |> Enum.join("|")

    :crypto.hash(:sha256, payload) |> Base.encode16(case: :lower)
  end

  defp serialize_event(%AuditEvent{} = event) do
    %{
      "id" => event.id,
      "sequence_number" => event.sequence_number,
      "timestamp" => event.timestamp,
      "kind" => event.kind,
      "subject_id" => event.subject_id,
      "workspace_id" => event.workspace_id,
      "app_id" => event.app_id,
      "session_id" => event.session_id,
      "intent_id" => event.intent_id,
      "detail" => event.detail,
      "previous_hash" => event.previous_hash,
      "event_hash" => event.event_hash
    }
  end

  defp generate_id do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end
end
