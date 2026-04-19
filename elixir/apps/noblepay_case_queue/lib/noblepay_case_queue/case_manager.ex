defmodule NoblepayCaseQueue.CaseManager do
  @moduledoc """
  GenServer that subscribes to NoblePay workflow transition events via PubSub
  and automatically creates compliance cases when payments are flagged or
  other review-worthy events occur.
  """

  use GenServer
  require Logger

  alias NoblepayCaseQueue.Schemas.Case

  # --- Client API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Server Callbacks ---

  @impl true
  def init(_opts) do
    Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "workflow:noblepay")
    Logger.info("NoblepayCaseQueue.CaseManager started, subscribed to workflow:noblepay")
    {:ok, %{cases_created: 0}}
  end

  @impl true
  def handle_info({:workflow_transition, transition}, state) do
    state = maybe_create_case(transition, state)
    {:noreply, state}
  end

  @impl true
  def handle_info(_msg, state), do: {:noreply, state}

  # --- Private ---

  defp maybe_create_case(%{event: :flagged, workflow_type: :payment_lifecycle} = t, state) do
    create_case_from_transition(t, :compliance_review, "noblepay_compliance", :high, state)
  end

  defp maybe_create_case(%{event: :settlement_failed, workflow_type: :payment_lifecycle} = t, state) do
    create_case_from_transition(t, :payment_exception, "noblepay_exceptions", :medium, state)
  end

  defp maybe_create_case(%{event: :execution_failed, workflow_type: :treasury_action} = t, state) do
    create_case_from_transition(t, :treasury_review, "noblepay_treasury", :high, state)
  end

  defp maybe_create_case(%{event: :escalated, workflow_type: :compliance_review} = t, state) do
    create_case_from_transition(t, :compliance_review, "noblepay_escalations", :critical, state)
  end

  defp maybe_create_case(_transition, state), do: state

  defp create_case_from_transition(transition, case_type, queue_name, priority, state) do
    priority_value = priority_to_int(priority)

    case_attrs = %{
      queue_name: queue_name,
      case_type: to_string(case_type),
      entity_id: transition.entity_id,
      priority: priority_value,
      context: %{
        "workflow_type" => to_string(transition.workflow_type),
        "triggering_event" => to_string(transition.event),
        "from_state" => to_string(transition.from),
        "to_state" => to_string(transition.to),
        "workflow_context" => transition.context
      }
    }

    case NoblepayCaseQueue.create_case(Map.merge(case_attrs, %{
      id: generate_id(),
      product: "noblepay",
      created_at: DateTime.utc_now(),
      updated_at: DateTime.utc_now()
    })) do
      {:ok, kase} ->
        Logger.info(
          "CaseManager created #{case_type} case #{kase.id} for entity #{transition.entity_id}"
        )

        broadcast_case_created(kase)
        %{state | cases_created: state.cases_created + 1}

      {:error, changeset} ->
        Logger.error(
          "CaseManager failed to create case for entity #{transition.entity_id}: #{inspect(changeset.errors)}"
        )

        state
    end
  end

  defp priority_to_int(:critical), do: 100
  defp priority_to_int(:high), do: 75
  defp priority_to_int(:medium), do: 50
  defp priority_to_int(:low), do: 25
  defp priority_to_int(_), do: 0

  defp broadcast_case_created(%Case{} = kase) do
    Phoenix.PubSub.broadcast(
      AethelredPlatform.PubSub,
      "cases:noblepay",
      {:case_created, %{
        case_id: kase.id,
        case_type: kase.case_type,
        entity_id: kase.entity_id,
        priority: kase.priority,
        queue_name: kase.queue_name,
        timestamp: DateTime.utc_now()
      }}
    )
  end

  defp generate_id do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end
end
