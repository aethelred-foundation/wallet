defmodule CruzibleIncidentQueue do
  @moduledoc """
  Facade for creating and managing Cruzible operational incidents.

  Incidents are created from critical alerts and tracked through the
  IncidentWorkflow state machine via WorkflowOrchestrator.
  """

  alias CruzibleIncidentQueue.IncidentWorkflow

  @type workflow_ref :: {module(), String.t()}

  @doc "Create a new incident from a critical alert."
  @spec create_incident(String.t(), map()) :: {:ok, pid()} | {:error, term()}
  def create_incident(incident_id, context \\ %{}) do
    WorkflowOrchestrator.start_workflow(IncidentWorkflow, incident_id, context)
  end

  @doc "Send an event to an incident workflow."
  @spec send_event(String.t(), atom(), map()) :: {:ok, map()} | {:error, term()}
  def send_event(incident_id, event, payload \\ %{}) do
    WorkflowOrchestrator.send_event(IncidentWorkflow, incident_id, event, payload)
  end

  @doc "Acknowledge an incident."
  @spec acknowledge(String.t(), map()) :: {:ok, map()} | {:error, term()}
  def acknowledge(incident_id, payload \\ %{}) do
    send_event(incident_id, :acknowledged, payload)
  end

  @doc "Escalate an incident."
  @spec escalate(String.t(), map()) :: {:ok, map()} | {:error, term()}
  def escalate(incident_id, payload \\ %{}) do
    send_event(incident_id, :escalated, payload)
  end

  @doc "Mark an incident as mitigated."
  @spec mitigate(String.t(), map()) :: {:ok, map()} | {:error, term()}
  def mitigate(incident_id, payload \\ %{}) do
    send_event(incident_id, :mitigated, payload)
  end

  @doc "Resolve an incident."
  @spec resolve(String.t(), map()) :: {:ok, map()} | {:error, term()}
  def resolve(incident_id, payload \\ %{}) do
    send_event(incident_id, :resolved, payload)
  end

  @doc "Get the current state of an incident."
  @spec get_state(String.t()) :: {:ok, map()} | {:error, term()}
  def get_state(incident_id) do
    WorkflowOrchestrator.get_state(IncidentWorkflow, incident_id)
  end

  @doc "List all active incidents."
  @spec list_active() :: [workflow_ref()]
  def list_active do
    WorkflowOrchestrator.list_active(IncidentWorkflow)
  end
end
