defmodule ZeroidNotifications.Templates do
  @moduledoc """
  Notification templates for ZeroID identity events.

  Each template renders a structured notification map from event context,
  suitable for dispatch to email, webhook, or in-app notification channels.
  """

  @supported_events [
    :credential_issued,
    :credential_revoked,
    :verification_anomaly,
    :review_assigned,
    :identity_status_changed
  ]

  @doc "Returns the list of supported notification event types."
  @spec supported_events() :: [atom()]
  def supported_events, do: @supported_events

  @doc "Render a notification for the given event type and context."
  @spec render(atom(), map()) :: {:ok, map()} | {:error, :unsupported_event}
  def render(:credential_issued, context) do
    {:ok, %{
      event: :credential_issued,
      product: :zeroid,
      severity: :info,
      title: "Credential Issued",
      body: "Credential #{Map.get(context, :credential_id, "unknown")} has been issued for identity #{Map.get(context, :identity_id, "unknown")}.",
      metadata: context,
      timestamp: DateTime.utc_now()
    }}
  end

  def render(:credential_revoked, context) do
    {:ok, %{
      event: :credential_revoked,
      product: :zeroid,
      severity: :warning,
      title: "Credential Revoked",
      body: "Credential #{Map.get(context, :credential_id, "unknown")} has been revoked. Reason: #{Map.get(context, :reason, "unspecified")}.",
      metadata: context,
      timestamp: DateTime.utc_now()
    }}
  end

  def render(:verification_anomaly, context) do
    {:ok, %{
      event: :verification_anomaly,
      product: :zeroid,
      severity: :critical,
      title: "Verification Anomaly Detected",
      body: "An anomaly was detected during verification of #{Map.get(context, :credential_id, "unknown")}. Investigation required.",
      metadata: context,
      timestamp: DateTime.utc_now()
    }}
  end

  def render(:review_assigned, context) do
    {:ok, %{
      event: :review_assigned,
      product: :zeroid,
      severity: :info,
      title: "Review Case Assigned",
      body: "Review case #{Map.get(context, :case_id, "unknown")} has been assigned to #{Map.get(context, :assignee, "unassigned")}.",
      metadata: context,
      timestamp: DateTime.utc_now()
    }}
  end

  def render(:identity_status_changed, context) do
    {:ok, %{
      event: :identity_status_changed,
      product: :zeroid,
      severity: :info,
      title: "Identity Status Changed",
      body: "Identity #{Map.get(context, :identity_id, "unknown")} status changed from #{Map.get(context, :from_status, "unknown")} to #{Map.get(context, :to_status, "unknown")}.",
      metadata: context,
      timestamp: DateTime.utc_now()
    }}
  end

  def render(_event_type, _context) do
    {:error, :unsupported_event}
  end
end
