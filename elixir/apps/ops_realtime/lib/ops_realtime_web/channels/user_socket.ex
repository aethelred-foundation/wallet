defmodule OpsRealtimeWeb.UserSocket do
  @moduledoc """
  WebSocket entry point with JWT authentication.

  Mirrors the NoblePay websocket.ts JWT verification pattern.
  Tokens are verified using Joken with HS256 signing. The `businessId`
  (or `sub`) claim is extracted and assigned to the socket for
  channel-level authorization.
  """

  use Phoenix.Socket

  channel "queue:*", OpsRealtimeWeb.QueueChannel
  channel "alerts:*", OpsRealtimeWeb.AlertChannel
  channel "workflows:*", OpsRealtimeWeb.WorkflowChannel
  channel "dashboard:*", OpsRealtimeWeb.DashboardChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    jwt_secret = Application.get_env(:ops_realtime, :jwt_secret)
    signer = Joken.Signer.create("HS256", jwt_secret)

    case Joken.verify(%{}, token, signer) do
      {:ok, claims} ->
        business_id = claims["businessId"] || claims["sub"]
        user_id = claims["userId"] || claims["sub"]
        roles = claims["roles"] || []

        socket =
          socket
          |> assign(:business_id, business_id)
          |> assign(:user_id, user_id)
          |> assign(:roles, roles)

        {:ok, socket}

      {:error, _reason} ->
        :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(socket), do: "ops_socket:#{socket.assigns.user_id}"
end
