defmodule WorkflowOrchestrator.WorkflowRegistry do
  @moduledoc """
  Registry-based lookup for active workflow instances.
  Uses Elixir's built-in Registry for local process resolution.
  """

  def list(workflow_module) do
    Registry.select(
      __MODULE__.Registry,
      [{{:"$1", :"$2", :"$3"}, [{:==, {:element, 1, :"$1"}, workflow_module}], [:"$1"]}]
    )
    |> Enum.map(fn {_mod, entity_id} -> entity_id end)
  end

  def lookup(workflow_module, entity_id) do
    case Registry.lookup(__MODULE__.Registry, {workflow_module, entity_id}) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end
end
