defmodule CruzibleReconciliationOps do
  @moduledoc """
  Facade for Cruzible reconciliation operations.

  Provides an API for triggering reconciliation runs, querying results,
  and managing reconciliation configuration.
  """

  @doc "Trigger a reconciliation run for a given entity type."
  @spec trigger_reconciliation(atom(), map()) :: :ok | {:error, term()}
  def trigger_reconciliation(entity_type, params \\ %{}) do
    Phoenix.PubSub.broadcast(
      AethelredPlatform.PubSub,
      "cruzible:reconciliation",
      {:reconciliation_requested, %{
        entity_type: entity_type,
        params: params,
        requested_at: DateTime.utc_now()
      }}
    )
  end

  @doc "Get the status of the most recent reconciliation run for an entity type."
  @spec last_run_status(atom()) :: map() | nil
  def last_run_status(entity_type) do
    CruzibleReconciliationOps.EventHandler.last_run_status(entity_type)
  end

  @doc "List all reconciliation entity types that are monitored."
  @spec monitored_entity_types() :: [atom()]
  def monitored_entity_types do
    [:tvl, :reserves, :exchange_rates, :validator_set, :epoch_state, :stablecoin_backing]
  end
end
