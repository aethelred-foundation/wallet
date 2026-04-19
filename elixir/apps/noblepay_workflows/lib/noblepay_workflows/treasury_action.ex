defmodule NoblepayWorkflows.TreasuryAction do
  @moduledoc """
  State machine for NoblePay treasury rebalance actions.

  States: requested -> evaluating -> executing -> completed/failed
  Manages the lifecycle of a treasury rebalance from request through execution.
  """

  use WorkflowOrchestrator.Workflow

  @impl true
  def product, do: :noblepay

  @impl true
  def workflow_type, do: :treasury_action

  @impl true
  def initial_state, do: :requested

  @impl true
  def transitions do
    [
      %{from: :requested, event: :evaluation_started, to: :evaluating, guard: nil},
      %{from: :evaluating, event: :approved_for_execution, to: :executing, guard: nil},
      %{from: :evaluating, event: :evaluation_rejected, to: :failed, guard: nil},
      %{from: :executing, event: :execution_completed, to: :completed, guard: nil},
      %{from: :executing, event: :execution_failed, to: :failed, guard: nil},
      %{from: :failed, event: :retry_requested, to: :requested, guard: nil}
    ]
  end

  @impl true
  def on_enter(:evaluating, context) do
    Map.put(context, :evaluation_started_at, DateTime.utc_now())
  end

  def on_enter(:executing, context) do
    Map.put(context, :execution_started_at, DateTime.utc_now())
  end

  def on_enter(:completed, context) do
    Map.put(context, :completed_at, DateTime.utc_now())
  end

  def on_enter(:failed, context) do
    retry_count = Map.get(context, :retry_count, 0)
    Map.put(context, :retry_count, retry_count + 1)
  end

  def on_enter(_state, context), do: context

  @impl true
  def timeout_config(:evaluating), do: %{timeout_ms: :timer.minutes(30), escalation_event: :evaluation_rejected}
  def timeout_config(:executing), do: %{timeout_ms: :timer.hours(1), escalation_event: :execution_failed}
  def timeout_config(_), do: nil
end
