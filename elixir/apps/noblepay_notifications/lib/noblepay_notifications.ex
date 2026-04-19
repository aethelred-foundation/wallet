defmodule NoblepayNotifications do
  @moduledoc """
  Facade for rendering and dispatching NoblePay notifications.

  Uses template definitions to build notification payloads from event data,
  then persists them to the notifications table for delivery.
  """

  alias NoblepayNotifications.Templates
  alias AeShared.Repo

  @doc """
  Render a notification from a template and event context.

  Returns the rendered notification map with subject, body, channel, and priority.
  """
  @spec render(atom(), map()) :: {:ok, map()} | {:error, :unknown_template}
  def render(template_name, context) do
    case Templates.get(template_name) do
      nil ->
        {:error, :unknown_template}

      template_fn ->
        {:ok, template_fn.(context)}
    end
  end

  @doc """
  Render and persist a notification to the notifications table.
  """
  @spec dispatch(atom(), String.t(), map()) :: {:ok, map()} | {:error, term()}
  def dispatch(template_name, recipient, context) do
    with {:ok, rendered} <- render(template_name, context) do
      now = DateTime.utc_now()

      notification = %{
        id: generate_id(),
        product: "noblepay",
        channel: to_string(rendered.channel),
        recipient: recipient,
        template: to_string(template_name),
        data: %{
          subject: rendered.subject,
          body: rendered.body,
          priority: to_string(rendered.priority),
          context: context
        },
        status: "pending",
        attempts: 0,
        created_at: now
      }

      Repo.insert_all("notifications", [notification], on_conflict: :nothing)
      {:ok, notification}
    end
  end

  @doc "List available template names."
  @spec template_names() :: [atom()]
  def template_names, do: Templates.names()

  defp generate_id do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end
end
