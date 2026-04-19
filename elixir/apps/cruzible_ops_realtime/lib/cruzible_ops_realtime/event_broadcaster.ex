defmodule CruzibleOpsRealtime.EventBroadcaster do
  @moduledoc """
  GenServer that subscribes to platform PubSub topics for Cruzible events
  and rebroadcasts them to the ops dashboard channel topics.
  """

  use GenServer
  require Logger

  @subscribe_topics [
    "workflow:cruzible",
    "cruzible:alerts",
    "cruzible:reconciliation",
    "cruzible:protocol_events"
  ]

  # --- Client API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Server Callbacks ---

  @impl true
  def init(_opts) do
    for topic <- @subscribe_topics do
      Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, topic)
    end

    Logger.info("CruzibleOpsRealtime.EventBroadcaster started, subscribed to #{inspect(@subscribe_topics)}")
    {:ok, %{events_broadcast: 0}}
  end

  @impl true
  def handle_info({:workflow_transition, %{workflow_type: :incident} = transition}, state) do
    event_type = incident_transition_to_event(transition.event)
    payload = build_transition_payload(transition)
    CruzibleOpsRealtime.broadcast(event_type, payload)
    {:noreply, %{state | events_broadcast: state.events_broadcast + 1}}
  end

  @impl true
  def handle_info({event_type, payload}, state) when is_atom(event_type) and is_map(payload) do
    CruzibleOpsRealtime.broadcast(event_type, payload)
    {:noreply, %{state | events_broadcast: state.events_broadcast + 1}}
  end

  @impl true
  def handle_info(_msg, state), do: {:noreply, state}

  # --- Private ---

  defp incident_transition_to_event(:acknowledged), do: :incident_acknowledged
  defp incident_transition_to_event(:escalated), do: :incident_escalated
  defp incident_transition_to_event(:mitigated), do: :incident_resolved
  defp incident_transition_to_event(:resolved), do: :incident_resolved
  defp incident_transition_to_event(:auto_resolved), do: :incident_resolved
  defp incident_transition_to_event(_), do: :incident_created

  defp build_transition_payload(transition) do
    %{
      entity_id: transition.entity_id,
      workflow_type: transition.workflow_type,
      event: transition.event,
      from_state: transition.from,
      to_state: transition.to,
      timestamp: DateTime.utc_now()
    }
  end
end
