defmodule TerraquraNotifications do
  @moduledoc """
  Notification rendering for TerraQura events.

  Renders notification content from templates and event data,
  returning structured notification payloads ready for delivery.
  """

  alias TerraquraNotifications.Templates

  @type notification_type ::
          :verification_failed
          | :verification_completed
          | :mint_succeeded
          | :mint_failed
          | :anomaly_detected
          | :kyc_completed
          | :review_assigned

  @doc """
  Renders a notification from a template type and event data.

  Returns `{:ok, notification}` with subject, body, and metadata,
  or `{:error, reason}` if the template type is unknown.
  """
  def render(notification_type, event_data) when is_atom(notification_type) and is_map(event_data) do
    case Templates.render(notification_type, event_data) do
      {:ok, _rendered} = result -> result
      {:error, _reason} = error -> error
    end
  end

  @doc "Returns the list of supported notification types."
  def supported_types do
    [
      :verification_failed,
      :verification_completed,
      :mint_succeeded,
      :mint_failed,
      :anomaly_detected,
      :kyc_completed,
      :review_assigned
    ]
  end

  @doc "Checks whether a notification type is supported."
  def supported?(type), do: type in supported_types()
end
