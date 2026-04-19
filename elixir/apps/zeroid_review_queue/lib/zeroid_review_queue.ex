defmodule ZeroidReviewQueue do
  @moduledoc """
  API for creating, assigning, and resolving ZeroID identity review cases.

  Cases are stored in the review_queue table and tracked through their lifecycle.
  """

  alias ZeroidReviewQueue.Schemas.ReviewCase
  alias AeShared.Repo

  import Ecto.Query

  @case_types [:issuance_exception, :revocation_exception, :verification_anomaly, :manual_review]

  @doc "Returns the list of valid case types."
  @spec case_types() :: [atom()]
  def case_types, do: @case_types

  @doc "Create a new review case in the queue."
  @spec create_case(map()) :: {:ok, ReviewCase.t()} | {:error, Ecto.Changeset.t()}
  def create_case(attrs) do
    %ReviewCase{}
    |> ReviewCase.changeset(attrs)
    |> Repo.insert()
  end

  @doc "Assign a review case to a reviewer."
  @spec assign_case(String.t(), String.t()) :: {:ok, ReviewCase.t()} | {:error, term()}
  def assign_case(case_id, assignee) do
    case get_case(case_id) do
      {:ok, review_case} ->
        review_case
        |> ReviewCase.changeset(%{
          assigned_to: assignee,
          status: "assigned",
          updated_at: DateTime.utc_now()
        })
        |> Repo.update()

      error ->
        error
    end
  end

  @doc "Escalate a review case to the next level."
  @spec escalate_case(String.t(), String.t()) :: {:ok, ReviewCase.t()} | {:error, term()}
  def escalate_case(case_id, reason) do
    case get_case(case_id) do
      {:ok, review_case} ->
        review_case
        |> ReviewCase.changeset(%{
          escalation_level: review_case.escalation_level + 1,
          status: "escalated",
          context: Map.put(review_case.context, "escalation_reason", reason),
          updated_at: DateTime.utc_now()
        })
        |> Repo.update()

      error ->
        error
    end
  end

  @doc "Resolve a review case with a resolution."
  @spec resolve_case(String.t(), String.t(), String.t()) :: {:ok, ReviewCase.t()} | {:error, term()}
  def resolve_case(case_id, resolved_by, resolution) do
    case get_case(case_id) do
      {:ok, review_case} ->
        review_case
        |> ReviewCase.changeset(%{
          status: "resolved",
          resolved_at: DateTime.utc_now(),
          updated_at: DateTime.utc_now(),
          context:
            review_case.context
            |> Map.put("resolved_by", resolved_by)
            |> Map.put("resolution", resolution)
        })
        |> Repo.update()

      error ->
        error
    end
  end

  @doc "Get a review case by ID."
  @spec get_case(String.t()) :: {:ok, ReviewCase.t()} | {:error, :not_found}
  def get_case(case_id) do
    case Repo.get(ReviewCase, case_id) do
      nil -> {:error, :not_found}
      review_case -> {:ok, review_case}
    end
  end

  @doc "List review cases filtered by status and/or case type."
  @spec list_cases(keyword()) :: [ReviewCase.t()]
  def list_cases(opts \\ []) do
    ReviewCase
    |> filter_by_status(Keyword.get(opts, :status))
    |> filter_by_type(Keyword.get(opts, :case_type))
    |> filter_by_assignee(Keyword.get(opts, :assigned_to))
    |> order_by([c], [desc: c.priority, asc: c.created_at])
    |> Repo.all()
  end

  @doc "List pending cases (unassigned)."
  @spec list_pending() :: [ReviewCase.t()]
  def list_pending do
    list_cases(status: "pending")
  end

  defp filter_by_status(query, nil), do: query
  defp filter_by_status(query, status), do: where(query, [c], c.status == ^status)

  defp filter_by_type(query, nil), do: query
  defp filter_by_type(query, type), do: where(query, [c], c.case_type == ^to_string(type))

  defp filter_by_assignee(query, nil), do: query
  defp filter_by_assignee(query, assignee), do: where(query, [c], c.assigned_to == ^assignee)
end
