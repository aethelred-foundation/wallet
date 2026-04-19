defmodule ApprovalRouter.Escalation do
  @moduledoc """
  Manages escalation timers for approval requests.

  Uses `Process.send_after/3` for timeout-based escalation. When an approval request
  has `escalation_timeout_minutes` configured, a timer is set. On timeout, the request's
  escalation level is incremented and a notification is sent. If max escalation level
  is reached, the request is auto-rejected.
  """

  use GenServer
  require Logger

  alias ApprovalRouter.Schemas.ApprovalRequest
  alias AeShared.Repo

  # --- Public API ---

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Schedules an escalation timer for the given approval request.
  """
  def schedule_escalation(%ApprovalRequest{} = request) do
    if request.escalation_timeout_minutes && request.escalation_timeout_minutes > 0 do
      GenServer.cast(__MODULE__, {:schedule, request.id, request.escalation_timeout_minutes})
    end
  end

  @doc """
  Cancels any pending escalation for the given request ID.
  """
  def cancel_escalation(request_id) do
    GenServer.cast(__MODULE__, {:cancel, request_id})
  end

  # --- Callbacks ---

  @impl true
  def init(_opts) do
    {:ok, %{timers: %{}}}
  end

  @impl true
  def handle_cast({:schedule, request_id, timeout_minutes}, state) do
    # Cancel existing timer if any
    state = cancel_timer(state, request_id)

    delay_ms = timeout_minutes * 60 * 1_000
    timer_ref = Process.send_after(self(), {:escalate, request_id}, delay_ms)

    Logger.info("Escalation timer set for request #{request_id}: #{timeout_minutes} minutes")
    {:noreply, put_in(state, [:timers, request_id], timer_ref)}
  end

  def handle_cast({:cancel, request_id}, state) do
    {:noreply, cancel_timer(state, request_id)}
  end

  @impl true
  def handle_info({:escalate, request_id}, state) do
    state = %{state | timers: Map.delete(state.timers, request_id)}
    perform_escalation(request_id)
    {:noreply, state}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  # --- Internal ---

  defp cancel_timer(state, request_id) do
    case Map.get(state.timers, request_id) do
      nil ->
        state

      timer_ref ->
        Process.cancel_timer(timer_ref)
        %{state | timers: Map.delete(state.timers, request_id)}
    end
  end

  defp perform_escalation(request_id) do
    case Repo.get(ApprovalRequest, request_id) do
      nil ->
        Logger.warning("Escalation target not found: #{request_id}")

      %{status: status} when status != "pending" ->
        Logger.debug("Skipping escalation for resolved request #{request_id}")

      request ->
        new_level = request.escalation_current_level + 1
        max_level = request.escalation_max || 3

        if new_level > max_level do
          # Max escalation reached — auto-reject
          request
          |> Ecto.Changeset.change(%{
            status: "rejected",
            resolved_at: DateTime.utc_now(),
            escalation_current_level: new_level
          })
          |> Repo.update()

          Logger.warning("Request #{request_id} auto-rejected after max escalation (level #{new_level})")

          NotificationHub.send_notification(%{
            product: "platform",
            channel: "in_app",
            recipient: request.requester_id,
            template: "approval_auto_rejected",
            data: %{request_id: request_id, title: request.title, reason: "max_escalation_reached"}
          })
        else
          # Escalate: increment level, re-arm timer, notify
          request
          |> Ecto.Changeset.change(%{escalation_current_level: new_level})
          |> Repo.update()

          Logger.info("Request #{request_id} escalated to level #{new_level}")

          # Re-arm the timer for the next escalation window
          if request.escalation_timeout_minutes do
            schedule_escalation(%{request | escalation_current_level: new_level})
          end

          NotificationHub.send_notification(%{
            product: "platform",
            channel: "in_app",
            recipient: request.requester_id,
            template: "approval_escalated",
            data: %{request_id: request_id, title: request.title, escalation_level: new_level}
          })
        end
    end
  end
end
