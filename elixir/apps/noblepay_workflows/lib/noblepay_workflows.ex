defmodule NoblepayWorkflows do
  @moduledoc """
  Facade for starting and querying NoblePay workflow instances.

  Delegates to WorkflowOrchestrator with the appropriate NoblePay workflow modules.
  """

  alias NoblepayWorkflows.{PaymentLifecycle, ComplianceReview, TreasuryAction}

  @type workflow_ref :: {module(), String.t()}

  @doc "Start a new payment lifecycle workflow."
  @spec start_payment(String.t(), map()) :: {:ok, pid()} | {:error, term()}
  def start_payment(payment_id, context \\ %{}) do
    WorkflowOrchestrator.start_workflow(PaymentLifecycle, payment_id, context)
  end

  @doc "Start a new compliance review workflow."
  @spec start_compliance_review(String.t(), map()) :: {:ok, pid()} | {:error, term()}
  def start_compliance_review(case_id, context \\ %{}) do
    WorkflowOrchestrator.start_workflow(ComplianceReview, case_id, context)
  end

  @doc "Start a new treasury action workflow."
  @spec start_treasury_action(String.t(), map()) :: {:ok, pid()} | {:error, term()}
  def start_treasury_action(action_id, context \\ %{}) do
    WorkflowOrchestrator.start_workflow(TreasuryAction, action_id, context)
  end

  @doc "Send an event to any NoblePay workflow."
  @spec send_event(module(), String.t(), atom(), map()) :: {:ok, map()} | {:error, term()}
  def send_event(workflow_module, entity_id, event, payload \\ %{}) do
    WorkflowOrchestrator.send_event(workflow_module, entity_id, event, payload)
  end

  @doc "Get the current state of a NoblePay workflow."
  @spec get_state(module(), String.t()) :: {:ok, map()} | {:error, term()}
  def get_state(workflow_module, entity_id) do
    WorkflowOrchestrator.get_state(workflow_module, entity_id)
  end

  @doc "List all active workflow instances for a workflow module."
  @spec list_active(module()) :: [workflow_ref()]
  def list_active(workflow_module) do
    WorkflowOrchestrator.list_active(workflow_module)
  end

  @doc "Returns all NoblePay workflow modules."
  @spec workflow_modules() :: [module()]
  def workflow_modules do
    [PaymentLifecycle, ComplianceReview, TreasuryAction]
  end
end
