defmodule OpsRealtimeWeb.DashboardChannel do
  @moduledoc """
  Channel for aggregate operator dashboards.

  Topics: `dashboard:{scope}` where scope can be:
  - `dashboard:global` — cross-product aggregate metrics
  - `dashboard:{product}` — product-specific dashboard (e.g., `dashboard:noblepay`)

  Aggregates data from queues, alerts, and workflows into a unified
  real-time dashboard view for operations teams.
  """

  use Phoenix.Channel
  require Logger

  @impl true
  def join("dashboard:" <> scope, _params, socket) do
    # Subscribe to multiple PubSub topics for the aggregate view
    if scope == "global" do
      for product <- ~w(noblepay terraqura zeroid cruzible) do
        Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "queue_updates:#{product}")
        Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "alerts:#{product}")
        Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "workflows:#{product}")
      end
    else
      Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "queue_updates:#{scope}")
      Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "alerts:#{scope}")
      Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "workflows:#{scope}")
    end

    send(self(), :send_snapshot)

    Logger.info("Operator #{socket.assigns.user_id} joined dashboard:#{scope}")
    {:ok, assign(socket, :scope, scope)}
  end

  @impl true
  def handle_info(:send_snapshot, socket) do
    # Send initial dashboard snapshot
    push(socket, "dashboard_snapshot", %{
      scope: socket.assigns.scope,
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
    })

    {:noreply, socket}
  end

  # Forward relevant events as dashboard updates
  def handle_info({:queue_update, payload}, socket) do
    push(socket, "dashboard_update", %{type: "queue", data: payload})
    {:noreply, socket}
  end

  def handle_info({:alert_created, payload}, socket) do
    push(socket, "dashboard_update", %{type: "alert", data: payload})
    {:noreply, socket}
  end

  def handle_info({:alert_resolved, payload}, socket) do
    push(socket, "dashboard_update", %{type: "alert_resolved", data: payload})
    {:noreply, socket}
  end

  def handle_info({:workflow_transition, payload}, socket) do
    push(socket, "dashboard_update", %{type: "workflow", data: payload})
    {:noreply, socket}
  end

  def handle_info({:workflow_completed, payload}, socket) do
    push(socket, "dashboard_update", %{type: "workflow_completed", data: payload})
    {:noreply, socket}
  end

  def handle_info(_msg, socket), do: {:noreply, socket}

  @impl true
  def handle_in("request_refresh", _params, socket) do
    send(self(), :send_snapshot)
    {:reply, :ok, socket}
  end
end
