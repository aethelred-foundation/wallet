defmodule ZeroidCredentialWorkflows do
  @moduledoc """
  Facade for starting and querying ZeroID credential workflow instances.

  Delegates to WorkflowOrchestrator with the appropriate ZeroID workflow modules.
  """

  alias ZeroidCredentialWorkflows.{Issuance, Revocation, VerificationHandling}

  @type workflow_ref :: {module(), String.t()}

  @doc "Start a new credential issuance workflow."
  @spec start_issuance(String.t(), map()) :: {:ok, pid()} | {:error, term()}
  def start_issuance(credential_id, context \\ %{}) do
    WorkflowOrchestrator.start_workflow(Issuance, credential_id, context)
  end

  @doc "Start a new credential revocation workflow."
  @spec start_revocation(String.t(), map()) :: {:ok, pid()} | {:error, term()}
  def start_revocation(credential_id, context \\ %{}) do
    WorkflowOrchestrator.start_workflow(Revocation, credential_id, context)
  end

  @doc "Start a new verification handling workflow."
  @spec start_verification(String.t(), map()) :: {:ok, pid()} | {:error, term()}
  def start_verification(verification_id, context \\ %{}) do
    WorkflowOrchestrator.start_workflow(VerificationHandling, verification_id, context)
  end

  @doc "Send an event to any ZeroID workflow."
  @spec send_event(module(), String.t(), atom(), map()) :: {:ok, map()} | {:error, term()}
  def send_event(workflow_module, entity_id, event, payload \\ %{}) do
    WorkflowOrchestrator.send_event(workflow_module, entity_id, event, payload)
  end

  @doc "Get the current state of a ZeroID workflow."
  @spec get_state(module(), String.t()) :: {:ok, map()} | {:error, term()}
  def get_state(workflow_module, entity_id) do
    WorkflowOrchestrator.get_state(workflow_module, entity_id)
  end

  @doc "List all active workflow instances for a workflow module."
  @spec list_active(module()) :: [workflow_ref()]
  def list_active(workflow_module) do
    WorkflowOrchestrator.list_active(workflow_module)
  end

  @doc "Returns all ZeroID workflow modules."
  @spec workflow_modules() :: [module()]
  def workflow_modules do
    [Issuance, Revocation, VerificationHandling]
  end
end
