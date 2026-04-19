defmodule ApprovalRouter do
  @moduledoc """
  Multi-party approval engine mirroring the TypeScript types from
  `wallet/packages/approval/src/types.ts`.

  Supports five quorum strategies: any_one, majority, unanimous, threshold, sequential.
  Manages the full lifecycle: create request, collect decisions, evaluate quorum,
  escalate on timeout.
  """

  alias ApprovalRouter.Schemas
  alias ApprovalRouter.Quorum
  alias ApprovalRouter.Escalation
  alias AeShared.Repo
  import Ecto.Query
  require Logger

  @doc """
  Creates a new approval request.

  ## Required params
  - `:title`, `:workspace_id`, `:requester_id`, `:app_id`, `:intent_id`,
    `:intent_kind`, `:quorum_type`, `:expires_at`

  ## Optional params
  - `:summary`, `:quorum_threshold`, `:quorum_total`, `:escalation_trigger`,
    `:escalation_timeout_minutes`, `:escalation_max`, `:context`
  """
  def create_request(params) when is_map(params) do
    id = generate_id()
    now = DateTime.utc_now()

    attrs =
      params
      |> Map.put(:id, id)
      |> Map.put(:status, "pending")
      |> Map.put(:escalation_current_level, 0)
      |> Map.put_new(:context, %{})
      |> Map.put(:created_at, now)

    changeset = Schemas.ApprovalRequest.changeset(%Schemas.ApprovalRequest{}, attrs)

    case Repo.insert(changeset) do
      {:ok, request} ->
        # Start escalation timer if configured
        if request.escalation_timeout_minutes do
          Escalation.schedule_escalation(request)
        end

        Logger.info("Approval request created: #{id} (#{request.quorum_type})")
        {:ok, request}

      {:error, changeset} ->
        {:error, changeset}
    end
  end

  @doc """
  Submits a reviewer's decision (approve/reject) for a request.
  Automatically evaluates quorum after each decision.
  """
  def submit_decision(request_id, reviewer_params, decision) when decision in ["approved", "rejected"] do
    case get_request(request_id) do
      {:ok, request} ->
        if request.status != "pending" do
          {:error, :request_not_pending}
        else
          decision_attrs = %{
            id: generate_id(),
            approval_request_id: request_id,
            reviewer_id: reviewer_params.reviewer_id,
            reviewer_name: reviewer_params.reviewer_name,
            decision: decision,
            reason: Map.get(reviewer_params, :reason),
            decided_at: DateTime.utc_now()
          }

          changeset = Schemas.ApprovalDecision.changeset(%Schemas.ApprovalDecision{}, decision_attrs)

          case Repo.insert(changeset) do
            {:ok, decision_record} ->
              # Re-evaluate quorum with the new decision
              {:ok, updated_request} = evaluate_quorum(request_id)

              if updated_request.status in ["approved", "rejected"] do
                notify_resolution(updated_request)
              end

              {:ok, decision_record, updated_request}

            {:error, changeset} ->
              {:error, changeset}
          end
        end

      error ->
        error
    end
  end

  @doc """
  Evaluates quorum for a request and updates its status if resolved.
  """
  def evaluate_quorum(request_id) do
    case get_request(request_id) do
      {:ok, request} ->
        decisions = list_decisions(request_id)
        quorum_type = String.to_existing_atom(request.quorum_type)

        config = %{
          quorum_threshold: request.quorum_threshold,
          quorum_total: request.quorum_total
        }

        result = Quorum.evaluate(quorum_type, decisions, config)

        if result in [:approved, :rejected] do
          request
          |> Ecto.Changeset.change(%{status: Atom.to_string(result), resolved_at: DateTime.utc_now()})
          |> Repo.update()
        else
          {:ok, request}
        end

      error ->
        error
    end
  end

  @doc """
  Fetches a request with its decisions preloaded.
  """
  def get_request(request_id) do
    case Repo.get(Schemas.ApprovalRequest, request_id) do
      nil -> {:error, :not_found}
      request -> {:ok, Repo.preload(request, :decisions)}
    end
  end

  @doc """
  Lists all decisions for a request.
  """
  def list_decisions(request_id) do
    Schemas.ApprovalDecision
    |> where([d], d.approval_request_id == ^request_id)
    |> order_by([d], asc: d.decided_at)
    |> Repo.all()
  end

  defp notify_resolution(request) do
    NotificationHub.send_notification(%{
      product: "platform",
      channel: "in_app",
      recipient: request.requester_id,
      template: "approval_resolved",
      data: %{
        request_id: request.id,
        title: request.title,
        status: request.status
      }
    })
  end

  defp generate_id do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end
end
