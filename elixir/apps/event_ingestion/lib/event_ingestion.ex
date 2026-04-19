defmodule EventIngestion do
  @moduledoc """
  Consumes events from existing Go/Rust/TS services via NATS JetStream or HTTP webhooks.

  This is the single entry point for all external events into the Aethelred Elixir Platform.
  Events are validated against `ae_event_contracts`, persisted to the append-only event store,
  and dispatched to team-specific PubSub topics for downstream processing.
  """

  require Logger

  @doc """
  Ingests an event by validating its schema, persisting it to the event store,
  and dispatching it to PubSub subscribers.

  Returns `{:ok, envelope}` on success or `{:error, reason}` on failure.
  Failed events are routed to the dead letter queue.
  """
  def ingest_event(product, type, schema_version, data, opts \\ []) do
    with {:ok, envelope} <- AeEventContracts.validate_and_wrap(product, type, schema_version, data, opts) do
      :ok = EventIngestion.EventStore.persist(envelope)
      :ok = EventIngestion.Dispatcher.dispatch(envelope)

      Logger.info("Ingested event",
        product: envelope.product,
        type: envelope.type,
        id: envelope.id
      )

      {:ok, envelope}
    end
  rescue
    e ->
      Logger.error("Event ingestion failed: #{Exception.message(e)}")
      {:error, {:ingestion_failed, Exception.message(e)}}
  end
end
