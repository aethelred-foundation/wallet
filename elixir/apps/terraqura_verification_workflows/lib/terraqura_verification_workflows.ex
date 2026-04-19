defmodule TerraquraVerificationWorkflows do
  @moduledoc """
  TerraQura verification workflow definitions.

  Provides state machines for carbon credit verification batches
  and mint-readiness evaluation via the WorkflowOrchestrator behaviour.
  """

  alias TerraquraVerificationWorkflows.{VerificationBatch, MintReadiness}

  @doc "Returns the verification batch workflow module."
  def verification_batch, do: VerificationBatch

  @doc "Returns the mint readiness workflow module."
  def mint_readiness, do: MintReadiness

  @doc "Lists all workflow modules in this app."
  def workflows do
    [VerificationBatch, MintReadiness]
  end

  @doc "Starts a new verification batch workflow instance."
  def start_verification_batch(batch_id, context \\ %{}) do
    WorkflowOrchestrator.start_workflow(VerificationBatch, batch_id, context)
  end

  @doc "Starts a new mint readiness evaluation workflow."
  def start_mint_readiness(batch_id, context \\ %{}) do
    WorkflowOrchestrator.start_workflow(MintReadiness, batch_id, context)
  end
end
