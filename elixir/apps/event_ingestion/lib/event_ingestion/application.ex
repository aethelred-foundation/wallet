defmodule EventIngestion.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    nats_config = Application.get_env(:event_ingestion, :nats, [])

    children =
      [
        # NATS JetStream consumer — only started when NATS is configured
        nats_child(nats_config),
        # HTTP webhook receiver on port 4001
        {Plug.Cowboy, scheme: :http, plug: EventIngestion.HttpReceiver, options: [port: 4001]}
      ]
      |> Enum.reject(&is_nil/1)

    opts = [strategy: :one_for_one, name: EventIngestion.Supervisor]
    Supervisor.start_link(children, opts)
  end

  defp nats_child(config) when is_list(config) do
    host = Keyword.get(config, :host)

    if host do
      {EventIngestion.NatsConsumer, config}
    else
      nil
    end
  end
end
