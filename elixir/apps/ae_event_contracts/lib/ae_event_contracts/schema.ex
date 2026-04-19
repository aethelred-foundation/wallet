defmodule AeEventContracts.Schema do
  @moduledoc """
  Behaviour and helper macro for defining event schemas.

  Each event schema module defines required and optional fields,
  and provides validate/1 for checking incoming data maps.
  """

  @callback required_fields() :: [atom()]
  @callback optional_fields() :: [atom()]
  @callback validate(map()) :: {:ok, map()} | {:error, term()}

  defmacro __using__(opts) do
    required = Keyword.get(opts, :required, [])
    optional = Keyword.get(opts, :optional, [])

    quote do
      @behaviour AeEventContracts.Schema

      @required_fields unquote(required)
      @optional_fields unquote(optional)

      @impl true
      def required_fields, do: @required_fields

      @impl true
      def optional_fields, do: @optional_fields

      @impl true
      def validate(data) when is_map(data) do
        missing =
          @required_fields
          |> Enum.reject(fn field ->
            key = Atom.to_string(field)
            Map.has_key?(data, field) or Map.has_key?(data, key)
          end)

        case missing do
          [] ->
            normalized =
              data
              |> Enum.map(fn
                {k, v} when is_binary(k) -> {String.to_existing_atom(k), v}
                {k, v} when is_atom(k) -> {k, v}
              end)
              |> Enum.filter(fn {k, _v} -> k in @required_fields or k in @optional_fields end)
              |> Map.new()

            {:ok, normalized}

          fields ->
            {:error, {:missing_fields, fields}}
        end
      end

      def validate(_), do: {:error, :invalid_data}

      defoverridable validate: 1
    end
  end
end
