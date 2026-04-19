defmodule OpsRealtimeWeb.Router do
  use Plug.Router

  plug :match
  plug :dispatch

  get "/health" do
    send_resp(conn, 200, Jason.encode!(%{status: "ok", service: "ops_realtime"}))
  end

  get "/api/v1/channels" do
    channels = %{
      queue: "queue:*",
      alerts: "alerts:*",
      workflows: "workflows:*",
      dashboard: "dashboard:*"
    }

    send_resp(conn, 200, Jason.encode!(%{channels: channels}))
  end

  match _ do
    send_resp(conn, 404, Jason.encode!(%{error: "not_found"}))
  end
end
