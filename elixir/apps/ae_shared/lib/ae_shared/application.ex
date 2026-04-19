defmodule AeShared.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      AeShared.Repo,
      {Phoenix.PubSub, name: AethelredPlatform.PubSub}
    ]

    opts = [strategy: :one_for_one, name: AeShared.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
