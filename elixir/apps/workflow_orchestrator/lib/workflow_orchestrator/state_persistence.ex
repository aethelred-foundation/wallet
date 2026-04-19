defmodule WorkflowOrchestrator.StatePersistence do
  @moduledoc """
  Ecto-backed persistence for workflow state.
  Stores workflow instances and transition history in PostgreSQL.
  """

  alias AeShared.Repo
  import Ecto.Query

  # --- Schemas ---

  defmodule WorkflowInstance do
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key {:id, :string, autogenerate: false}
    schema "workflow_instances" do
      field :workflow_type, :string
      field :product, :string
      field :entity_id, :string
      field :current_state, :string
      field :context, :map, default: %{}
      field :started_at, :utc_datetime_usec
      field :updated_at, :utc_datetime_usec
      field :completed_at, :utc_datetime_usec
    end

    def changeset(instance, attrs) do
      instance
      |> cast(attrs, [:id, :workflow_type, :product, :entity_id, :current_state, :context, :started_at, :updated_at, :completed_at])
      |> validate_required([:id, :workflow_type, :product, :entity_id, :current_state, :started_at, :updated_at])
    end
  end

  defmodule WorkflowTransition do
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key {:id, :string, autogenerate: false}
    schema "workflow_transitions" do
      field :workflow_instance_id, :string
      field :from_state, :string
      field :to_state, :string
      field :event, :string
      field :context_snapshot, :map, default: %{}
      field :transitioned_at, :utc_datetime_usec
    end

    def changeset(transition, attrs) do
      transition
      |> cast(attrs, [:id, :workflow_instance_id, :from_state, :to_state, :event, :context_snapshot, :transitioned_at])
      |> validate_required([:id, :workflow_instance_id, :from_state, :to_state, :event, :transitioned_at])
    end
  end

  # --- Public API ---

  def persist_new(state) do
    now = DateTime.utc_now()
    id = generate_id()

    %WorkflowInstance{}
    |> WorkflowInstance.changeset(%{
      id: id,
      workflow_type: Atom.to_string(state.workflow_module.workflow_type()),
      product: Atom.to_string(state.workflow_module.product()),
      entity_id: state.entity_id,
      current_state: Atom.to_string(state.current_state),
      context: state.context,
      started_at: now,
      updated_at: now
    })
    |> Repo.insert()
    |> case do
      {:ok, _} -> :ok
      {:error, changeset} -> {:error, changeset}
    end
  end

  def persist_transition(state, from_state, event) do
    now = DateTime.utc_now()

    Ecto.Multi.new()
    |> Ecto.Multi.update_all(:update_instance, fn _ ->
      from(w in WorkflowInstance,
        where: w.entity_id == ^state.entity_id and
               w.workflow_type == ^Atom.to_string(state.workflow_module.workflow_type()),
        update: [
          set: [
            current_state: ^Atom.to_string(state.current_state),
            context: ^state.context,
            updated_at: ^now
          ]
        ]
      )
    end, [])
    |> Ecto.Multi.insert(:transition, fn _ ->
      WorkflowTransition.changeset(%WorkflowTransition{}, %{
        id: generate_id(),
        workflow_instance_id: state.entity_id,
        from_state: Atom.to_string(from_state),
        to_state: Atom.to_string(state.current_state),
        event: Atom.to_string(event),
        context_snapshot: state.context,
        transitioned_at: now
      })
    end)
    |> Repo.transaction()
    |> case do
      {:ok, _} -> :ok
      {:error, _, changeset, _} -> {:error, changeset}
    end
  end

  def load(workflow_module, entity_id) do
    wtype = Atom.to_string(workflow_module.workflow_type())

    case Repo.one(
           from(w in WorkflowInstance,
             where: w.entity_id == ^entity_id and w.workflow_type == ^wtype
           )
         ) do
      nil ->
        {:error, :not_found}

      instance ->
        {:ok,
         %{
           current_state: String.to_existing_atom(instance.current_state),
           context: instance.context,
           started_at: instance.started_at
         }}
    end
  end

  def get_transition_history(entity_id) do
    from(t in WorkflowTransition,
      where: t.workflow_instance_id == ^entity_id,
      order_by: [asc: t.transitioned_at]
    )
    |> Repo.all()
  end

  defp generate_id do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end
end
