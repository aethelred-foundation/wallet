defmodule OpsRealtimeWeb.QueueChannel do
  @moduledoc """
  Channel for queue depth and case updates.

  Topics: `queue:{product}` (e.g., `queue:noblepay`, `queue:terraqura`)

  Operators join to receive real-time updates about:
  - Case queue depth changes
  - Case assignment/reassignment events
  - Priority escalations
  """

  use Phoenix.Channel
  require Logger

  @impl true
  def join("queue:" <> product, _params, socket) do
    # Subscribe to internal PubSub for queue events
    Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "queue_updates:#{product}")

    send(self(), :send_initial_state)

    Logger.info("Operator #{socket.assigns.user_id} joined queue:#{product}")
    {:ok, assign(socket, :product, product)}
  end

  @impl true
  def handle_info(:send_initial_state, socket) do
    # Push current queue depths to the newly joined client
    push(socket, "queue_state", %{
      product: socket.assigns.product,
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
    })

    {:noreply, socket}
  end

  def handle_info({:queue_update, payload}, socket) do
    push(socket, "queue_update", payload)
    {:noreply, socket}
  end

  def handle_info({:case_assigned, payload}, socket) do
    push(socket, "case_assigned", payload)
    {:noreply, socket}
  end

  def handle_info(_msg, socket), do: {:noreply, socket}

  @impl true
  def handle_in("claim_case", %{"case_id" => case_id}, socket) do
    # Operator claims a case from the queue
    broadcast!(socket, "case_claimed", %{
      case_id: case_id,
      claimed_by: socket.assigns.user_id,
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
    })

    {:reply, :ok, socket}
  end

  def handle_in("release_case", %{"case_id" => case_id}, socket) do
    broadcast!(socket, "case_released", %{
      case_id: case_id,
      released_by: socket.assigns.user_id,
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
    })

    {:reply, :ok, socket}
  end
end
