defmodule OpsRealtimeWeb.AlertChannel do
  @moduledoc """
  Channel for live alerts by product and severity.

  Topics: `alerts:{product}` (e.g., `alerts:cruzible`, `alerts:noblepay`)

  Streams real-time alert events to operator dashboards including:
  - New alert creation
  - Alert acknowledgement
  - Alert resolution
  - Severity-based filtering
  """

  use Phoenix.Channel
  require Logger

  @impl true
  def join("alerts:" <> product, params, socket) do
    severity_filter = Map.get(params, "severity_filter", [])

    Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "alerts:#{product}")

    Logger.info("Operator #{socket.assigns.user_id} joined alerts:#{product}")

    {:ok,
     socket
     |> assign(:product, product)
     |> assign(:severity_filter, severity_filter)}
  end

  @impl true
  def handle_info({:alert_created, payload}, socket) do
    if passes_severity_filter?(payload, socket.assigns.severity_filter) do
      push(socket, "alert_created", payload)
    end

    {:noreply, socket}
  end

  def handle_info({:alert_acknowledged, payload}, socket) do
    push(socket, "alert_acknowledged", payload)
    {:noreply, socket}
  end

  def handle_info({:alert_resolved, payload}, socket) do
    push(socket, "alert_resolved", payload)
    {:noreply, socket}
  end

  def handle_info(_msg, socket), do: {:noreply, socket}

  @impl true
  def handle_in("acknowledge", %{"alert_id" => alert_id}, socket) do
    broadcast!(socket, "alert_acknowledged", %{
      alert_id: alert_id,
      acknowledged_by: socket.assigns.user_id,
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
    })

    {:reply, :ok, socket}
  end

  def handle_in("update_filter", %{"severity_filter" => filter}, socket) do
    {:reply, :ok, assign(socket, :severity_filter, filter)}
  end

  defp passes_severity_filter?(_payload, []), do: true

  defp passes_severity_filter?(payload, filter) do
    severity = Map.get(payload, :severity) || Map.get(payload, "severity")
    severity in filter
  end
end
