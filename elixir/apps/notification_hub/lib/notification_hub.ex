defmodule NotificationHub do
  @moduledoc """
  Centralized notification dispatch for the Aethelred platform.

  All notifications (email, SMS, in-app, push, webhook) are enqueued here
  and processed asynchronously via Oban workers. Supports retry logic,
  delivery tracking, and multi-channel dispatch.
  """

  alias NotificationHub.Schemas.Notification
  alias AeShared.Repo
  require Logger

  @doc """
  Enqueues a notification for delivery.

  ## Params
  - `:product` - source product (e.g., "noblepay", "platform")
  - `:channel` - delivery channel ("email", "sms", "in_app", "push", "webhook")
  - `:recipient` - target identifier (email, phone, user_id)
  - `:template` - template name for rendering
  - `:data` - template variable map (optional, defaults to %{})
  """
  def send_notification(params) when is_map(params) do
    id = generate_id()

    attrs = %{
      id: id,
      product: to_string(params[:product] || params["product"]),
      channel: to_string(params[:channel] || params["channel"]),
      recipient: to_string(params[:recipient] || params["recipient"]),
      template: to_string(params[:template] || params["template"]),
      data: params[:data] || params["data"] || %{},
      status: "pending",
      attempts: 0,
      created_at: DateTime.utc_now()
    }

    changeset = Notification.changeset(%Notification{}, attrs)

    case Repo.insert(changeset) do
      {:ok, notification} ->
        # Enqueue Oban job for async dispatch
        %{notification_id: notification.id}
        |> NotificationHub.Dispatcher.new()
        |> Oban.insert()

        Logger.info("Notification enqueued: #{id} (#{attrs.channel} -> #{attrs.recipient})")
        {:ok, notification}

      {:error, changeset} ->
        Logger.error("Failed to create notification: #{inspect(changeset.errors)}")
        {:error, changeset}
    end
  end

  @doc """
  Returns the current delivery status for a notification.
  """
  def get_delivery_status(notification_id) do
    case Repo.get(Notification, notification_id) do
      nil ->
        {:error, :not_found}

      notification ->
        {:ok,
         %{
           id: notification.id,
           status: notification.status,
           channel: notification.channel,
           attempts: notification.attempts,
           last_attempted_at: notification.last_attempted_at,
           delivered_at: notification.delivered_at
         }}
    end
  end

  defp generate_id do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end
end
