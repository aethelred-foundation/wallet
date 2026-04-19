defmodule NoblepayWorkflows.PaymentLifecycle do
  @moduledoc """
  State machine for the NoblePay payment lifecycle.

  States: pending -> screening -> approved/flagged -> settled/rejected
  Handles compliance screening, manual review, settlement, and retry flows.
  """

  use WorkflowOrchestrator.Workflow

  @impl true
  def product, do: :noblepay

  @impl true
  def workflow_type, do: :payment_lifecycle

  @impl true
  def initial_state, do: :pending

  @impl true
  def transitions do
    [
      %{from: :pending, event: :screening_started, to: :screening, guard: nil},
      %{from: :screening, event: :flagged, to: :flagged, guard: nil},
      %{from: :screening, event: :approved, to: :approved, guard: nil},
      %{from: :flagged, event: :approved, to: :approved, guard: nil},
      %{from: :flagged, event: :rejected, to: :rejected, guard: nil},
      %{from: :approved, event: :settled, to: :settled, guard: nil},
      %{from: :approved, event: :settlement_failed, to: :settlement_failed, guard: nil},
      %{from: :settlement_failed, event: :retry_settlement, to: :approved, guard: nil}
    ]
  end

  @impl true
  def on_enter(:flagged, context) do
    Map.put(context, :flagged_at, DateTime.utc_now())
  end

  def on_enter(_state, context), do: context

  @impl true
  def timeout_config(:flagged), do: %{timeout_ms: :timer.hours(4), escalation_event: :escalate_review}
  def timeout_config(_), do: nil
end
