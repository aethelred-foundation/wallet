defmodule CruzibleReconciliationOps.EventHandler do
  @moduledoc """
  GenServer that consumes reconciliation events from PubSub and triggers
  alerts when drift is detected between expected and observed values.

  Monitors TVL, reserves, exchange rates, validator sets, epoch state,
  and stablecoin backing for discrepancies.
  """

  use GenServer
  require Logger

  @drift_thresholds %{
    tvl: 0.02,
    reserves: 0.01,
    exchange_rates: 0.005,
    validator_set: 0.05,
    epoch_state: 0.0,
    stablecoin_backing: 0.01
  }

  # --- Client API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Get the last run status for an entity type."
  @spec last_run_status(atom()) :: map() | nil
  def last_run_status(entity_type) do
    GenServer.call(__MODULE__, {:last_run_status, entity_type})
  end

  # --- Server Callbacks ---

  @impl true
  def init(_opts) do
    Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "cruzible:reconciliation")
    Logger.info("CruzibleReconciliationOps.EventHandler started, subscribed to cruzible:reconciliation")
    {:ok, %{last_runs: %{}, alerts_raised: 0}}
  end

  @impl true
  def handle_info({:reconciliation_result, result}, state) do
    state = process_reconciliation_result(result, state)
    {:noreply, state}
  end

  @impl true
  def handle_info(_msg, state), do: {:noreply, state}

  @impl true
  def handle_call({:last_run_status, entity_type}, _from, state) do
    {:reply, Map.get(state.last_runs, entity_type), state}
  end

  # --- Private ---

  defp process_reconciliation_result(result, state) do
    entity_type = result.entity_type
    drift = calculate_drift(result)
    threshold = Map.get(@drift_thresholds, entity_type, 0.01)

    run_status = %{
      entity_type: entity_type,
      drift: drift,
      threshold: threshold,
      drifted: drift > threshold,
      completed_at: DateTime.utc_now(),
      expected: result[:expected],
      observed: result[:observed]
    }

    state = put_in(state, [:last_runs, entity_type], run_status)

    if drift > threshold do
      raise_drift_alert(entity_type, drift, threshold, result)
      %{state | alerts_raised: state.alerts_raised + 1}
    else
      Logger.debug("Reconciliation OK for #{entity_type}: drift=#{drift} (threshold=#{threshold})")
      state
    end
  end

  defp calculate_drift(%{expected: expected, observed: observed})
       when is_number(expected) and is_number(observed) and expected != 0 do
    abs(observed - expected) / abs(expected)
  end

  defp calculate_drift(_), do: 0.0

  defp raise_drift_alert(entity_type, drift, threshold, result) do
    alert_type = entity_type_to_alert_type(entity_type)

    Logger.warning(
      "Drift detected for #{entity_type}: #{drift} exceeds threshold #{threshold}"
    )

    Phoenix.PubSub.broadcast(
      AethelredPlatform.PubSub,
      "cruzible:alerts",
      {:drift_detected, %{
        alert_type: alert_type,
        entity_type: entity_type,
        entity_id: Map.get(result, :entity_id, to_string(entity_type)),
        drift: drift,
        threshold: threshold,
        expected: result[:expected],
        observed: result[:observed],
        severity: drift_severity(drift, threshold),
        timestamp: DateTime.utc_now()
      }}
    )
  end

  defp entity_type_to_alert_type(:tvl), do: :tvl_anomaly
  defp entity_type_to_alert_type(:reserves), do: :stablecoin_reserve_drift
  defp entity_type_to_alert_type(:exchange_rates), do: :exchange_rate_drift
  defp entity_type_to_alert_type(:validator_set), do: :validator_count_drop
  defp entity_type_to_alert_type(:epoch_state), do: :epoch_stale
  defp entity_type_to_alert_type(:stablecoin_backing), do: :stablecoin_reserve_drift
  defp entity_type_to_alert_type(_), do: :reconciliation_mismatch

  defp drift_severity(drift, threshold) when drift > threshold * 5, do: "critical"
  defp drift_severity(drift, threshold) when drift > threshold * 2, do: "high"
  defp drift_severity(_, _), do: "medium"
end
