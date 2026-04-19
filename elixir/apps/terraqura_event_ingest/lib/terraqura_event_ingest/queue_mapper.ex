defmodule TerraquraEventIngest.QueueMapper do
  @moduledoc """
  Maps BullMQ queue names and job data types to AeEventContracts event types.

  Queue names correspond to the QUEUE_NAMES constant in
  dApps/terraqura/packages/queue/src/queues.ts.
  """

  @queue_minting "terraqura:minting"
  @queue_verification "terraqura:verification"
  @queue_retirement "terraqura:retirement"
  @queue_sensor_batch "terraqura:sensor-batch"
  @queue_kyc_check "terraqura:kyc-check"
  @queue_sanctions_screening "terraqura:sanctions-screening"

  @doc "Returns all known BullMQ queue names."
  def queue_names do
    [
      @queue_minting,
      @queue_verification,
      @queue_retirement,
      @queue_sensor_batch,
      @queue_kyc_check,
      @queue_sanctions_screening
    ]
  end

  @doc """
  Maps a BullMQ queue name and job data to an event type and schema version.

  The job data is inspected to determine the specific event type when
  a single queue can produce multiple event types (e.g., verification
  queue produces both source-check and logic-check events).

  Returns `{:ok, event_type, schema_version}` or `{:error, reason}`.
  """
  def map_queue(@queue_minting, %{"status" => "succeeded"} = _job_data) do
    {:ok, "mint.succeeded", "1.0"}
  end

  def map_queue(@queue_minting, %{"status" => "failed"} = _job_data) do
    {:ok, "mint.failed", "1.0"}
  end

  def map_queue(@queue_minting, _job_data) do
    {:ok, "mint.readiness_confirmed", "1.0"}
  end

  def map_queue(@queue_verification, %{"phase" => "source_check", "result" => result} = _job_data)
      when result in ["passed", "failed"] do
    {:ok, "verification.source_check_completed", "1.0"}
  end

  def map_queue(@queue_verification, %{"phase" => "logic_check", "result" => result} = _job_data)
      when result in ["passed", "failed"] do
    {:ok, "verification.logic_check_completed", "1.0"}
  end

  def map_queue(@queue_verification, %{"status" => "failed"} = _job_data) do
    {:ok, "verification.failed", "1.0"}
  end

  def map_queue(@queue_verification, _job_data) do
    {:ok, "verification.batch_submitted", "1.0"}
  end

  def map_queue(@queue_retirement, _job_data) do
    {:ok, "retirement.requested", "1.0"}
  end

  def map_queue(@queue_sensor_batch, _job_data) do
    {:ok, "sensor.batch_received", "1.0"}
  end

  def map_queue(@queue_kyc_check, %{"result" => _result} = _job_data) do
    {:ok, "kyc.check_completed", "1.0"}
  end

  def map_queue(@queue_kyc_check, _job_data) do
    {:ok, "kyc.check_requested", "1.0"}
  end

  def map_queue(@queue_sanctions_screening, _job_data) do
    {:ok, "sanctions.screening_completed", "1.0"}
  end

  def map_queue(queue_name, _job_data) do
    {:error, {:unknown_queue, queue_name}}
  end
end
