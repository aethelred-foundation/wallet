defmodule CruzibleIncidentQueue.IncidentWorkflow do
  @moduledoc """
  State machine for Cruzible operational incidents.

  States: open -> acknowledged -> escalated/mitigated -> resolved
  Handles incident lifecycle with timeout-based auto-escalation.
  """

  use WorkflowOrchestrator.Workflow

  @impl true
  def product, do: :cruzible

  @impl true
  def workflow_type, do: :incident

  @impl true
  def initial_state, do: :open

  @impl true
  def transitions do
    [
      %{from: :open, event: :acknowledged, to: :acknowledged, guard: nil},
      %{from: :acknowledged, event: :escalated, to: :escalated, guard: nil},
      %{from: :acknowledged, event: :mitigated, to: :mitigated, guard: nil},
      %{from: :escalated, event: :mitigated, to: :mitigated, guard: nil},
      %{from: :mitigated, event: :resolved, to: :resolved, guard: nil},
      %{from: :open, event: :auto_resolved, to: :resolved, guard: nil}
    ]
  end

  @impl true
  def on_enter(:acknowledged, context) do
    Map.put(context, :acknowledged_at, DateTime.utc_now())
  end

  def on_enter(:escalated, context) do
    Map.put(context, :escalated_at, DateTime.utc_now())
  end

  def on_enter(:mitigated, context) do
    Map.put(context, :mitigated_at, DateTime.utc_now())
  end

  def on_enter(:resolved, context) do
    Map.put(context, :resolved_at, DateTime.utc_now())
  end

  def on_enter(_state, context), do: context

  @impl true
  def timeout_config(:open), do: %{timeout_ms: :timer.minutes(15), escalation_event: :escalated}
  def timeout_config(:acknowledged), do: %{timeout_ms: :timer.hours(1), escalation_event: :escalated}
  def timeout_config(_), do: nil
end
