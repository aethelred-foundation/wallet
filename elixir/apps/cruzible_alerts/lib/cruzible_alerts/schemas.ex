defmodule CruzibleAlerts.Schemas.Alert do
  @moduledoc """
  Ecto schema for the cruzible_alerts table.

  Represents an operational alert raised by the Cruzible monitoring subsystem,
  covering reconciliation, exchange rates, TVL, epochs, validators, and stablecoin health.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :string, autogenerate: false}
  @timestamps_opts false

  schema "cruzible_alerts" do
    field :product, :string
    field :alert_type, :string
    field :severity, :string, default: "medium"
    field :severity_level, :integer, default: 50
    field :status, :string, default: "open"
    field :entity_id, :string
    field :dedup_key, :string
    field :acknowledged_by, :string
    field :acknowledged_at, :utc_datetime_usec
    field :context, :map, default: %{}
    field :created_at, :utc_datetime_usec
    field :updated_at, :utc_datetime_usec
    field :resolved_at, :utc_datetime_usec
  end

  @required_fields [:id, :product, :alert_type, :severity, :entity_id, :created_at, :updated_at]
  @optional_fields [
    :severity_level, :status, :dedup_key, :acknowledged_by, :acknowledged_at,
    :context, :resolved_at
  ]

  @valid_alert_types ~w(
    reconciliation_mismatch exchange_rate_drift tvl_anomaly epoch_stale
    validator_count_drop stablecoin_circuit_breaker stablecoin_reserve_drift
    stablecoin_config_mismatch
  )
  @valid_severities ~w(low medium high critical)
  @valid_statuses ~w(open acknowledged resolved)

  @type t :: %__MODULE__{}

  @doc "Build a changeset for creating or updating an alert."
  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(alert, attrs) do
    alert
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:alert_type, @valid_alert_types)
    |> validate_inclusion(:severity, @valid_severities)
    |> validate_inclusion(:status, @valid_statuses)
    |> validate_number(:severity_level, greater_than_or_equal_to: 0)
  end
end
