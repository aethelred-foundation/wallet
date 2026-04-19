defmodule NoblepayOpsRealtime.EventBroadcaster do
  @moduledoc """
  Subscribes to platform PubSub workflow events for NoblePay and rebroadcasts
  them to the appropriate Phoenix channel topics for the ops dashboard.

  Maps workflow transitions to ops-dashboard event types:
  - Payment lifecycle transitions -> "noblepay:payments"
  - Compliance case events -> "noblepay:compliance"
  - Treasury action events -> "noblepay:treasury"
  - Case queue events -> "noblepay:alerts"
  """

  use GenServer
  require Logger

  # --- Client API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Server Callbacks ---

  @impl true
  def init(_opts) do
    # Subscribe to NoblePay workflow transitions
    Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "workflow:noblepay")
    # Subscribe to case queue events
    Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "cases:noblepay")

    Logger.info("NoblepayOpsRealtime.EventBroadcaster started")
    {:ok, %{events_broadcast: 0}}
  end

  @impl true
  def handle_info({:workflow_transition, transition}, state) do
    event_type = classify_transition(transition)
    payload = build_ops_payload(transition)

    case NoblepayOpsRealtime.broadcast(event_type, payload) do
      :ok ->
        Logger.debug("Broadcast #{event_type} for entity #{transition.entity_id}")
        {:noreply, %{state | events_broadcast: state.events_broadcast + 1}}

      {:error, reason} ->
        Logger.warning("Failed to broadcast #{event_type}: #{inspect(reason)}")
        {:noreply, state}
    end
  end

  @impl true
  def handle_info({:case_created, case_info}, state) do
    payload = %{
      type: :case_created,
      case_id: case_info.case_id,
      case_type: case_info.case_type,
      entity_id: case_info.entity_id,
      priority: case_info.priority,
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
    }

    NoblepayOpsRealtime.broadcast(:alert, payload)
    {:noreply, %{state | events_broadcast: state.events_broadcast + 1}}
  end

  @impl true
  def handle_info(_msg, state), do: {:noreply, state}

  # --- Private ---

  defp classify_transition(%{workflow_type: :payment_lifecycle}), do: :payment_update
  defp classify_transition(%{workflow_type: :compliance_review}), do: :compliance_decision
  defp classify_transition(%{workflow_type: :treasury_action}), do: :treasury_event
  defp classify_transition(_), do: :alert

  defp build_ops_payload(transition) do
    %{
      type: transition.event,
      workflow_type: transition.workflow_type,
      entity_id: transition.entity_id,
      from_state: transition.from,
      to_state: transition.to,
      timestamp: (transition[:timestamp] || DateTime.utc_now()) |> DateTime.to_iso8601(),
      context: sanitize_context(transition.context)
    }
  end

  # Strip internal fields from context before sending to the dashboard.
  defp sanitize_context(context) when is_map(context) do
    context
    |> Map.drop([:event_payload, :__struct__])
    |> Enum.map(fn
      {k, %DateTime{} = v} -> {k, DateTime.to_iso8601(v)}
      {k, v} when is_atom(v) -> {k, Atom.to_string(v)}
      pair -> pair
    end)
    |> Map.new()
  end

  defp sanitize_context(_), do: %{}
end
