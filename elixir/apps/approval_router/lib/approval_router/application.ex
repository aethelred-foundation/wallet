defmodule ApprovalRouter.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # Escalation timer manager
      {ApprovalRouter.Escalation, []}
    ]

    opts = [strategy: :one_for_one, name: ApprovalRouter.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
