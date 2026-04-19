defmodule CruzibleAlerts.AlertManager do
  @moduledoc """
  GenServer that manages alert lifecycle with deduplication by dedup_key,
  severity-based routing, and rate limiting.

  Alerts with the same dedup_key within a configurable window are collapsed
  into a single alert with an incremented occurrence count.
  """

  use GenServer
  require Logger

  alias CruzibleAlerts.Schemas.Alert
  alias AeShared.Repo

  @dedup_window_ms :timer.minutes(5)
  @rate_limit_window_ms :timer.seconds(10)
  @max_alerts_per_window 50

  # --- Client API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Create an alert through the manager (applies dedup and rate limiting)."
  @spec create_alert(map()) :: {:ok, Alert.t()} | {:error, term()}
  def create_alert(attrs) do
    GenServer.call(__MODULE__, {:create_alert, attrs})
  end

  # --- Server Callbacks ---

  @impl true
  def init(_opts) do
    state = %{
      dedup_cache: %{},
      rate_counter: 0,
      rate_window_start: System.monotonic_time(:millisecond),
      alerts_created: 0
    }

    Logger.info("CruzibleAlerts.AlertManager started")
    {:ok, state}
  end

  @impl true
  def handle_call({:create_alert, attrs}, _from, state) do
    state = maybe_reset_rate_window(state)

    cond do
      rate_limited?(state) ->
        Logger.warning("AlertManager rate limited, dropping alert: #{inspect(attrs[:alert_type])}")
        {:reply, {:error, :rate_limited}, state}

      deduplicated?(attrs, state) ->
        Logger.debug("AlertManager deduplicated alert with key: #{attrs[:dedup_key]}")
        {:reply, {:error, :deduplicated}, state}

      true ->
        case do_create_alert(attrs) do
          {:ok, alert} ->
            state =
              state
              |> update_dedup_cache(attrs)
              |> Map.update!(:rate_counter, &(&1 + 1))
              |> Map.update!(:alerts_created, &(&1 + 1))

            broadcast_alert(alert)
            route_by_severity(alert)
            {:reply, {:ok, alert}, state}

          {:error, _} = error ->
            {:reply, error, state}
        end
    end
  end

  # --- Private ---

  defp do_create_alert(attrs) do
    now = DateTime.utc_now()

    full_attrs =
      Map.merge(
        %{
          id: generate_id(),
          product: "cruzible",
          status: "open",
          created_at: now,
          updated_at: now,
          severity_level: severity_to_level(Map.get(attrs, :severity, "medium"))
        },
        attrs
      )

    %Alert{}
    |> Alert.changeset(full_attrs)
    |> Repo.insert()
  end

  defp deduplicated?(attrs, %{dedup_cache: cache}) do
    case Map.get(attrs, :dedup_key) do
      nil ->
        false

      key ->
        case Map.get(cache, key) do
          nil -> false
          timestamp -> System.monotonic_time(:millisecond) - timestamp < @dedup_window_ms
        end
    end
  end

  defp update_dedup_cache(state, attrs) do
    case Map.get(attrs, :dedup_key) do
      nil ->
        state

      key ->
        now = System.monotonic_time(:millisecond)
        put_in(state, [:dedup_cache, key], now)
    end
  end

  defp rate_limited?(%{rate_counter: counter}), do: counter >= @max_alerts_per_window

  defp maybe_reset_rate_window(state) do
    now = System.monotonic_time(:millisecond)

    if now - state.rate_window_start > @rate_limit_window_ms do
      %{state | rate_counter: 0, rate_window_start: now}
    else
      state
    end
  end

  defp broadcast_alert(%Alert{} = alert) do
    Phoenix.PubSub.broadcast(
      AethelredPlatform.PubSub,
      "cruzible:alerts",
      {:alert_created, %{
        alert_id: alert.id,
        alert_type: alert.alert_type,
        severity: alert.severity,
        entity_id: alert.entity_id,
        timestamp: DateTime.utc_now()
      }}
    )
  end

  defp route_by_severity(%Alert{severity: "critical"} = alert) do
    Logger.warning("CRITICAL alert raised: #{alert.alert_type} for #{alert.entity_id}")

    Phoenix.PubSub.broadcast(
      AethelredPlatform.PubSub,
      "cruzible:incidents",
      {:critical_alert, %{
        alert_id: alert.id,
        alert_type: alert.alert_type,
        entity_id: alert.entity_id,
        context: alert.context
      }}
    )
  end

  defp route_by_severity(_alert), do: :ok

  defp severity_to_level("critical"), do: 100
  defp severity_to_level("high"), do: 75
  defp severity_to_level("medium"), do: 50
  defp severity_to_level("low"), do: 25
  defp severity_to_level(_), do: 0

  defp generate_id do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end
end
