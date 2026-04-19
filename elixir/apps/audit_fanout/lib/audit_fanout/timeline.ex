defmodule AuditFanout.Timeline do
  @moduledoc """
  Reconstructs ordered event timelines for a subject or workspace.

  Provides chronological views of audit events for compliance review,
  incident investigation, and regulatory reporting.
  """

  alias AuditFanout.Schemas.AuditEvent
  alias AeShared.Repo
  import Ecto.Query

  @doc """
  Builds a chronological timeline of audit events for a given subject.

  ## Options
  - `:workspace_id` - scope to a specific workspace
  - `:from` - start time as Unix timestamp (milliseconds)
  - `:to` - end time as Unix timestamp (milliseconds)
  - `:kinds` - list of event kinds to include
  - `:limit` - max events to return (default 1000)
  """
  def build(subject_id, opts \\ []) do
    limit = Keyword.get(opts, :limit, 1000)

    query =
      from(e in AuditEvent,
        where: e.subject_id == ^subject_id,
        order_by: [asc: e.sequence_number],
        limit: ^limit
      )

    query = apply_filters(query, opts)

    events = Repo.all(query)

    %{
      subject_id: subject_id,
      event_count: length(events),
      first_sequence: List.first(events) && List.first(events).sequence_number,
      last_sequence: List.last(events) && List.last(events).sequence_number,
      events: Enum.map(events, &format_event/1)
    }
  end

  @doc """
  Builds a timeline for an entire workspace across all subjects.
  """
  def build_workspace_timeline(workspace_id, opts \\ []) do
    limit = Keyword.get(opts, :limit, 1000)

    query =
      from(e in AuditEvent,
        where: e.workspace_id == ^workspace_id,
        order_by: [asc: e.sequence_number],
        limit: ^limit
      )

    query = apply_filters(query, opts)

    events = Repo.all(query)

    subjects =
      events
      |> Enum.map(& &1.subject_id)
      |> Enum.uniq()

    %{
      workspace_id: workspace_id,
      subjects: subjects,
      event_count: length(events),
      events: Enum.map(events, &format_event/1)
    }
  end

  # --- Internal ---

  defp apply_filters(query, opts) do
    query
    |> maybe_filter_workspace(Keyword.get(opts, :workspace_id))
    |> maybe_filter_from(Keyword.get(opts, :from))
    |> maybe_filter_to(Keyword.get(opts, :to))
    |> maybe_filter_kinds(Keyword.get(opts, :kinds))
  end

  defp maybe_filter_workspace(query, nil), do: query
  defp maybe_filter_workspace(query, ws), do: where(query, [e], e.workspace_id == ^ws)

  defp maybe_filter_from(query, nil), do: query
  defp maybe_filter_from(query, from) when is_integer(from) do
    where(query, [e], e.timestamp >= ^from)
  end

  defp maybe_filter_to(query, nil), do: query
  defp maybe_filter_to(query, to) when is_integer(to) do
    where(query, [e], e.timestamp <= ^to)
  end

  defp maybe_filter_kinds(query, nil), do: query
  defp maybe_filter_kinds(query, []), do: query
  defp maybe_filter_kinds(query, kinds) when is_list(kinds) do
    where(query, [e], e.kind in ^kinds)
  end

  defp format_event(%AuditEvent{} = event) do
    %{
      id: event.id,
      sequence_number: event.sequence_number,
      timestamp: event.timestamp,
      kind: event.kind,
      subject_id: event.subject_id,
      workspace_id: event.workspace_id,
      app_id: event.app_id,
      session_id: event.session_id,
      intent_id: event.intent_id,
      detail: event.detail,
      event_hash: event.event_hash
    }
  end
end
