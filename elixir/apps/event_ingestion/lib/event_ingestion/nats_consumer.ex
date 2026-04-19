defmodule EventIngestion.NatsConsumer do
  @moduledoc """
  GenServer that connects to NATS JetStream and subscribes to `aethelred.>` (all platform events).

  On each message: decodes JSON, validates via ae_event_contracts, persists to the event store,
  and dispatches via PubSub. Failed events are routed to the dead letter queue.
  Connection failures trigger automatic reconnection with exponential backoff.
  """

  use GenServer
  require Logger

  @reconnect_base_ms 1_000
  @reconnect_max_ms 30_000
  @subscription_subject "aethelred.>"

  # --- Public API ---

  def start_link(config) do
    GenServer.start_link(__MODULE__, config, name: __MODULE__)
  end

  # --- Callbacks ---

  @impl true
  def init(config) do
    state = %{
      config: config,
      conn: nil,
      subscription: nil,
      reconnect_attempts: 0
    }

    {:ok, state, {:continue, :connect}}
  end

  @impl true
  def handle_continue(:connect, state) do
    {:noreply, attempt_connect(state)}
  end

  @impl true
  def handle_info({:msg, %{body: body, topic: topic}}, state) do
    Task.start(fn -> process_message(body, topic) end)
    {:noreply, state}
  end

  def handle_info(:reconnect, state) do
    {:noreply, attempt_connect(state)}
  end

  def handle_info({:DOWN, _ref, :process, pid, reason}, %{conn: pid} = state) do
    Logger.warning("NATS connection lost: #{inspect(reason)}")
    schedule_reconnect(state.reconnect_attempts)
    {:noreply, %{state | conn: nil, subscription: nil}}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  # --- Internal ---

  defp attempt_connect(state) do
    host = Keyword.get(state.config, :host, "localhost")
    port = Keyword.get(state.config, :port, 4222)

    case Gnat.start_link(%{host: host, port: port}) do
      {:ok, conn} ->
        Process.monitor(conn)
        {:ok, sub} = Gnat.sub(conn, self(), @subscription_subject)
        Logger.info("Connected to NATS at #{host}:#{port}, subscribed to #{@subscription_subject}")
        %{state | conn: conn, subscription: sub, reconnect_attempts: 0}

      {:error, reason} ->
        Logger.warning("NATS connection failed: #{inspect(reason)}, will retry")
        schedule_reconnect(state.reconnect_attempts)
        %{state | reconnect_attempts: state.reconnect_attempts + 1}
    end
  end

  defp schedule_reconnect(attempts) do
    delay = min(@reconnect_base_ms * :math.pow(2, attempts) |> trunc(), @reconnect_max_ms)
    Process.send_after(self(), :reconnect, delay)
  end

  defp process_message(body, topic) do
    with {:ok, payload} <- Jason.decode(body),
         {:ok, product} <- extract_product(topic),
         type <- extract_type(topic),
         schema_version <- Map.get(payload, "schema_version", 1),
         data <- Map.get(payload, "data", payload) do
      case EventIngestion.ingest_event(product, type, schema_version, data,
             source: "nats:#{topic}",
             subject: Map.get(payload, "subject", ""),
             correlation_id: Map.get(payload, "correlation_id")
           ) do
        {:ok, _envelope} ->
          :ok

        {:error, reason} ->
          Logger.warning("Event validation failed for #{topic}: #{inspect(reason)}")
          EventIngestion.DeadLetter.persist_dead_letter(%{raw: body, topic: topic}, inspect(reason))
      end
    else
      error ->
        Logger.error("Failed to process NATS message on #{topic}: #{inspect(error)}")
        EventIngestion.DeadLetter.persist_dead_letter(%{raw: body, topic: topic}, inspect(error))
    end
  end

  defp extract_product(topic) do
    case String.split(topic, ".") do
      ["aethelred", product | _rest] ->
        try do
          {:ok, String.to_existing_atom(product)}
        rescue
          ArgumentError -> {:error, :unknown_product}
        end

      _ ->
        {:error, :invalid_topic}
    end
  end

  defp extract_type(topic) do
    case String.split(topic, ".") do
      ["aethelred", _product | type_parts] -> Enum.join(type_parts, ".")
      _ -> "unknown"
    end
  end
end
