defmodule NotificationHub.Dispatcher do
  @moduledoc """
  Oban worker that dispatches notifications to their configured delivery channels.

  Loads the notification from the database, dispatches to the correct channel
  adapter, and updates delivery status. Supports up to 5 retry attempts with
  exponential backoff.
  """

  use Oban.Worker, queue: :notifications, max_attempts: 5

  alias NotificationHub.Schemas.Notification
  alias NotificationHub.DeliveryLog
  alias AeShared.Repo
  require Logger

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"notification_id" => id}, attempt: attempt}) do
    case Repo.get(Notification, id) do
      nil ->
        Logger.warning("Notification #{id} not found, discarding job")
        :ok

      %{status: "delivered"} ->
        Logger.debug("Notification #{id} already delivered, skipping")
        :ok

      notification ->
        dispatch_to_channel(notification, attempt)
    end
  end

  defp dispatch_to_channel(notification, attempt) do
    now = DateTime.utc_now()
    channel = notification.channel

    # Update attempt tracking
    notification
    |> Ecto.Changeset.change(%{
      attempts: attempt,
      last_attempted_at: now,
      status: "sending"
    })
    |> Repo.update!()

    # Dispatch to channel adapter
    result =
      case channel do
        "email" -> dispatch_email(notification)
        "sms" -> dispatch_sms(notification)
        "in_app" -> dispatch_in_app(notification)
        "push" -> dispatch_push(notification)
        "webhook" -> dispatch_webhook(notification)
        _ -> {:error, "unsupported_channel: #{channel}"}
      end

    # Record delivery outcome
    case result do
      :ok ->
        notification
        |> Ecto.Changeset.change(%{status: "delivered", delivered_at: now})
        |> Repo.update!()

        DeliveryLog.record(notification.id, attempt, :success, channel)
        Logger.info("Notification #{notification.id} delivered via #{channel}")
        :ok

      {:error, reason} ->
        DeliveryLog.record(notification.id, attempt, :failure, channel, inspect(reason))

        notification
        |> Ecto.Changeset.change(%{status: "failed"})
        |> Repo.update!()

        Logger.warning("Notification #{notification.id} failed via #{channel}: #{inspect(reason)}")
        {:error, reason}
    end
  end

  # Channel adapters — each returns :ok or {:error, reason}
  # In production, these would call external APIs (SendGrid, Twilio, etc.)

  defp dispatch_email(notification) do
    Logger.info("Dispatching email to #{notification.recipient} (template: #{notification.template})")
    # Placeholder for email provider integration
    :ok
  end

  defp dispatch_sms(notification) do
    Logger.info("Dispatching SMS to #{notification.recipient} (template: #{notification.template})")
    # Placeholder for SMS provider integration
    :ok
  end

  defp dispatch_in_app(notification) do
    # Broadcast via PubSub for real-time in-app notifications
    Phoenix.PubSub.broadcast(
      AethelredPlatform.PubSub,
      "notifications:#{notification.recipient}",
      {:notification, %{
        id: notification.id,
        template: notification.template,
        data: notification.data,
        created_at: notification.created_at
      }}
    )

    :ok
  end

  defp dispatch_push(notification) do
    Logger.info("Dispatching push to #{notification.recipient} (template: #{notification.template})")
    # Placeholder for push notification provider
    :ok
  end

  defp dispatch_webhook(notification) do
    Logger.info("Dispatching webhook to #{notification.recipient} (template: #{notification.template})")
    # Placeholder for outgoing webhook
    :ok
  end
end
