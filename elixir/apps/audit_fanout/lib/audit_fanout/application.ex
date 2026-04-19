defmodule AuditFanout.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # Sequence counter for hash chain ordering
      {AuditFanout.Capture.SequenceCounter, []}
    ]

    opts = [strategy: :one_for_one, name: AuditFanout.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
