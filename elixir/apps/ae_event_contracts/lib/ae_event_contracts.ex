defmodule AeEventContracts do
  @moduledoc """
  Event schema definitions for the Aethelred Elixir Platform.

  Every event flowing through the platform must have a matching struct here.
  This is a pure library with no runtime dependencies beyond Jason.
  """

  alias AeEventContracts.Envelope

  @doc """
  Validates raw event data and wraps it into a typed envelope.
  Returns `{:ok, envelope}` or `{:error, reason}`.
  """
  def validate_and_wrap(product, type, schema_version, data, opts \\ []) do
    with {:ok, schema_mod} <- AeEventContracts.Registry.lookup(product, type, schema_version),
         {:ok, validated_data} <- schema_mod.validate(data) do
      {:ok,
       Envelope.new(%{
         source: Keyword.get(opts, :source, "unknown"),
         type: type,
         schema_version: schema_version,
         subject: Keyword.get(opts, :subject, ""),
         product: product,
         correlation_id: Keyword.get(opts, :correlation_id, generate_id()),
         causation_id: Keyword.get(opts, :causation_id),
         data: validated_data
       })}
    end
  end

  @doc "Returns the NATS subject for a given product and event type."
  def nats_subject(product, type) when is_atom(product) and is_binary(type) do
    "aethelred.#{product}.#{type}"
  end

  defp generate_id, do: :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
end
