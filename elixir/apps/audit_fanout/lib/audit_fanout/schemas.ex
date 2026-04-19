defmodule AuditFanout.Schemas do
  @moduledoc """
  Ecto schema for `audit_events` table, matching the TypeScript AuditEvent type
  from `wallet/packages/audit/src/types.ts` exactly.
  """

  defmodule AuditEvent do
    @moduledoc """
    A single tamper-evident audit event in the hash chain.

    Fields mirror the TS type:
    - id, sequence_number, timestamp, kind
    - subject_id, workspace_id, app_id, session_id, intent_id
    - detail, previous_hash, event_hash
    """

    use Ecto.Schema
    import Ecto.Changeset

    @primary_key {:id, :string, autogenerate: false}
    schema "audit_events" do
      field :sequence_number, :integer
      field :timestamp, :integer
      field :kind, :string
      field :subject_id, :string
      field :workspace_id, :string
      field :app_id, :string
      field :session_id, :string
      field :intent_id, :string
      field :detail, :map, default: %{}
      field :previous_hash, :string
      field :event_hash, :string
    end

    @required_fields [:id, :sequence_number, :timestamp, :kind, :subject_id, :workspace_id, :previous_hash, :event_hash]
    @optional_fields [:app_id, :session_id, :intent_id, :detail]

    def changeset(event, attrs) do
      event
      |> cast(attrs, @required_fields ++ @optional_fields)
      |> validate_required(@required_fields)
      |> unique_constraint(:sequence_number)
    end
  end

  defmodule ExportPackage do
    @moduledoc """
    Evidence export package structure matching the TS ExportPackage type.
    Not persisted to DB — this is a transient struct for export operations.
    """

    defstruct [
      :export_id,
      :subject_id,
      :workspace_id,
      :chain_start_sequence,
      :chain_end_sequence,
      :integrity_hash,
      :exported_at,
      :event_count,
      :events,
      :format
    ]

    @type t :: %__MODULE__{
            export_id: String.t(),
            subject_id: String.t(),
            workspace_id: String.t() | nil,
            chain_start_sequence: integer(),
            chain_end_sequence: integer(),
            integrity_hash: String.t(),
            exported_at: DateTime.t(),
            event_count: non_neg_integer(),
            events: [map()],
            format: :json | :csv
          }
  end
end
