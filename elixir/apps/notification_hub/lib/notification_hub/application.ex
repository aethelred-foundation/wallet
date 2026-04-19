defmodule NotificationHub.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    oban_config = Application.get_env(:notification_hub, Oban, [])

    children = [
      {Oban, oban_config}
    ]

    opts = [strategy: :one_for_one, name: NotificationHub.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
