defmodule TerraquraReviewQueue do
  @moduledoc """
  API for creating, assigning, and resolving TerraQura review cases.

  Review cases are generated when verifications fail, anomalies are
  detected, or compliance checks require human review.
  """

  alias TerraquraReviewQueue.ReviewManager

  @type case_type ::
          :failed_verification | :anomaly_review | :compliance_check | :mint_exception

  @type case_status :: :open | :assigned | :in_review | :resolved | :escalated

  @type review_case :: %{
          id: String.t(),
          case_type: case_type(),
          status: case_status(),
          entity_id: String.t(),
          assigned_to: String.t() | nil,
          priority: :low | :medium | :high | :critical,
          created_at: DateTime.t(),
          context: map()
        }

  @doc "Creates a new review case and returns `{:ok, case}` or `{:error, reason}`."
  def create_case(case_type, entity_id, context \\ %{}, opts \\ [])
      when case_type in [:failed_verification, :anomaly_review, :compliance_check, :mint_exception] do
    review_case = %{
      id: generate_case_id(),
      case_type: case_type,
      status: :open,
      entity_id: entity_id,
      assigned_to: nil,
      priority: Keyword.get(opts, :priority, :medium),
      created_at: DateTime.utc_now(),
      context: context
    }

    ReviewManager.track_case(review_case)
    {:ok, review_case}
  end

  @doc "Assigns a review case to a reviewer."
  def assign_case(case_id, reviewer_id) do
    ReviewManager.update_case(case_id, %{
      status: :assigned,
      assigned_to: reviewer_id,
      assigned_at: DateTime.utc_now()
    })
  end

  @doc "Marks a review case as resolved with a resolution summary."
  def resolve_case(case_id, resolution, resolved_by) do
    ReviewManager.update_case(case_id, %{
      status: :resolved,
      resolution: resolution,
      resolved_by: resolved_by,
      resolved_at: DateTime.utc_now()
    })
  end

  @doc "Escalates a review case to a higher priority."
  def escalate_case(case_id, reason) do
    ReviewManager.update_case(case_id, %{
      status: :escalated,
      priority: :critical,
      escalation_reason: reason,
      escalated_at: DateTime.utc_now()
    })
  end

  @doc "Returns all open cases, optionally filtered by type."
  def open_cases(case_type \\ nil) do
    ReviewManager.list_cases(:open, case_type)
  end

  @doc "Returns valid case types."
  def case_types do
    [:failed_verification, :anomaly_review, :compliance_check, :mint_exception]
  end

  defp generate_case_id do
    "tqrc_" <> (:crypto.strong_rand_bytes(12) |> Base.url_encode64(padding: false))
  end
end
