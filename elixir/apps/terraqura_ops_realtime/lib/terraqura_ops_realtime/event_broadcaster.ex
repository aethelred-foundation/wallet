defmodule TerraquraOpsRealtime.EventBroadcaster do
  @moduledoc """
  Subscribes to AethelredPlatform.PubSub topics and rebroadcasts
  events to Phoenix Channels for the TerraQura ops dashboard.

  Topics:
    - "terraqura:verification" - verification batch lifecycle events
    - "terraqura:minting" - minting and token events
    - "terraqura:queues" - queue depth and throughput metrics
    - "terraqura:alerts" - anomalies, failures, and escalations
  """

  use GenServer

  require Logger

  @pubsub AethelredPlatform.PubSub

  @topics [
    "terraqura:verification",
    "terraqura:minting",
    "terraqura:queues",
    "terraqura:alerts"
  ]

  # --- Client API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Broadcasts an event to a PubSub topic."
  def broadcast(topic, event, payload) when is_binary(topic) do
    Phoenix.PubSub.broadcast(@pubsub, topic, {event, payload})
  end

  @doc "Subscribes the calling process to a PubSub topic."
  def subscribe(topic) when is_binary(topic) do
    Phoenix.PubSub.subscribe(@pubsub, topic)
  end

  # --- Server Callbacks ---

  @impl true
  def init(_opts) do
    Enum.each(@topics, fn topic ->
      Phoenix.PubSub.subscribe(@pubsub, topic)
    end)

    Logger.info("TerraquraOpsRealtime.EventBroadcaster subscribed to #{length(@topics)} topics")
    {:ok, %{event_count: 0}}
  end

  @impl true
  def handle_info({event, payload}, state) when is_atom(event) and is_map(payload) do
    channel_topic = channel_topic_for(event)

    if channel_topic do
      broadcast_to_channel(channel_topic, event, payload)
    end

    {:noreply, %{state | event_count: state.event_count + 1}}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  # --- Private ---

  defp channel_topic_for(event) do
    case event do
      e when e in [:source_check_started, :source_check_passed, :source_check_failed,
                   :logic_check_passed, :logic_check_failed, :verification_failed] ->
        "ops:terraqura:verification"

      e when e in [:mint_succeeded, :mint_failed, :mint_readiness_confirmed] ->
        "ops:terraqura:minting"

      e when e in [:queue_depth_updated, :throughput_updated] ->
        "ops:terraqura:queues"

      e when e in [:anomaly_detected, :review_assigned, :escalation] ->
        "ops:terraqura:alerts"

      _ ->
        nil
    end
  end

  defp broadcast_to_channel(channel_topic, event, payload) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      channel_topic,
      %{
        event: event,
        payload: payload,
        timestamp: DateTime.utc_now()
      }
    )
  end
end
