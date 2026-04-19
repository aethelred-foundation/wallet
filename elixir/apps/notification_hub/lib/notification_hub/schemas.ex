defmodule NotificationHub.Schemas do
  @moduledoc """
  Ecto schemas for the notification_hub app.
  """

  defmodule Notification do
    @moduledoc """
    Schema for the `notifications` table.
    Tracks notification metadata, delivery status, and attempt history.
    """

    use Ecto.Schema
    import Ecto.Changeset

    @primary_key {:id, :string, autogenerate: false}
    schema "notifications" do
      field :product, :string
      field :channel, :string
      field :recipient, :string
      field :template, :string
      field :data, :map, default: %{}
      field :status, :string, default: "pending"
      field :attempts, :integer, default: 0
      field :last_attempted_at, :utc_datetime_usec
      field :delivered_at, :utc_datetime_usec
      field :created_at, :utc_datetime_usec
    end

    @required_fields [:id, :product, :channel, :recipient, :template, :status, :created_at]
    @optional_fields [:data, :attempts, :last_attempted_at, :delivered_at]

    @valid_channels ~w(email sms in_app push webhook)
    @valid_statuses ~w(pending sending delivered failed)

    def changeset(notification, attrs) do
      notification
      |> cast(attrs, @required_fields ++ @optional_fields)
      |> validate_required(@required_fields)
      |> validate_inclusion(:channel, @valid_channels)
      |> validate_inclusion(:status, @valid_statuses)
    end
  end
end
