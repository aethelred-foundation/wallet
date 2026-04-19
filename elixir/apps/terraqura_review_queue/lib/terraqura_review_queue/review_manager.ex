defmodule TerraquraReviewQueue.ReviewManager do
  @moduledoc """
  GenServer that manages the in-memory review case queue.

  Listens for failed verification and anomaly events via PubSub
  and automatically creates review cases.
  """

  use GenServer

  require Logger

  @pubsub AethelredPlatform.PubSub
  @verification_topic "terraqura:verification"
  @alerts_topic "terraqura:alerts"

  # --- Client API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Tracks a new review case in the queue."
  def track_case(review_case) do
    GenServer.call(__MODULE__, {:track_case, review_case})
  end

  @doc "Updates fields on an existing case."
  def update_case(case_id, updates) do
    GenServer.call(__MODULE__, {:update_case, case_id, updates})
  end

  @doc "Lists cases by status, optionally filtered by case type."
  def list_cases(status, case_type \\ nil) do
    GenServer.call(__MODULE__, {:list_cases, status, case_type})
  end

  @doc "Returns a single case by ID."
  def get_case(case_id) do
    GenServer.call(__MODULE__, {:get_case, case_id})
  end

  # --- Server Callbacks ---

  @impl true
  def init(_opts) do
    subscribe_to_events()
    {:ok, %{cases: %{}}}
  end

  @impl true
  def handle_call({:track_case, review_case}, _from, state) do
    new_cases = Map.put(state.cases, review_case.id, review_case)
    Logger.info("Review case created: #{review_case.id} (#{review_case.case_type})")
    {:reply, :ok, %{state | cases: new_cases}}
  end

  def handle_call({:update_case, case_id, updates}, _from, state) do
    case Map.get(state.cases, case_id) do
      nil ->
        {:reply, {:error, :not_found}, state}

      existing ->
        updated = Map.merge(existing, updates)
        new_cases = Map.put(state.cases, case_id, updated)
        {:reply, {:ok, updated}, %{state | cases: new_cases}}
    end
  end

  def handle_call({:list_cases, status, nil}, _from, state) do
    result =
      state.cases
      |> Map.values()
      |> Enum.filter(&(&1.status == status))

    {:reply, result, state}
  end

  def handle_call({:list_cases, status, case_type}, _from, state) do
    result =
      state.cases
      |> Map.values()
      |> Enum.filter(&(&1.status == status and &1.case_type == case_type))

    {:reply, result, state}
  end

  def handle_call({:get_case, case_id}, _from, state) do
    case Map.get(state.cases, case_id) do
      nil -> {:reply, {:error, :not_found}, state}
      review_case -> {:reply, {:ok, review_case}, state}
    end
  end

  @impl true
  def handle_info({:verification_failed, event_data}, state) do
    {:ok, _case} =
      TerraquraReviewQueue.create_case(
        :failed_verification,
        Map.get(event_data, :batch_id, "unknown"),
        event_data,
        priority: :high
      )

    {:noreply, state}
  end

  def handle_info({:anomaly_detected, event_data}, state) do
    priority =
      case Map.get(event_data, :severity) do
        :critical -> :critical
        :high -> :high
        _ -> :medium
      end

    {:ok, _case} =
      TerraquraReviewQueue.create_case(
        :anomaly_review,
        Map.get(event_data, :dac_unit_id, "unknown"),
        event_data,
        priority: priority
      )

    {:noreply, state}
  end

  def handle_info({:mint_failed, event_data}, state) do
    {:ok, _case} =
      TerraquraReviewQueue.create_case(
        :mint_exception,
        Map.get(event_data, :batch_id, "unknown"),
        event_data,
        priority: :high
      )

    {:noreply, state}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  # --- Private ---

  defp subscribe_to_events do
    if Code.ensure_loaded?(Phoenix.PubSub) do
      Phoenix.PubSub.subscribe(@pubsub, @verification_topic)
      Phoenix.PubSub.subscribe(@pubsub, @alerts_topic)
    end
  end
end
