defmodule TerraquraVerificationWorkflows.VerificationBatch do
  @moduledoc """
  State machine for TerraQura carbon credit verification batches.

  Lifecycle: submitted -> source_checking -> logic_checking -> mint_ready -> completed
  With failure/remediation branches at each verification stage.
  """

  use WorkflowOrchestrator.Workflow

  @impl true
  def product, do: :terraqura

  @impl true
  def workflow_type, do: :verification_batch

  @impl true
  def initial_state, do: :submitted

  @impl true
  def transitions do
    [
      %{from: :submitted, event: :source_check_started, to: :source_checking, guard: nil},
      %{from: :source_checking, event: :source_check_passed, to: :logic_checking, guard: nil},
      %{from: :source_checking, event: :source_check_failed, to: :failed, guard: nil},
      %{from: :logic_checking, event: :logic_check_passed, to: :mint_ready, guard: nil},
      %{from: :logic_checking, event: :logic_check_failed, to: :failed, guard: nil},
      %{from: :mint_ready, event: :mint_succeeded, to: :completed, guard: nil},
      %{from: :mint_ready, event: :mint_failed, to: :mint_failed, guard: nil},
      %{from: :mint_failed, event: :retry_mint, to: :mint_ready, guard: nil},
      %{from: :failed, event: :remediation_started, to: :remediating, guard: nil},
      %{from: :remediating, event: :resubmitted, to: :submitted, guard: nil}
    ]
  end

  @impl true
  def on_enter(:failed, context) do
    Map.put(context, :failed_at, DateTime.utc_now())
  end

  def on_enter(:completed, context) do
    Map.put(context, :completed_at, DateTime.utc_now())
  end

  def on_enter(_state, context), do: context

  @impl true
  def timeout_config(:source_checking),
    do: %{timeout_ms: :timer.minutes(30), escalation_event: :source_check_timeout}

  def timeout_config(:logic_checking),
    do: %{timeout_ms: :timer.minutes(30), escalation_event: :logic_check_timeout}

  def timeout_config(_), do: nil
end
