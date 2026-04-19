defmodule EventIngestion.DeadLetter do
  @moduledoc """
  Failed event handling via a dead letter queue.

  Events that fail validation, persistence, or dispatch are stored here
  for manual review and potential reprocessing.
  """

  use Ecto.Schema
  import Ecto.Query
  alias AeShared.Repo
  require Logger

  @primary_key {:id, :string, autogenerate: false}
  schema "dead_letters" do
    field :original_event, :map
    field :error_reason, :string
    field :attempts, :integer, default: 1
    field :product, :string
    field :created_at, :utc_datetime_usec
    field :reviewed_at, :utc_datetime_usec
    field :reviewed_by, :string
  end

  @doc """
  Persists a failed event with its error reason to the dead letter queue.
  """
  def persist_dead_letter(original_event, error_reason) do
    id = generate_id()
    product = extract_product(original_event)

    attrs = %{
      id: id,
      original_event: normalize_event(original_event),
      error_reason: truncate(error_reason, 1000),
      product: product,
      created_at: DateTime.utc_now()
    }

    %__MODULE__{}
    |> Ecto.Changeset.cast(attrs, [:id, :original_event, :error_reason, :product, :created_at])
    |> Repo.insert()
    |> case do
      {:ok, record} ->
        Logger.warning("Dead letter stored: #{id} (#{error_reason})")
        {:ok, record}

      {:error, changeset} ->
        Logger.error("Failed to store dead letter: #{inspect(changeset.errors)}")
        {:error, changeset}
    end
  end

  @doc """
  Lists unreviewed dead letters, optionally filtered by product.
  """
  def list_unreviewed(opts \\ []) do
    limit = Keyword.get(opts, :limit, 50)

    __MODULE__
    |> where([d], is_nil(d.reviewed_at))
    |> maybe_filter_product(opts[:product])
    |> order_by([d], asc: d.created_at)
    |> limit(^limit)
    |> Repo.all()
  end

  @doc """
  Marks a dead letter as reviewed.
  """
  def mark_reviewed(id, reviewer) do
    case Repo.get(__MODULE__, id) do
      nil ->
        {:error, :not_found}

      record ->
        record
        |> Ecto.Changeset.change(%{reviewed_at: DateTime.utc_now(), reviewed_by: reviewer})
        |> Repo.update()
    end
  end

  defp maybe_filter_product(query, nil), do: query
  defp maybe_filter_product(query, product), do: where(query, [d], d.product == ^to_string(product))

  defp extract_product(%{product: product}) when is_atom(product), do: Atom.to_string(product)
  defp extract_product(%{product: product}) when is_binary(product), do: product
  defp extract_product(%{"product" => product}), do: to_string(product)
  defp extract_product(_), do: nil

  defp normalize_event(%AeEventContracts.Envelope{} = env) do
    case AeEventContracts.Envelope.to_json(env) do
      {:ok, json} -> Jason.decode!(json)
      _ -> %{raw: inspect(env)}
    end
  end

  defp normalize_event(event) when is_map(event), do: stringify_keys(event)
  defp normalize_event(event), do: %{raw: inspect(event)}

  defp stringify_keys(map) when is_map(map) do
    Map.new(map, fn {k, v} -> {to_string(k), v} end)
  end

  defp truncate(str, max) when byte_size(str) > max, do: String.slice(str, 0, max)
  defp truncate(str, _max), do: str

  defp generate_id do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end
end
