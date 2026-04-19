defmodule NoblepayCaseQueue do
  @moduledoc """
  API for creating, assigning, and resolving NoblePay compliance cases.

  Cases are stored in the case_queue table and tracked through their lifecycle.
  """

  alias NoblepayCaseQueue.Schemas.Case
  alias AeShared.Repo

  import Ecto.Query

  @case_types [:compliance_review, :treasury_review, :liquidity_incident, :payment_exception]

  @doc "Returns the list of valid case types."
  @spec case_types() :: [atom()]
  def case_types, do: @case_types

  @doc "Create a new case in the queue."
  @spec create_case(map()) :: {:ok, Case.t()} | {:error, Ecto.Changeset.t()}
  def create_case(attrs) do
    %Case{}
    |> Case.changeset(attrs)
    |> Repo.insert()
  end

  @doc "Assign a case to a reviewer."
  @spec assign_case(String.t(), String.t()) :: {:ok, Case.t()} | {:error, term()}
  def assign_case(case_id, assignee) do
    case get_case(case_id) do
      {:ok, kase} ->
        kase
        |> Case.changeset(%{
          assigned_to: assignee,
          status: "assigned",
          updated_at: DateTime.utc_now()
        })
        |> Repo.update()

      error ->
        error
    end
  end

  @doc "Escalate a case to the next level."
  @spec escalate_case(String.t(), String.t()) :: {:ok, Case.t()} | {:error, term()}
  def escalate_case(case_id, reason) do
    case get_case(case_id) do
      {:ok, kase} ->
        kase
        |> Case.changeset(%{
          escalation_level: kase.escalation_level + 1,
          status: "escalated",
          context: Map.put(kase.context, "escalation_reason", reason),
          updated_at: DateTime.utc_now()
        })
        |> Repo.update()

      error ->
        error
    end
  end

  @doc "Resolve a case with a resolution."
  @spec resolve_case(String.t(), String.t(), String.t()) :: {:ok, Case.t()} | {:error, term()}
  def resolve_case(case_id, resolved_by, resolution) do
    case get_case(case_id) do
      {:ok, kase} ->
        kase
        |> Case.changeset(%{
          status: "resolved",
          resolved_at: DateTime.utc_now(),
          updated_at: DateTime.utc_now(),
          context:
            kase.context
            |> Map.put("resolved_by", resolved_by)
            |> Map.put("resolution", resolution)
        })
        |> Repo.update()

      error ->
        error
    end
  end

  @doc "Get a case by ID."
  @spec get_case(String.t()) :: {:ok, Case.t()} | {:error, :not_found}
  def get_case(case_id) do
    case Repo.get(Case, case_id) do
      nil -> {:error, :not_found}
      kase -> {:ok, kase}
    end
  end

  @doc "List cases filtered by status and/or case type."
  @spec list_cases(keyword()) :: [Case.t()]
  def list_cases(opts \\ []) do
    Case
    |> filter_by_status(Keyword.get(opts, :status))
    |> filter_by_type(Keyword.get(opts, :case_type))
    |> filter_by_assignee(Keyword.get(opts, :assigned_to))
    |> order_by([c], [desc: c.priority, asc: c.created_at])
    |> Repo.all()
  end

  @doc "List pending cases (unassigned)."
  @spec list_pending() :: [Case.t()]
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
