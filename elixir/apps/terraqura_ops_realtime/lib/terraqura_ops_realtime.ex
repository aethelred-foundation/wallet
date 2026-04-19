defmodule TerraquraOpsRealtime do
  @moduledoc """
  Real-time operations dashboard support for TerraQura.

  Subscribes to platform PubSub topics and broadcasts events
  to Phoenix Channels for the ops dashboard.
  """

  alias TerraquraOpsRealtime.EventBroadcaster

  @topics [
    "terraqura:verification",
    "terraqura:minting",
    "terraqura:queues",
    "terraqura:alerts"
  ]

  @doc "Returns the list of PubSub topics this app subscribes to."
  def topics, do: @topics

  @doc "Broadcasts an event to the specified topic."
  def broadcast(topic, event, payload) when topic in @topics do
    EventBroadcaster.broadcast(topic, event, payload)
  end

  def broadcast(topic, _event, _payload) do
    {:error, {:unknown_topic, topic}}
  end

  @doc "Subscribes the calling process to a TerraQura ops topic."
  def subscribe(topic) when topic in @topics do
    EventBroadcaster.subscribe(topic)
  end

  def subscribe(topic), do: {:error, {:unknown_topic, topic}}
end
