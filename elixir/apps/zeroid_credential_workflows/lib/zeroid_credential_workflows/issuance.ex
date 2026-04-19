defmodule ZeroidCredentialWorkflows.Issuance do
  @moduledoc """
  State machine for ZeroID credential issuance.

  States: requested -> validating -> signing -> issued
  Handles validation, signing, exception branching, and rejection flows.
  """

  use WorkflowOrchestrator.Workflow

  @impl true
  def product, do: :zeroid

  @impl true
  def workflow_type, do: :credential_issuance

  @impl true
  def initial_state, do: :requested

  @impl true
  def transitions do
    [
      %{from: :requested, event: :validation_started, to: :validating, guard: nil},
      %{from: :validating, event: :validation_passed, to: :signing, guard: nil},
      %{from: :validating, event: :validation_failed, to: :exception, guard: nil},
      %{from: :signing, event: :signed, to: :issued, guard: nil},
      %{from: :signing, event: :signing_failed, to: :exception, guard: nil},
      %{from: :exception, event: :review_completed, to: :requested, guard: nil},
      %{from: :exception, event: :rejected, to: :rejected, guard: nil}
    ]
  end

  @impl true
  def timeout_config(:validating), do: %{timeout_ms: :timer.minutes(5), escalation_event: :validation_timeout}
  def timeout_config(_), do: nil
end
