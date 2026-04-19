defmodule EventIngestion.Dispatcher do
  @moduledoc """
  Routes ingested events to downstream handlers via Phoenix PubSub.

  Broadcasts each event on two topics:
  - `"events:{product}"` — all events for a product (e.g., `"events:noblepay"`)
  - `"events:{product}:{type}"` — specific event type (e.g., `"events:noblepay:payment.created"`)

  Team-specific apps subscribe to these topics to drive their own logic
  (case queues, workflows, alerts, notifications, etc.).
  """

  require Logger

  @pubsub AethelredPlatform.PubSub

  @doc """
  Dispatches a validated event envelope to PubSub subscribers.
  """
  def dispatch(%AeEventContracts.Envelope{} = envelope) do
    product = Atom.to_string(envelope.product)
    type = envelope.type

    product_topic = "events:#{product}"
    typed_topic = "events:#{product}:#{type}"

    Phoenix.PubSub.broadcast(@pubsub, product_topic, {:event, envelope})
    Phoenix.PubSub.broadcast(@pubsub, typed_topic, {:event, envelope})

    Logger.debug("Dispatched event #{envelope.id} to #{product_topic} and #{typed_topic}")

    :ok
  end

  @doc """
  Subscribes the calling process to all events for a given product.
  """
  def subscribe_product(product) when is_atom(product) do
    Phoenix.PubSub.subscribe(@pubsub, "events:#{product}")
  end

  @doc """
  Subscribes the calling process to a specific event type for a product.
  """
  def subscribe(product, type) when is_atom(product) and is_binary(type) do
    Phoenix.PubSub.subscribe(@pubsub, "events:#{product}:#{type}")
  end
end
