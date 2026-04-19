defmodule ZeroidCredentialWorkflows.VerificationHandling do
  @moduledoc """
  State machine for ZeroID credential verification handling.

  States: received -> checking -> verified / anomaly_detected -> reported
  Handles credential verification requests with anomaly detection and reporting.
  """

  use WorkflowOrchestrator.Workflow

  @impl true
  def product, do: :zeroid

  @impl true
  def workflow_type, do: :verification_handling

  @impl true
  def initial_state, do: :received

  @impl true
  def transitions do
    [
      %{from: :received, event: :check_started, to: :checking, guard: nil},
      %{from: :checking, event: :check_passed, to: :verified, guard: nil},
      %{from: :checking, event: :anomaly_found, to: :anomaly_detected, guard: nil},
      %{from: :anomaly_detected, event: :report_filed, to: :reported, guard: nil},
      %{from: :anomaly_detected, event: :false_positive, to: :verified, guard: nil}
    ]
  end

  @impl true
  def on_enter(:anomaly_detected, context) do
    Map.put(context, :anomaly_detected_at, DateTime.utc_now())
  end

  def on_enter(:verified, context) do
    Map.put(context, :verified_at, DateTime.utc_now())
  end

  def on_enter(_state, context), do: context

  @impl true
  def timeout_config(:checking), do: %{timeout_ms: :timer.minutes(2), escalation_event: :check_timeout}
  def timeout_config(_), do: nil
end
