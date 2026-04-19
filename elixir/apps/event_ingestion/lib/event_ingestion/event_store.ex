defmodule EventIngestion.EventStore do
  @moduledoc """
  Ecto-backed append-only event store.

  Persists validated event envelopes to the `event_store` table.
  Provides query capabilities for filtering by product, type, subject, and time range.
  """

  use Ecto.Schema
  import Ecto.Query
  alias AeShared.Repo

  @primary_key {:id, :string, autogenerate: false}
  schema "event_store" do
    field :type, :string
    field :schema_version, :integer
    field :product, :string
    field :subject, :string
    field :data, :map
    field :correlation_id, :string
    field :causation_id, :string
    field :source, :string
    field :occurred_at, :utc_datetime_usec
    field :ingested_at, :utc_datetime_usec
  end

  @doc """
  Persists a validated event envelope to the event store.
  """
  def persist(%AeEventContracts.Envelope{} = envelope) do
    now = DateTime.utc_now()

    attrs = %{
      id: envelope.id,
      type: envelope.type,
      schema_version: envelope.schema_version,
      product: Atom.to_string(envelope.product),
      subject: envelope.subject || "",
      data: envelope.data,
      correlation_id: envelope.correlation_id,
      causation_id: envelope.causation_id,
      source: envelope.source,
      occurred_at: envelope.time,
      ingested_at: now
    }

    %__MODULE__{}
    |> Ecto.Changeset.cast(attrs, [
      :id, :type, :schema_version, :product, :subject, :data,
      :correlation_id, :causation_id, :source, :occurred_at, :ingested_at
    ])
    |> Repo.insert()
    |> case do
      {:ok, _record} -> :ok
      {:error, changeset} -> {:error, changeset}
    end
  end

  @doc """
  Queries events from the store with optional filters.

  ## Options

  - `:product` - filter by product (atom or string)
  - `:type` - filter by event type
  - `:subject` - filter by subject
  - `:from` - events after this DateTime
  - `:to` - events before this DateTime
  - `:limit` - max number of results (default 100)
  - `:order` - `:asc` or `:desc` (default `:desc`)
  """
  def query(opts \\ []) do
    limit = Keyword.get(opts, :limit, 100)
    order = Keyword.get(opts, :order, :desc)

    __MODULE__
    |> maybe_filter_product(opts[:product])
    |> maybe_filter_type(opts[:type])
    |> maybe_filter_subject(opts[:subject])
    |> maybe_filter_from(opts[:from])
    |> maybe_filter_to(opts[:to])
    |> order_by([e], [{^order, e.ingested_at}])
    |> limit(^limit)
    |> Repo.all()
  end

  defp maybe_filter_product(query, nil), do: query
  defp maybe_filter_product(query, product) when is_atom(product) do
    where(query, [e], e.product == ^Atom.to_string(product))
  end
  defp maybe_filter_product(query, product) when is_binary(product) do
    where(query, [e], e.product == ^product)
  end

  defp maybe_filter_type(query, nil), do: query
  defp maybe_filter_type(query, type), do: where(query, [e], e.type == ^type)

  defp maybe_filter_subject(query, nil), do: query
  defp maybe_filter_subject(query, subject), do: where(query, [e], e.subject == ^subject)

  defp maybe_filter_from(query, nil), do: query
  defp maybe_filter_from(query, from), do: where(query, [e], e.ingested_at >= ^from)

  defp maybe_filter_to(query, nil), do: query
  defp maybe_filter_to(query, to), do: where(query, [e], e.ingested_at <= ^to)
end
