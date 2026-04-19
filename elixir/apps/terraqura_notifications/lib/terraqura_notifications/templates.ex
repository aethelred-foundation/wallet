defmodule TerraquraNotifications.Templates do
  @moduledoc """
  Notification templates for TerraQura events.

  Each template type returns a structured notification with subject,
  body, priority, and category for downstream delivery routing.
  """

  @type rendered :: %{
          subject: String.t(),
          body: String.t(),
          priority: :low | :normal | :high | :urgent,
          category: atom()
        }

  @doc "Renders a notification template with the given event data."
  @spec render(atom(), map()) :: {:ok, rendered()} | {:error, :unknown_template}

  def render(:verification_failed, data) do
    {:ok,
     %{
       subject: "Verification Failed: Batch #{data[:batch_id]}",
       body:
         "Verification batch #{data[:batch_id]} for DAC unit #{data[:dac_unit_id]} " <>
           "failed during #{data[:failure_phase] || "unknown"} phase. " <>
           "Reason: #{data[:failure_reason] || "unspecified"}.",
       priority: :high,
       category: :verification
     }}
  end

  def render(:verification_completed, data) do
    {:ok,
     %{
       subject: "Verification Complete: Batch #{data[:batch_id]}",
       body:
         "Verification batch #{data[:batch_id]} for DAC unit #{data[:dac_unit_id]} " <>
           "has passed all checks. CO2 captured: #{data[:co2_captured] || "N/A"} kg.",
       priority: :normal,
       category: :verification
     }}
  end

  def render(:mint_succeeded, data) do
    {:ok,
     %{
       subject: "Mint Succeeded: Token #{data[:token_id]}",
       body:
         "Batch #{data[:batch_id]} successfully minted. " <>
           "Token ID: #{data[:token_id]}, Amount: #{data[:minted_amount]}, " <>
           "TX: #{data[:tx_hash]}.",
       priority: :normal,
       category: :minting
     }}
  end

  def render(:mint_failed, data) do
    {:ok,
     %{
       subject: "Mint Failed: Batch #{data[:batch_id]}",
       body:
         "Minting failed for batch #{data[:batch_id]}. " <>
           "Reason: #{data[:failure_reason] || "unknown"}. " <>
           "Retry count: #{data[:retry_count] || 0}.",
       priority: :urgent,
       category: :minting
     }}
  end

  def render(:anomaly_detected, data) do
    priority =
      case data[:severity] do
        s when s in [:critical, "critical"] -> :urgent
        s when s in [:high, "high"] -> :high
        _ -> :normal
      end

    {:ok,
     %{
       subject: "Anomaly Detected: #{data[:anomaly_type]} on #{data[:dac_unit_id]}",
       body:
         "Anomaly #{data[:anomaly_id]} detected on DAC unit #{data[:dac_unit_id]}. " <>
           "Type: #{data[:anomaly_type]}, Severity: #{data[:severity]}, " <>
           "Value: #{data[:detected_value]}.",
       priority: priority,
       category: :alerts
     }}
  end

  def render(:kyc_completed, data) do
    {:ok,
     %{
       subject: "KYC Check Complete: #{data[:result]}",
       body:
         "KYC check for user #{data[:user_id]} completed via #{data[:provider]}. " <>
           "Result: #{data[:result]}, Check type: #{data[:check_type]}.",
       priority: :normal,
       category: :compliance
     }}
  end

  def render(:review_assigned, data) do
    {:ok,
     %{
       subject: "Review Assigned: #{data[:review_type]}",
       body:
         "Review #{data[:review_id]} (#{data[:review_type]}) assigned to #{data[:assigned_to]}. " <>
           "Entity: #{data[:entity_id]}. " <>
           "SLA deadline: #{data[:sla_deadline] || "none"}.",
       priority: :high,
       category: :reviews
     }}
  end

  def render(_unknown, _data) do
    {:error, :unknown_template}
  end
end
