defmodule NoblepayNotifications.Templates do
  @moduledoc """
  Notification templates for NoblePay events.

  Each template is a function that takes an event context map and returns a
  rendered notification with subject, body, channel, and priority.
  """

  @type rendered :: %{
          subject: String.t(),
          body: String.t(),
          channel: atom(),
          priority: atom()
        }

  @templates %{
    payment_flagged: &__MODULE__.payment_flagged/1,
    payment_approved: &__MODULE__.payment_approved/1,
    payment_settled: &__MODULE__.payment_settled/1,
    compliance_escalated: &__MODULE__.compliance_escalated/1,
    treasury_alert: &__MODULE__.treasury_alert/1,
    liquidity_warning: &__MODULE__.liquidity_warning/1
  }

  @doc "Look up a template function by name."
  @spec get(atom()) :: (map() -> rendered()) | nil
  def get(name), do: Map.get(@templates, name)

  @doc "List all template names."
  @spec names() :: [atom()]
  def names, do: Map.keys(@templates)

  # --- Template implementations ---

  @doc false
  @spec payment_flagged(map()) :: rendered()
  def payment_flagged(ctx) do
    payment_id = Map.get(ctx, :payment_id, Map.get(ctx, "payment_id", "unknown"))
    reason = Map.get(ctx, :flag_reason, Map.get(ctx, "flag_reason", "compliance review required"))
    severity = Map.get(ctx, :severity, Map.get(ctx, "severity", "medium"))

    %{
      subject: "Payment #{payment_id} flagged for review",
      body:
        "Payment #{payment_id} has been flagged (severity: #{severity}). " <>
          "Reason: #{reason}. " <>
          "Please review this payment in the compliance queue.",
      channel: :email,
      priority: :high
    }
  end

  @doc false
  @spec payment_approved(map()) :: rendered()
  def payment_approved(ctx) do
    payment_id = Map.get(ctx, :payment_id, Map.get(ctx, "payment_id", "unknown"))
    approved_by = Map.get(ctx, :approved_by, Map.get(ctx, "approved_by", "system"))

    %{
      subject: "Payment #{payment_id} approved",
      body:
        "Payment #{payment_id} has been approved by #{approved_by}. " <>
          "Settlement will proceed automatically.",
      channel: :in_app,
      priority: :normal
    }
  end

  @doc false
  @spec payment_settled(map()) :: rendered()
  def payment_settled(ctx) do
    payment_id = Map.get(ctx, :payment_id, Map.get(ctx, "payment_id", "unknown"))
    amount = Map.get(ctx, :settled_amount, Map.get(ctx, "settled_amount", "N/A"))
    currency = Map.get(ctx, :settled_currency, Map.get(ctx, "settled_currency", ""))

    %{
      subject: "Payment #{payment_id} settled",
      body:
        "Payment #{payment_id} has been successfully settled. " <>
          "Amount: #{amount} #{currency}.",
      channel: :in_app,
      priority: :low
    }
  end

  @doc false
  @spec compliance_escalated(map()) :: rendered()
  def compliance_escalated(ctx) do
    case_id = Map.get(ctx, :case_id, Map.get(ctx, "case_id", "unknown"))
    level = Map.get(ctx, :escalation_level, Map.get(ctx, "escalation_level", 1))
    reason = Map.get(ctx, :reason, Map.get(ctx, "reason", "timeout"))

    %{
      subject: "Compliance case #{case_id} escalated to level #{level}",
      body:
        "Compliance case #{case_id} has been escalated to level #{level}. " <>
          "Reason: #{reason}. " <>
          "Immediate attention required.",
      channel: :email,
      priority: :critical
    }
  end

  @doc false
  @spec treasury_alert(map()) :: rendered()
  def treasury_alert(ctx) do
    rebalance_id = Map.get(ctx, :rebalance_id, Map.get(ctx, "rebalance_id", "unknown"))
    trigger = Map.get(ctx, :trigger_reason, Map.get(ctx, "trigger_reason", "threshold breach"))
    amount = Map.get(ctx, :amount, Map.get(ctx, "amount", "N/A"))

    %{
      subject: "Treasury rebalance triggered: #{rebalance_id}",
      body:
        "Treasury rebalance #{rebalance_id} triggered due to #{trigger}. " <>
          "Amount: #{amount}. " <>
          "Review the treasury action queue for details.",
      channel: :email,
      priority: :high
    }
  end

  @doc false
  @spec liquidity_warning(map()) :: rendered()
  def liquidity_warning(ctx) do
    pool_id = Map.get(ctx, :pool_id, Map.get(ctx, "pool_id", "unknown"))
    alert_type = Map.get(ctx, :alert_type, Map.get(ctx, "alert_type", "low_balance"))
    current = Map.get(ctx, :current_balance, Map.get(ctx, "current_balance", "N/A"))
    threshold = Map.get(ctx, :threshold, Map.get(ctx, "threshold", "N/A"))

    %{
      subject: "Liquidity warning: #{pool_id} (#{alert_type})",
      body:
        "Liquidity pool #{pool_id} has triggered a #{alert_type} alert. " <>
          "Current balance: #{current}, threshold: #{threshold}. " <>
          "Consider initiating a treasury rebalance.",
      channel: :sms,
      priority: :critical
    }
  end
end
