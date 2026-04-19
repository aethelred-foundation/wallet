defmodule WorkflowOrchestrator.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      {Registry, keys: :unique, name: WorkflowOrchestrator.WorkflowRegistry.Registry},
      {DynamicSupervisor,
       name: WorkflowOrchestrator.WorkflowSupervisor.DynSup, strategy: :one_for_one}
    ]

    opts = [strategy: :one_for_one, name: WorkflowOrchestrator.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
