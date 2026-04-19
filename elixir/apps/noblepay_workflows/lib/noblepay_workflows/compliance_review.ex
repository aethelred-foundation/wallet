defmodule NoblepayWorkflows.ComplianceReview do
  @moduledoc """
  State machine for NoblePay compliance case reviews.

  States: opened -> assigned -> in_review -> escalated -> resolved
  Manages the lifecycle of a compliance review case from creation to resolution.
  """

  use WorkflowOrchestrator.Workflow

  @impl true
  def product, do: :noblepay

  @impl true
  def workflow_type, do: :compliance_review

  @impl true
  def initial_state, do: :opened

  @impl true
  def transitions do
    [
      %{from: :opened, event: :case_assigned, to: :assigned, guard: nil},
      %{from: :assigned, event: :review_started, to: :in_review, guard: nil},
      %{from: :in_review, event: :escalated, to: :escalated, guard: nil},
      %{from: :in_review, event: :resolved, to: :resolved, guard: nil},
      %{from: :escalated, event: :resolved, to: :resolved, guard: nil},
      %{from: :assigned, event: :escalated, to: :escalated, guard: nil}
    ]
  end

  @impl true
  def on_enter(:assigned, context) do
    Map.put(context, :assigned_at, DateTime.utc_now())
  end

  def on_enter(:escalated, context) do
    level = Map.get(context, :escalation_level, 0)
    context
    |> Map.put(:escalated_at, DateTime.utc_now())
    |> Map.put(:escalation_level, level + 1)
  end

  def on_enter(:resolved, context) do
    Map.put(context, :resolved_at, DateTime.utc_now())
  end

  def on_enter(_state, context), do: context

  @impl true
  def timeout_config(:in_review), do: %{timeout_ms: :timer.hours(2), escalation_event: :escalated}
  def timeout_config(_), do: nil
end
