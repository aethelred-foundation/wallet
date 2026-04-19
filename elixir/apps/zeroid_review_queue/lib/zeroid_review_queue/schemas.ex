defmodule ZeroidReviewQueue.Schemas.ReviewCase do
  @moduledoc """
  Ecto schema for the zeroid_review_queue table.

  Represents an identity issuance exception, revocation exception,
  verification anomaly, or manual review case requiring human action.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :string, autogenerate: false}
  @timestamps_opts false

  schema "zeroid_review_queue" do
    field :product, :string
    field :queue_name, :string
    field :case_type, :string
    field :entity_id, :string
    field :status, :string, default: "pending"
    field :assigned_to, :string
    field :priority, :integer, default: 0
    field :escalation_level, :integer, default: 0
    field :context, :map, default: %{}
    field :created_at, :utc_datetime_usec
    field :updated_at, :utc_datetime_usec
    field :resolved_at, :utc_datetime_usec
  end

  @required_fields [:id, :product, :queue_name, :case_type, :entity_id, :created_at, :updated_at]
  @optional_fields [:status, :assigned_to, :priority, :escalation_level, :context, :resolved_at]

  @valid_case_types ~w(issuance_exception revocation_exception verification_anomaly manual_review)
  @valid_statuses ~w(pending assigned in_review escalated resolved)

  @type t :: %__MODULE__{}

  @doc "Build a changeset for creating or updating a review case."
  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(review_case, attrs) do
    review_case
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:case_type, @valid_case_types)
    |> validate_inclusion(:status, @valid_statuses)
    |> validate_number(:priority, greater_than_or_equal_to: 0)
    |> validate_number(:escalation_level, greater_than_or_equal_to: 0)
  end
end
