defmodule EventIngestion.HttpReceiver do
  @moduledoc """
  Plug router for HTTP webhook event ingestion.

  Accepts POST requests at `/api/v1/events` with a JSON body containing:
  `{product, type, schema_version, data}`.

  Validates HMAC-SHA256 signature from the `x-signature` header when a
  webhook secret is configured.
  """

  use Plug.Router
  require Logger

  plug Plug.Logger, log: :info
  plug :match
  plug Plug.Parsers, parsers: [:json], json_decoder: Jason
  plug :dispatch

  post "/api/v1/events" do
    with :ok <- verify_signature(conn),
         {:ok, params} <- extract_params(conn.body_params) do
      {product, type, schema_version, data} = params

      case EventIngestion.ingest_event(product, type, schema_version, data,
             source: "http:webhook",
             subject: Map.get(conn.body_params, "subject", ""),
             correlation_id: Map.get(conn.body_params, "correlation_id")
           ) do
        {:ok, envelope} ->
          conn
          |> put_resp_content_type("application/json")
          |> send_resp(201, Jason.encode!(%{ok: true, event_id: envelope.id}))

        {:error, reason} ->
          conn
          |> put_resp_content_type("application/json")
          |> send_resp(422, Jason.encode!(%{error: format_error(reason)}))
      end
    else
      {:error, :invalid_signature} ->
        conn
        |> put_resp_content_type("application/json")
        |> send_resp(401, Jason.encode!(%{error: "invalid_signature"}))

      {:error, reason} ->
        conn
        |> put_resp_content_type("application/json")
        |> send_resp(400, Jason.encode!(%{error: format_error(reason)}))
    end
  end

  get "/health" do
    send_resp(conn, 200, Jason.encode!(%{status: "ok", service: "event_ingestion"}))
  end

  match _ do
    send_resp(conn, 404, Jason.encode!(%{error: "not_found"}))
  end

  # --- Internal ---

  defp extract_params(body) do
    with product when is_binary(product) <- body["product"],
         type when is_binary(type) <- body["type"],
         schema_version when is_integer(schema_version) <- body["schema_version"],
         data when is_map(data) <- body["data"] do
      product_atom =
        try do
          String.to_existing_atom(product)
        rescue
          ArgumentError -> nil
        end

      if product_atom do
        {:ok, {product_atom, type, schema_version, data}}
      else
        {:error, :unknown_product}
      end
    else
      _ -> {:error, :missing_required_fields}
    end
  end

  defp verify_signature(conn) do
    secret = Application.get_env(:event_ingestion, :webhook_secret)

    if secret do
      case Plug.Conn.get_req_header(conn, "x-signature") do
        [signature] ->
          {:ok, raw_body, _conn} = Plug.Conn.read_body(conn)
          expected = "sha256=" <> (:crypto.mac(:hmac, :sha256, secret, raw_body) |> Base.encode16(case: :lower))

          if Plug.Crypto.secure_compare(expected, signature) do
            :ok
          else
            {:error, :invalid_signature}
          end

        [] ->
          {:error, :invalid_signature}
      end
    else
      # No secret configured — skip verification (dev mode)
      :ok
    end
  end

  defp format_error(reason) when is_binary(reason), do: reason
  defp format_error(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp format_error(reason), do: inspect(reason)
end
