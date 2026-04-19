defmodule ApprovalRouter.Quorum do
  @moduledoc """
  Quorum evaluation logic for five approval strategies.

  Each strategy evaluates a list of decisions against a configuration
  and returns `:approved`, `:rejected`, or `:pending`.

  ## Strategies

  - `:any_one` — First approval wins; no rejections can block
  - `:majority` — More than half must approve
  - `:unanimous` — All must approve; any rejection immediately rejects
  - `:threshold` — A specific number of approvals required
  - `:sequential` — All must approve in submission order; any rejection stops the chain
  """

  @doc """
  Evaluates quorum for a given strategy, list of decisions, and configuration.
  Returns `:approved`, `:rejected`, or `:pending`.
  """
  def evaluate(strategy, decisions, config)

  # --- any_one: first approval wins ---
  def evaluate(:any_one, [], _config), do: :pending

  def evaluate(:any_one, decisions, _config) do
    if Enum.any?(decisions, &(&1.decision == "approved")) do
      :approved
    else
      :pending
    end
  end

  # --- majority: more than half must approve ---
  def evaluate(:majority, decisions, config) do
    total = config.quorum_total || length(decisions)
    approvals = Enum.count(decisions, &(&1.decision == "approved"))
    rejections = Enum.count(decisions, &(&1.decision == "rejected"))
    threshold = div(total, 2) + 1

    cond do
      approvals >= threshold -> :approved
      rejections >= threshold -> :rejected
      true -> :pending
    end
  end

  # --- unanimous: all must approve, any rejection immediately rejects ---
  def evaluate(:unanimous, decisions, config) do
    total = config.quorum_total || length(decisions)
    approvals = Enum.count(decisions, &(&1.decision == "approved"))
    rejections = Enum.count(decisions, &(&1.decision == "rejected"))

    cond do
      rejections > 0 -> :rejected
      approvals >= total -> :approved
      true -> :pending
    end
  end

  # --- threshold: specific number of approvals required ---
  def evaluate(:threshold, decisions, config) do
    required = config.quorum_threshold || 1
    approvals = Enum.count(decisions, &(&1.decision == "approved"))

    if approvals >= required do
      :approved
    else
      :pending
    end
  end

  # --- sequential: all must approve in order, any rejection stops ---
  def evaluate(:sequential, decisions, _config) do
    decisions
    |> Enum.sort_by(& &1.decided_at, DateTime)
    |> evaluate_sequential()
  end

  defp evaluate_sequential([]), do: :pending

  defp evaluate_sequential(sorted_decisions) do
    result =
      Enum.reduce_while(sorted_decisions, :pending, fn decision, _acc ->
        case decision.decision do
          "approved" -> {:cont, :approved}
          "rejected" -> {:halt, :rejected}
          _ -> {:cont, :pending}
        end
      end)

    # Sequential requires all expected reviewers to have decided
    # If the last decision was approved but we have not exhausted the chain, still pending
    if result == :approved do
      :approved
    else
      result
    end
  end
end
