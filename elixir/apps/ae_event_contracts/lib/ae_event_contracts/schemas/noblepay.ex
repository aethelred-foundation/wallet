defmodule AeEventContracts.Schemas.NoblePay do
  @moduledoc "NoblePay event schemas — 13 events covering payment lifecycle, compliance, treasury, streaming, and cross-chain."

  defmodule PaymentCreated do
    use AeEventContracts.Schema,
      required: [:payment_id, :amount, :currency, :sender, :recipient, :payment_type],
      optional: [:corridor, :metadata, :business_id]
  end

  defmodule PaymentScreeningStarted do
    use AeEventContracts.Schema,
      required: [:payment_id, :screening_type, :provider],
      optional: [:risk_signals, :rules_applied]
  end

  defmodule PaymentFlagged do
    use AeEventContracts.Schema,
      required: [:payment_id, :flag_reason, :severity, :flagged_by],
      optional: [:risk_score, :recommended_action, :details]
  end

  defmodule PaymentApproved do
    use AeEventContracts.Schema,
      required: [:payment_id, :approved_by, :approval_type],
      optional: [:conditions, :notes]
  end

  defmodule PaymentSettled do
    use AeEventContracts.Schema,
      required: [:payment_id, :settlement_reference, :settled_amount, :settled_currency],
      optional: [:settlement_network, :fees, :exchange_rate]
  end

  defmodule PaymentRejected do
    use AeEventContracts.Schema,
      required: [:payment_id, :rejected_by, :rejection_reason],
      optional: [:details, :appeal_eligible]
  end

  defmodule ComplianceCaseOpened do
    use AeEventContracts.Schema,
      required: [:case_id, :payment_id, :case_type, :priority],
      optional: [:assigned_to, :sla_deadline, :related_cases]
  end

  defmodule ComplianceEscalated do
    use AeEventContracts.Schema,
      required: [:case_id, :escalation_level, :escalated_to, :reason],
      optional: [:previous_assignee, :deadline]
  end

  defmodule ComplianceResolved do
    use AeEventContracts.Schema,
      required: [:case_id, :resolution, :resolved_by],
      optional: [:notes, :evidence_ids, :duration_ms]
  end

  defmodule TreasuryRebalanceTriggered do
    use AeEventContracts.Schema,
      required: [:rebalance_id, :trigger_reason, :source_pool, :target_pool, :amount],
      optional: [:currency, :urgency]
  end

  defmodule TreasuryLiquidityAlert do
    use AeEventContracts.Schema,
      required: [:alert_id, :pool_id, :alert_type, :severity, :current_balance, :threshold],
      optional: [:recommended_action, :corridor]
  end

  defmodule StreamingPaymentCreated do
    use AeEventContracts.Schema,
      required: [:stream_id, :payment_id, :rate_per_second, :total_amount, :recipient],
      optional: [:start_time, :end_time, :currency]
  end

  defmodule CrosschainTransferStateChanged do
    use AeEventContracts.Schema,
      required: [:transfer_id, :from_chain, :to_chain, :new_state],
      optional: [:tx_hash, :amount, :error_message, :confirmations]
  end
end
