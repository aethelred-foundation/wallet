defmodule NoblepayOpsRealtime do
  @moduledoc """
  Real-time event broadcasting for the NoblePay ops dashboard.

  Replaces the NoblePay WebSocketService by bridging platform PubSub workflow
  events to Phoenix channel topics that the ops dashboard subscribes to.
  """

  @channel_topics %{
    payment_update: "noblepay:payments",
    compliance_decision: "noblepay:compliance",
    treasury_event: "noblepay:treasury",
    liquidity_update: "noblepay:liquidity",
    stream_tick: "noblepay:streams",
    alert: "noblepay:alerts",
    crosschain_update: "noblepay:crosschain"
  }

  @doc "Returns the mapping of event types to channel topics."
  @spec channel_topics() :: %{atom() => String.t()}
  def channel_topics, do: @channel_topics

  @doc "Get the channel topic for a given event type."
  @spec topic_for(atom()) :: String.t() | nil
  def topic_for(event_type), do: Map.get(@channel_topics, event_type)

  @doc "All channel topic strings."
  @spec all_topics() :: [String.t()]
  def all_topics, do: Map.values(@channel_topics)

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
