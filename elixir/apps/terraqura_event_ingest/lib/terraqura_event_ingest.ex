defmodule TerraquraEventIngest do
  @moduledoc """
  Maps BullMQ queue events from the TerraQura TypeScript service
  into typed AeEventContracts events for the Elixir platform.

  Provides ingestion entry points for each BullMQ queue.
  """

  alias TerraquraEventIngest.QueueMapper

  @doc """
  Ingests a raw BullMQ job payload, mapping it to a typed event envelope.

  ## Parameters
    - queue_name: The BullMQ queue name (e.g., "terraqura:minting")
    - job_data: The raw job data map from BullMQ

  ## Returns
    - `{:ok, envelope}` on success
    - `{:error, reason}` on validation failure
  """
  def ingest(queue_name, job_data) when is_binary(queue_name) and is_map(job_data) do
    with {:ok, event_type, schema_version} <- QueueMapper.map_queue(queue_name, job_data),
         {:ok, envelope} <-
           AeEventContracts.validate_and_wrap(
             :terraqura,
             event_type,
             schema_version,
             job_data,
             source: "bullmq:#{queue_name}"
           ) do
      {:ok, envelope}
    end
  end

  @doc "Returns the list of known BullMQ queue names."
  def known_queues, do: QueueMapper.queue_names()
end
