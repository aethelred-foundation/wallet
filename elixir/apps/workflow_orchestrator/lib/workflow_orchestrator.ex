defmodule WorkflowOrchestrator do
  @moduledoc """
  Generic workflow state machine engine for the Aethelred Elixir Platform.

  Team-specific modules implement the `WorkflowOrchestrator.Workflow` behaviour
  to define states, transitions, guards, and timeouts. The engine handles
  persistence, transition validation, timer management, and PubSub broadcast.
  """

  alias WorkflowOrchestrator.WorkflowServer

  @doc "Start a new workflow instance."
  def start_workflow(workflow_module, entity_id, initial_context \\ %{}, opts \\ []) do
    WorkflowOrchestrator.WorkflowSupervisor.start_workflow(
      workflow_module,
      entity_id,
      initial_context,
      opts
    )
  end

  @doc "Send an event to a running workflow."
  def send_event(workflow_module, entity_id, event, payload \\ %{}) do
    WorkflowServer.send_event(workflow_module, entity_id, event, payload)
  end

  @doc "Get the current state of a workflow."
  def get_state(workflow_module, entity_id) do
    WorkflowServer.get_state(workflow_module, entity_id)
  end

  @doc "List all active workflow instances for a given module."
  def list_active(workflow_module) do
    WorkflowOrchestrator.WorkflowRegistry.list(workflow_module)
  end
end
