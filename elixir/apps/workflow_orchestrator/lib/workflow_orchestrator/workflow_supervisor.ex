defmodule WorkflowOrchestrator.WorkflowSupervisor do
  @moduledoc """
  Manages lifecycle of workflow GenServer instances via DynamicSupervisor.
  """

  def start_workflow(workflow_module, entity_id, initial_context, opts \\ []) do
    spec = {
      WorkflowOrchestrator.WorkflowServer,
      {workflow_module, entity_id, initial_context, opts}
    }

    DynamicSupervisor.start_child(__MODULE__.DynSup, spec)
  end
end
