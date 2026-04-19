defmodule CruzibleAlerts do
  @moduledoc """
  Facade for creating, acknowledging, and resolving Cruzible ops alerts.

  Delegates to the AlertManager GenServer for deduplication and rate limiting,
  and to Ecto for persistence.
  """

  alias CruzibleAlerts.Schemas.Alert
  alias CruzibleAlerts.AlertManager
  alias AeShared.Repo

  import Ecto.Query

  @alert_types [
    :reconciliation_mismatch,
    :exchange_rate_drift,
    :tvl_anomaly,
    :epoch_stale,
    :validator_count_drop,
    :stablecoin_circuit_breaker,
    :stablecoin_reserve_drift,
    :stablecoin_config_mismatch
  ]

  @doc "Returns the list of valid alert types."
  @spec alert_types() :: [atom()]
  def alert_types, do: @alert_types

  @doc "Create a new alert (routed through AlertManager for dedup and rate limiting)."
  @spec create_alert(map()) :: {:ok, Alert.t()} | {:error, term()}
  def create_alert(attrs) do
    AlertManager.create_alert(attrs)
  end

  @doc "Acknowledge an alert."
  @spec acknowledge_alert(String.t(), String.t()) :: {:ok, Alert.t()} | {:error, term()}
  def acknowledge_alert(alert_id, acknowledged_by) do
    case get_alert(alert_id) do
      {:ok, alert} ->
        alert
        |> Alert.changeset(%{
          status: "acknowledged",
          acknowledged_by: acknowledged_by,
          acknowledged_at: DateTime.utc_now(),
          updated_at: DateTime.utc_now()
        })
        |> Repo.update()

      error ->
        error
    end
  end

  @doc "Resolve an alert."
  @spec resolve_alert(String.t(), String.t(), String.t()) :: {:ok, Alert.t()} | {:error, term()}
  def resolve_alert(alert_id, resolved_by, resolution) do
    case get_alert(alert_id) do
      {:ok, alert} ->
        alert
        |> Alert.changeset(%{
          status: "resolved",
          resolved_at: DateTime.utc_now(),
          updated_at: DateTime.utc_now(),
          context:
            alert.context
            |> Map.put("resolved_by", resolved_by)
            |> Map.put("resolution", resolution)
        })
        |> Repo.update()

      error ->
        error
    end
  end

  @doc "Get an alert by ID."
  @spec get_alert(String.t()) :: {:ok, Alert.t()} | {:error, :not_found}
  def get_alert(alert_id) do
    case Repo.get(Alert, alert_id) do
      nil -> {:error, :not_found}
      alert -> {:ok, alert}
    end
  end

  @doc "List alerts filtered by status, type, and/or severity."
  @spec list_alerts(keyword()) :: [Alert.t()]
  def list_alerts(opts \\ []) do
    Alert
    |> filter_by_status(Keyword.get(opts, :status))
    |> filter_by_type(Keyword.get(opts, :alert_type))
    |> filter_by_severity(Keyword.get(opts, :severity))
    |> order_by([a], [desc: a.severity_level, desc: a.created_at])
    |> Repo.all()
  end

  @doc "List active (non-resolved) alerts."
  @spec list_active() :: [Alert.t()]
  def list_active do
    Alert
    |> where([a], a.status != "resolved")
    |> order_by([a], [desc: a.severity_level, desc: a.created_at])
    |> Repo.all()
  end

  defp filter_by_status(query, nil), do: query
  defp filter_by_status(query, status), do: where(query, [a], a.status == ^status)

  defp filter_by_type(query, nil), do: query
  defp filter_by_type(query, type), do: where(query, [a], a.alert_type == ^to_string(type))

  defp filter_by_severity(query, nil), do: query
  defp filter_by_severity(query, severity), do: where(query, [a], a.severity == ^to_string(severity))
end
