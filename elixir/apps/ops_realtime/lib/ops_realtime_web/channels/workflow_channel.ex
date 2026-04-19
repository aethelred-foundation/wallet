defmodule OpsRealtimeWeb.WorkflowChannel do
  @moduledoc """
  Channel for workflow state transitions.

  Topics: `workflows:{product}` (e.g., `workflows:noblepay`)

  Streams real-time workflow events to operator dashboards including:
  - State transition notifications
  - Workflow started/completed events
  - Timeout and escalation alerts
  """

  use Phoenix.Channel
  require Logger

  @impl true
  def join("workflows:" <> product, _params, socket) do
    Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "workflows:#{product}")

    Logger.info("Operator #{socket.assigns.user_id} joined workflows:#{product}")
    {:ok, assign(socket, :product, product)}
  end

  @impl true
  def handle_info({:workflow_transition, payload}, socket) do
    push(socket, "workflow_transition", payload)
    {:noreply, socket}
  end

  def handle_info({:workflow_started, payload}, socket) do
    push(socket, "workflow_started", payload)
    {:noreply, socket}
  end

  def handle_info({:workflow_completed, payload}, socket) do
    push(socket, "workflow_completed", payload)
    {:noreply, socket}
  end

  def handle_info({:workflow_timeout, payload}, socket) do
    push(socket, "workflow_timeout", payload)
    {:noreply, socket}
  end

  def handle_info(_msg, socket), do: {:noreply, socket}

  @impl true
  def handle_in("get_workflow_state", %{"entity_id" => entity_id, "workflow_type" => _type}, socket) do
    # Query workflow state — callers must provide the correct module atom at runtime
    case WorkflowOrchestrator.WorkflowServer.get_state(nil, entity_id) do
      {:ok, state} ->
        {:reply, {:ok, %{state: state}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  rescue
    _ -> {:reply, {:error, %{reason: "invalid_workflow_type"}}, socket}
  end
end
