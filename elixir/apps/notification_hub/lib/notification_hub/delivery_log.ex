defmodule NotificationHub.DeliveryLog do
  @moduledoc """
  Tracks delivery attempts and outcomes for notifications.

  Provides an in-memory log (backed by ETS) for fast delivery attempt tracking.
  In production, this could be extended to persist to a dedicated table.
  """

  require Logger

  @table :notification_delivery_log

  @doc """
  Initializes the ETS table for delivery logging.
  Called during application startup.
  """
  def init do
    if :ets.whereis(@table) == :undefined do
      :ets.new(@table, [:named_table, :bag, :public, read_concurrency: true])
    end

    :ok
  end

  @doc """
  Records a delivery attempt.
  """
  def record(notification_id, attempt, outcome, channel, error_detail \\ nil) do
    ensure_table()

    entry = %{
      notification_id: notification_id,
      attempt: attempt,
      outcome: outcome,
      channel: channel,
      error_detail: error_detail,
      timestamp: DateTime.utc_now()
    }

    :ets.insert(@table, {notification_id, entry})

    Logger.debug(
      "Delivery log: #{notification_id} attempt=#{attempt} outcome=#{outcome} channel=#{channel}"
    )

    :ok
  end

  @doc """
  Returns all delivery attempts for a notification.
  """
  def get_history(notification_id) do
    ensure_table()

    @table
    |> :ets.lookup(notification_id)
    |> Enum.map(fn {_id, entry} -> entry end)
    |> Enum.sort_by(& &1.attempt)
  end

  defp ensure_table do
    if :ets.whereis(@table) == :undefined do
      init()
    end
  end
end
