defmodule ZeroidAdminRealtime do
  @moduledoc """
  Real-time event broadcasting for the ZeroID admin dashboard.

  Bridges platform PubSub workflow events to Phoenix channel topics
  that the ZeroID admin dashboard subscribes to.
  """

  @channel_topics %{
    credential_issued: "zeroid:credentials",
    credential_revoked: "zeroid:credentials",
    credential_signing: "zeroid:credentials",
    verification_complete: "zeroid:credentials",
    case_created: "zeroid:reviews",
    case_assigned: "zeroid:reviews",
    case_escalated: "zeroid:reviews",
    case_resolved: "zeroid:reviews",
    admin_alert: "zeroid:admin",
    identity_status_changed: "zeroid:admin"
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
