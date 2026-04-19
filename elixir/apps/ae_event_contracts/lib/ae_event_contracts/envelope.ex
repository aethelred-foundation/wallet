defmodule AeEventContracts.Envelope do
  @moduledoc """
  CloudEvents-aligned envelope for all platform events.
  Every event crossing a service boundary uses this shape.
  """

  @enforce_keys [:id, :source, :type, :schema_version, :subject, :time, :product, :correlation_id, :data]
  defstruct [
    :id,
    :source,
    :type,
    :schema_version,
    :subject,
    :time,
    :product,
    :correlation_id,
    :causation_id,
    :data,
    data_content_type: "application/json",
    metadata: %{}
  ]

  @type t :: %__MODULE__{
          id: String.t(),
          source: String.t(),
          type: String.t(),
          schema_version: pos_integer(),
          subject: String.t(),
          time: DateTime.t(),
          product: atom(),
          correlation_id: String.t(),
          causation_id: String.t() | nil,
          data: map(),
          data_content_type: String.t(),
          metadata: map()
        }

  def new(attrs) when is_map(attrs) do
    %__MODULE__{
      id: Map.get(attrs, :id, generate_ulid()),
      source: Map.fetch!(attrs, :source),
      type: Map.fetch!(attrs, :type),
      schema_version: Map.fetch!(attrs, :schema_version),
      subject: Map.fetch!(attrs, :subject),
      time: Map.get(attrs, :time, DateTime.utc_now()),
      product: Map.fetch!(attrs, :product),
      correlation_id: Map.fetch!(attrs, :correlation_id),
      causation_id: Map.get(attrs, :causation_id),
      data: Map.fetch!(attrs, :data),
      data_content_type: Map.get(attrs, :data_content_type, "application/json"),
      metadata: Map.get(attrs, :metadata, %{})
    }
  end

  def to_json(%__MODULE__{} = envelope) do
    envelope
    |> Map.from_struct()
    |> Map.update!(:time, &DateTime.to_iso8601/1)
    |> Map.update!(:product, &Atom.to_string/1)
    |> Jason.encode()
  end

  def from_json(json) when is_binary(json) do
    with {:ok, map} <- Jason.decode(json) do
      {:ok,
       %__MODULE__{
         id: map["id"],
         source: map["source"],
         type: map["type"],
         schema_version: map["schema_version"],
         subject: map["subject"],
         time: parse_time(map["time"]),
         product: String.to_existing_atom(map["product"]),
         correlation_id: map["correlation_id"],
         causation_id: map["causation_id"],
         data: map["data"],
         data_content_type: map["data_content_type"] || "application/json",
         metadata: map["metadata"] || %{}
       }}
    end
  end

  defp parse_time(nil), do: DateTime.utc_now()

  defp parse_time(str) when is_binary(str) do
    case DateTime.from_iso8601(str) do
      {:ok, dt, _} -> dt
      _ -> DateTime.utc_now()
    end
  end

  defp generate_ulid do
    ts = System.system_time(:millisecond)
    rand = :crypto.strong_rand_bytes(10)

    <<ts::unsigned-big-48, rand::binary-size(10)>>
    |> Base.encode32(case: :lower, padding: false)
  end
end
