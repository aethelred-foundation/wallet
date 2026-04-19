defmodule CruzibleOpsRealtime do
  @moduledoc """
  Real-time event broadcasting for the Cruzible ops dashboard.

  Bridges platform PubSub events to Phoenix channel topics that the
  Cruzible ops dashboard subscribes to.
  """

  @channel_topics %{
    incident_created: "cruzible:incidents",
    incident_acknowledged: "cruzible:incidents",
    incident_escalated: "cruzible:incidents",
    incident_resolved: "cruzible:incidents",
    reconciliation_result: "cruzible:reconciliation",
    reconciliation_requested: "cruzible:reconciliation",
    drift_detected: "cruzible:reconciliation",
    alert_created: "cruzible:alerts",
    alert_acknowledged: "cruzible:alerts",
    alert_resolved: "cruzible:alerts",
    protocol_update: "cruzible:protocol",
    epoch_transition: "cruzible:protocol",
    validator_change: "cruzible:protocol"
  }

  @doc "Returns the mapping of event types to channel topics."
  @spec channel_topics() :: %{atom() => String.t()}
  def channel_topics, do: @channel_topics

  @doc "Get the channel topic for a given event type."
  @spec topic_for(atom()) :: String.t() | nil
  def topic_for(event_type), do: Map.get(@channel_topics, event_type)

  @doc "All channel topic strings."
  @spec all_topics() :: [String.t()]
  def all_topics, do: Map.values(@channel_topics) |> Enum.uniq()

  @doc "Broadcast an event to the appropriate channel topic."
  @spec broadcast(atom(), map()) :: :ok | {:error, term()}
  def broadcast(event_type, payload) do
    case topic_for(event_type) do
      nil ->
        {:error, {:unknown_event_type, event_type}}

      topic ->
        Phoenix.PubSub.broadcast(
          AethelredPlatform.PubSub,
          topic,
          {event_type, payload}
        )
    end
  end
end
