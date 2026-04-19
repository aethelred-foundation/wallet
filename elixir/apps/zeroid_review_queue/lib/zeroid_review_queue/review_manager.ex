defmodule ZeroidReviewQueue.ReviewManager do
  @moduledoc """
  GenServer that subscribes to ZeroID workflow transition events via PubSub
  and automatically creates review cases when identity exceptions, revocation
  failures, or verification anomalies occur.
  """

  use GenServer
  require Logger

  alias ZeroidReviewQueue.Schemas.ReviewCase

  # --- Client API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Server Callbacks ---

  @impl true
  def init(_opts) do
    Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "workflow:zeroid")
    Logger.info("ZeroidReviewQueue.ReviewManager started, subscribed to workflow:zeroid")
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

  defp maybe_create_case(%{event: :validation_failed, workflow_type: :credential_issuance} = t, state) do
    create_case_from_transition(t, :issuance_exception, "zeroid_issuance_review", :high, state)
  end

  defp maybe_create_case(%{event: :signing_failed, workflow_type: :credential_issuance} = t, state) do
    create_case_from_transition(t, :issuance_exception, "zeroid_issuance_review", :critical, state)
  end

  defp maybe_create_case(%{event: :propagation_failed, workflow_type: :credential_revocation} = t, state) do
    create_case_from_transition(t, :revocation_exception, "zeroid_revocation_review", :high, state)
  end

  defp maybe_create_case(%{event: :anomaly_found, workflow_type: :verification_handling} = t, state) do
    create_case_from_transition(t, :verification_anomaly, "zeroid_verification_review", :medium, state)
  end

  defp maybe_create_case(_transition, state), do: state

  defp create_case_from_transition(transition, case_type, queue_name, priority, state) do
    priority_value = priority_to_int(priority)

    case_attrs = %{
      id: generate_id(),
      product: "zeroid",
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
      },
      created_at: DateTime.utc_now(),
      updated_at: DateTime.utc_now()
    }

    case ZeroidReviewQueue.create_case(case_attrs) do
      {:ok, review_case} ->
        Logger.info(
          "ReviewManager created #{case_type} case #{review_case.id} for entity #{transition.entity_id}"
        )

        broadcast_case_created(review_case)
        %{state | cases_created: state.cases_created + 1}

      {:error, changeset} ->
        Logger.error(
          "ReviewManager failed to create case for entity #{transition.entity_id}: #{inspect(changeset.errors)}"
        )

        state
    end
  end

  defp priority_to_int(:critical), do: 100
  defp priority_to_int(:high), do: 75
  defp priority_to_int(:medium), do: 50
  defp priority_to_int(:low), do: 25
  defp priority_to_int(_), do: 0

  defp broadcast_case_created(%ReviewCase{} = review_case) do
    Phoenix.PubSub.broadcast(
      AethelredPlatform.PubSub,
      "reviews:zeroid",
      {:case_created, %{
        case_id: review_case.id,
        case_type: review_case.case_type,
        entity_id: review_case.entity_id,
        priority: review_case.priority,
        queue_name: review_case.queue_name,
        timestamp: DateTime.utc_now()
      }}
    )
  end

  defp generate_id do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end
end
