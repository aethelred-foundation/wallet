defmodule TerraquraVerificationWorkflows.MintReadiness do
  @moduledoc """
  State machine for evaluating whether a verified batch is ready for minting.

  Checks CO2 capture thresholds and prerequisite conditions before
  confirming a batch is ready for on-chain token minting.
  """

  use WorkflowOrchestrator.Workflow

  @co2_minimum_threshold_kg 100.0

  @impl true
  def product, do: :terraqura

  @impl true
  def workflow_type, do: :mint_readiness

  @impl true
  def initial_state, do: :evaluating

  @impl true
  def transitions do
    [
      %{
        from: :evaluating,
        event: :prerequisites_verified,
        to: :prerequisites_met,
        guard: &co2_threshold_met?/1
      },
      %{from: :evaluating, event: :prerequisites_failed, to: :blocked, guard: nil},
      %{
        from: :prerequisites_met,
        event: :readiness_confirmed,
        to: :ready,
        guard: &co2_threshold_met?/1
      },
      %{from: :prerequisites_met, event: :readiness_blocked, to: :blocked, guard: nil},
      %{from: :blocked, event: :re_evaluate, to: :evaluating, guard: nil}
    ]
  end

  @impl true
  def on_enter(:ready, context) do
    context
    |> Map.put(:ready_at, DateTime.utc_now())
    |> Map.put(:mint_eligible, true)
  end

  def on_enter(:blocked, context) do
    Map.put(context, :blocked_at, DateTime.utc_now())
  end

  def on_enter(_state, context), do: context

  @impl true
  def timeout_config(:evaluating),
    do: %{timeout_ms: :timer.minutes(15), escalation_event: :evaluation_timeout}

  def timeout_config(_), do: nil

  @doc """
  Guard: checks that the CO2 captured in the batch context
  meets the minimum threshold for minting eligibility.
  """
  def co2_threshold_met?(%{co2_captured: co2}) when is_number(co2) do
    co2 >= @co2_minimum_threshold_kg
  end

  def co2_threshold_met?(_context), do: false
end
