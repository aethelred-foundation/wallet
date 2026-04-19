defmodule OpsRealtime do
  @moduledoc """
  Phoenix Channels endpoint for all live operator dashboards.

  Provides real-time WebSocket channels for:
  - Queue depth and case updates
  - Live alerts by product/severity
  - Workflow state transitions
  - Aggregate dashboards

  All channels require JWT authentication matching the NoblePay websocket.ts pattern.
  """

  @doc """
  Broadcasts a message to a specific channel topic.
  Used by internal services to push updates to connected operators.
  """
  def broadcast(topic, event, payload) do
    OpsRealtimeWeb.Endpoint.broadcast(topic, event, payload)
  end

  @doc """
  Broadcasts a message from within a channel process.
  """
  def broadcast_from(topic, event, payload) do
    OpsRealtimeWeb.Endpoint.broadcast_from(self(), topic, event, payload)
  end
end
