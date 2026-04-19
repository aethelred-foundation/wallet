defmodule OpsRealtimeWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :ops_realtime

  socket "/ops/socket", OpsRealtimeWeb.UserSocket,
    websocket: [timeout: 45_000],
    longpoll: false

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:ops_realtime, :endpoint]

  plug Plug.Parsers,
    parsers: [:json],
    pass: ["application/json"],
    json_decoder: Jason

  plug OpsRealtimeWeb.Router
end
