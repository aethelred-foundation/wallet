defmodule CruzibleIncidentQueue.IncidentManager do
  @moduledoc """
  GenServer that subscribes to critical Cruzible alert events and automatically
  creates incident workflows when critical-severity alerts are raised.

  Tracks incident lifecycle and broadcasts state changes for the ops dashboard.
  """

  use GenServer
  require Logger

  # --- Client API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Server Callbacks ---

  @impl true
  def init(_opts) do
    Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "cruzible:incidents")
    Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, "cruzible:alerts")
    Logger.info("CruzibleIncidentQueue.IncidentManager started, subscribed to cruzible:incidents and cruzible:alerts")
    {:ok, %{incidents_created: 0, active_incidents: %{}}}
  end

  @impl true
  def handle_info({:critical_alert, alert_data}, state) do
    state = create_incident_from_alert(alert_data, state)
    {:noreply, state}
  end

  @impl true
  def handle_info({:alert_created, %{severity: "critical"} = alert_data}, state) do
    state = create_incident_from_alert(alert_data, state)
    {:noreply, state}
  end

  @impl true
  def handle_info({:workflow_transition, %{workflow_type: :incident} = transition}, state) do
    state = track_incident_transition(transition, state)
    {:noreply, state}
  end

  @impl true
  def handle_info(_msg, state), do: {:noreply, state}

  # --- Private ---

  defp create_incident_from_alert(alert_data, state) do
    incident_id = generate_incident_id()

    context = %{
      source_alert_id: Map.get(alert_data, :alert_id),
      alert_type: Map.get(alert_data, :alert_type),
      entity_id: Map.get(alert_data, :entity_id),
      severity: Map.get(alert_data, :severity, "critical"),
      created_at: DateTime.utc_now(),
      alert_context: Map.get(alert_data, :context, %{})
    }

    case CruzibleIncidentQueue.create_incident(incident_id, context) do
      {:ok, _pid} ->
        Logger.info("IncidentManager created incident #{incident_id} from alert #{context.source_alert_id}")

        broadcast_incident_created(incident_id, context)

        state
        |> put_in([:active_incidents, incident_id], context)
        |> Map.update!(:incidents_created, &(&1 + 1))

      {:error, reason} ->
        Logger.error("IncidentManager failed to create incident: #{inspect(reason)}")
        state
    end
  end

  defp track_incident_transition(transition, state) do
    incident_id = transition.entity_id

    case transition.to do
      :resolved ->
        Logger.info("Incident #{incident_id} resolved")
        update_in(state, [:active_incidents], &Map.delete(&1, incident_id))

      new_state ->
        Logger.info("Incident #{incident_id} transitioned to #{new_state}")

        if Map.has_key?(state.active_incidents, incident_id) do
          update_in(state, [:active_incidents, incident_id], fn ctx ->
            Map.put(ctx || %{}, :current_state, new_state)
          end)
        else
          state
        end
    end
  end

  defp broadcast_incident_created(incident_id, context) do
    Phoenix.PubSub.broadcast(
      AethelredPlatform.PubSub,
      "cruzible:incidents",
      {:incident_created, %{
        incident_id: incident_id,
        alert_type: context.alert_type,
        entity_id: context.entity_id,
        severity: context.severity,
        timestamp: DateTime.utc_now()
      }}
    )
  end

  defp generate_incident_id do
    "INC-" <> (:crypto.strong_rand_bytes(8) |> Base.url_encode64(padding: false))
  end
end
