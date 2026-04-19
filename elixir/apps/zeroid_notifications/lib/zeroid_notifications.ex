defmodule ZeroidNotifications do
  @moduledoc """
  Facade for sending ZeroID notifications.

  Renders notification templates and dispatches them via the platform
  notification hub.
  """

  alias ZeroidNotifications.Templates

  @doc "Send a notification for a given event type."
  @spec notify(atom(), map()) :: :ok | {:error, term()}
  def notify(event_type, context) do
    case Templates.render(event_type, context) do
      {:ok, notification} ->
        dispatch(notification)

      {:error, _} = error ->
        error
    end
  end

  @doc "List all supported notification event types."
  @spec supported_events() :: [atom()]
  def supported_events do
    Templates.supported_events()
  end

  defp dispatch(notification) do
    Phoenix.PubSub.broadcast(
      AethelredPlatform.PubSub,
      "notifications:zeroid",
      {:notification, notification}
    )
  end
end
