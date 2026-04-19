defmodule ZeroidAdminRealtime.EventBroadcaster do
  @moduledoc """
  GenServer that subscribes to platform PubSub topics for ZeroID events
  and rebroadcasts them to the admin dashboard channel topics.
  """

  use GenServer
  require Logger

  @subscribe_topics ["workflow:zeroid", "reviews:zeroid", "zeroid:identity"]

  # --- Client API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Server Callbacks ---

  @impl true
  def init(_opts) do
    for topic <- @subscribe_topics do
      Phoenix.PubSub.subscribe(AethelredPlatform.PubSub, topic)
    end

    Logger.info("ZeroidAdminRealtime.EventBroadcaster started, subscribed to #{inspect(@subscribe_topics)}")
    {:ok, %{events_broadcast: 0}}
  end

  @impl true
  def handle_info({:workflow_transition, %{workflow_type: wf_type} = transition}, state) do
    event_type = transition_to_event_type(wf_type, transition.event)
    payload = build_transition_payload(transition)
    ZeroidAdminRealtime.broadcast(event_type, payload)
    {:noreply, %{state | events_broadcast: state.events_broadcast + 1}}
  end

  @impl true
  def handle_info({event_type, payload}, state) when is_atom(event_type) and is_map(payload) do
    ZeroidAdminRealtime.broadcast(event_type, payload)
    {:noreply, %{state | events_broadcast: state.events_broadcast + 1}}
  end

  @impl true
  def handle_info(_msg, state), do: {:noreply, state}

  # --- Private ---

  defp transition_to_event_type(:credential_issuance, :signed), do: :credential_issued
  defp transition_to_event_type(:credential_revocation, :propagation_complete), do: :credential_revoked
  defp transition_to_event_type(:credential_issuance, _), do: :credential_signing
  defp transition_to_event_type(:verification_handling, _), do: :verification_complete
  defp transition_to_event_type(_, _), do: :identity_status_changed

  defp build_transition_payload(transition) do
    %{
      entity_id: transition.entity_id,
      workflow_type: transition.workflow_type,
      event: transition.event,
      from_state: transition.from,
      to_state: transition.to,
      timestamp: DateTime.utc_now()
    }
  end
end
