defmodule WorkflowOrchestrator.WorkflowServer do
  @moduledoc """
  GenServer managing a single workflow instance.

  Each workflow instance is a supervised process that:
  - Loads persisted state on startup
  - Validates transitions against the workflow definition
  - Persists state changes in a single Ecto transaction
  - Broadcasts transitions via PubSub
  - Manages escalation timers via Process.send_after/3
  """

  use GenServer
  require Logger

  alias WorkflowOrchestrator.StatePersistence

  defstruct [
    :workflow_module,
    :entity_id,
    :current_state,
    :context,
    :started_at,
    :timer_ref
  ]

  # --- Client API ---

  def start_link({workflow_module, entity_id, initial_context, opts}) do
    name = via_tuple(workflow_module, entity_id)
    GenServer.start_link(__MODULE__, {workflow_module, entity_id, initial_context, opts}, name: name)
  end

  def send_event(workflow_module, entity_id, event, payload \\ %{}) do
    name = via_tuple(workflow_module, entity_id)
    GenServer.call(name, {:event, event, payload})
  end

  def get_state(workflow_module, entity_id) do
    name = via_tuple(workflow_module, entity_id)
    GenServer.call(name, :get_state)
  end

  # --- Server Callbacks ---

  @impl true
  def init({workflow_module, entity_id, initial_context, opts}) do
    case Keyword.get(opts, :restore, false) do
      true ->
        restore_from_db(workflow_module, entity_id)

      false ->
        state = %__MODULE__{
          workflow_module: workflow_module,
          entity_id: entity_id,
          current_state: workflow_module.initial_state(),
          context: initial_context,
          started_at: DateTime.utc_now(),
          timer_ref: nil
        }

        :ok = StatePersistence.persist_new(state)
        context = workflow_module.on_enter(state.current_state, state.context)
        state = %{state | context: context}
        state = schedule_timeout(state)

        broadcast_transition(state, nil, state.current_state, :workflow_started)

        {:ok, state}
    end
  end

  @impl true
  def handle_call({:event, event, payload}, _from, state) do
    context_with_payload = Map.merge(state.context, %{event_payload: payload})

    case find_transition(state.workflow_module, state.current_state, event, context_with_payload) do
      {:ok, transition} ->
        cancel_timeout(state)
        context = state.workflow_module.on_exit(state.current_state, context_with_payload)
        new_context = state.workflow_module.on_enter(transition.to, context)
        new_context = Map.delete(new_context, :event_payload)

        new_state = %{state |
          current_state: transition.to,
          context: new_context,
          timer_ref: nil
        }

        :ok = StatePersistence.persist_transition(new_state, state.current_state, event)
        new_state = schedule_timeout(new_state)

        broadcast_transition(new_state, state.current_state, transition.to, event)

        {:reply, {:ok, %{state: transition.to, context: new_context}}, new_state}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_call(:get_state, _from, state) do
    reply = %{
      workflow_module: state.workflow_module,
      entity_id: state.entity_id,
      current_state: state.current_state,
      context: state.context,
      started_at: state.started_at
    }

    {:reply, {:ok, reply}, state}
  end

  @impl true
  def handle_info(:timeout_escalation, state) do
    case state.workflow_module.timeout_config(state.current_state) do
      %{escalation_event: event} ->
        Logger.info("Timeout escalation for #{state.entity_id} in state #{state.current_state}")
        {:noreply, state} |> tap(fn _ ->
          send_event(state.workflow_module, state.entity_id, event, %{reason: :timeout})
        end)

      _ ->
        {:noreply, state}
    end
  end

  @impl true
  def handle_info(_msg, state), do: {:noreply, state}

  # --- Private ---

  defp find_transition(workflow_module, current_state, event, context) do
    workflow_module.transitions()
    |> Enum.find(fn t -> t.from == current_state and t.event == event end)
    |> case do
      nil ->
        {:error, {:invalid_transition, current_state, event}}

      %{guard: nil} = t ->
        {:ok, t}

      %{guard: guard} = t when is_function(guard, 1) ->
        if guard.(context), do: {:ok, t}, else: {:error, {:guard_failed, current_state, event}}
    end
  end

  defp schedule_timeout(%{workflow_module: mod, current_state: current} = state) do
    case mod.timeout_config(current) do
      %{timeout_ms: ms} when is_integer(ms) and ms > 0 ->
        ref = Process.send_after(self(), :timeout_escalation, ms)
        %{state | timer_ref: ref}

      _ ->
        state
    end
  end

  defp cancel_timeout(%{timer_ref: nil}), do: :ok
  defp cancel_timeout(%{timer_ref: ref}), do: Process.cancel_timer(ref)

  defp broadcast_transition(state, from, to, event) do
    Phoenix.PubSub.broadcast(
      AethelredPlatform.PubSub,
      "workflow:#{state.workflow_module.product()}",
      {:workflow_transition, %{
        workflow_type: state.workflow_module.workflow_type(),
        entity_id: state.entity_id,
        from: from,
        to: to,
        event: event,
        context: state.context,
        timestamp: DateTime.utc_now()
      }}
    )
  end

  defp restore_from_db(workflow_module, entity_id) do
    case StatePersistence.load(workflow_module, entity_id) do
      {:ok, persisted} ->
        state = %__MODULE__{
          workflow_module: workflow_module,
          entity_id: entity_id,
          current_state: persisted.current_state,
          context: persisted.context,
          started_at: persisted.started_at,
          timer_ref: nil
        }

        state = schedule_timeout(state)
        {:ok, state}

      {:error, :not_found} ->
        {:stop, :workflow_not_found}
    end
  end

  defp via_tuple(workflow_module, entity_id) do
    {:via, Registry, {WorkflowOrchestrator.WorkflowRegistry.Registry, {workflow_module, entity_id}}}
  end
end
