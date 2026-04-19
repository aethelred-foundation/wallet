defmodule WorkflowOrchestratorTest do
  use ExUnit.Case
  doctest WorkflowOrchestrator

  test "greets the world" do
    assert WorkflowOrchestrator.hello() == :world
  end
end
