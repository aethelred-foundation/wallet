defmodule ApprovalRouter.Schemas do
  @moduledoc """
  Ecto schemas for `approval_requests` and `approval_decisions` tables.
  Mirrors the TypeScript types from `wallet/packages/approval/src/types.ts`.
  """

  defmodule ApprovalRequest do
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key {:id, :string, autogenerate: false}
    schema "approval_requests" do
      field :title, :string
      field :summary, :string
      field :workspace_id, :string
      field :requester_id, :string
      field :app_id, :string
      field :intent_id, :string
      field :intent_kind, :string
      field :quorum_type, :string
      field :quorum_threshold, :integer
      field :quorum_total, :integer
      field :status, :string, default: "pending"
      field :escalation_trigger, :string
      field :escalation_timeout_minutes, :integer
      field :escalation_max, :integer, default: 3
      field :escalation_current_level, :integer, default: 0
      field :context, :map, default: %{}
      field :created_at, :utc_datetime_usec
      field :expires_at, :utc_datetime_usec
      field :resolved_at, :utc_datetime_usec

      has_many :decisions, ApprovalRouter.Schemas.ApprovalDecision,
        foreign_key: :approval_request_id
    end

    @required_fields [
      :id, :title, :workspace_id, :requester_id, :app_id,
      :intent_id, :intent_kind, :quorum_type, :status, :created_at, :expires_at
    ]

    @optional_fields [
      :summary, :quorum_threshold, :quorum_total, :escalation_trigger,
      :escalation_timeout_minutes, :escalation_max, :escalation_current_level,
      :context, :resolved_at
    ]

    @valid_quorum_types ~w(any_one majority unanimous threshold sequential)
    @valid_statuses ~w(pending approved rejected expired escalated)

    def changeset(request, attrs) do
      request
      |> cast(attrs, @required_fields ++ @optional_fields)
      |> validate_required(@required_fields)
      |> validate_inclusion(:quorum_type, @valid_quorum_types)
      |> validate_inclusion(:status, @valid_statuses)
      |> validate_number(:quorum_threshold, greater_than: 0)
      |> validate_number(:quorum_total, greater_than: 0)
    end
  end

  defmodule ApprovalDecision do
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key {:id, :string, autogenerate: false}
    schema "approval_decisions" do
      field :approval_request_id, :string
      field :reviewer_id, :string
      field :reviewer_name, :string
      field :decision, :string
      field :reason, :string
      field :decided_at, :utc_datetime_usec
    end

    @required_fields [:id, :approval_request_id, :reviewer_id, :reviewer_name, :decision, :decided_at]
    @optional_fields [:reason]

    @valid_decisions ~w(approved rejected)

    def changeset(decision, attrs) do
      decision
      |> cast(attrs, @required_fields ++ @optional_fields)
      |> validate_required(@required_fields)
      |> validate_inclusion(:decision, @valid_decisions)
    end
  end
end
