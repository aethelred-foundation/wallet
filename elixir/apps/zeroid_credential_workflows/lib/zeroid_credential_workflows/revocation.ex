defmodule ZeroidCredentialWorkflows.Revocation do
  @moduledoc """
  State machine for ZeroID credential revocation.

  States: requested -> propagating -> revoked
  Handles revocation propagation to status lists with failure recovery.
  """

  use WorkflowOrchestrator.Workflow

  @impl true
  def product, do: :zeroid

  @impl true
  def workflow_type, do: :credential_revocation

  @impl true
  def initial_state, do: :requested

  @impl true
  def transitions do
    [
      %{from: :requested, event: :propagation_started, to: :propagating, guard: nil},
      %{from: :propagating, event: :propagation_complete, to: :revoked, guard: nil},
      %{from: :propagating, event: :propagation_failed, to: :failed, guard: nil},
      %{from: :failed, event: :retry_propagation, to: :propagating, guard: nil},
      %{from: :failed, event: :manual_revocation, to: :revoked, guard: nil}
    ]
  end

  @impl true
  def on_enter(:propagating, context) do
    Map.put(context, :propagation_started_at, DateTime.utc_now())
  end

  def on_enter(:revoked, context) do
    Map.put(context, :revoked_at, DateTime.utc_now())
  end

  def on_enter(_state, context), do: context

  @impl true
  def timeout_config(:propagating), do: %{timeout_ms: :timer.minutes(10), escalation_event: :propagation_failed}
  def timeout_config(_), do: nil
end
