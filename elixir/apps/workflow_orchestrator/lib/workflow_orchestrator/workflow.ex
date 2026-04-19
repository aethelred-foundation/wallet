defmodule WorkflowOrchestrator.Workflow do
  @moduledoc """
  Behaviour that team-specific workflow modules must implement.

  Each workflow defines its state machine: initial state, valid transitions,
  optional guards, enter/exit callbacks, and timeout configuration.
  """

  @type state :: atom()
  @type event :: atom()
  @type context :: map()
  @type guard :: (context() -> boolean())

  @type transition :: %{
          from: state(),
          event: event(),
          to: state(),
          guard: guard() | nil
        }

  @type timeout_config :: %{
          timeout_ms: pos_integer(),
          escalation_event: event()
        }

  @doc "The product this workflow belongs to (e.g., :noblepay, :terraqura)."
  @callback product() :: atom()

  @doc "The workflow type identifier (e.g., :payment_lifecycle)."
  @callback workflow_type() :: atom()

  @doc "The starting state for new workflow instances."
  @callback initial_state() :: state()

  @doc "List of valid state transitions."
  @callback transitions() :: [transition()]

  @doc "Called when entering a state. Returns updated context."
  @callback on_enter(state(), context()) :: context()

  @doc "Called when exiting a state. Returns updated context."
  @callback on_exit(state(), context()) :: context()

  @doc "Returns timeout config for a state, or nil for no timeout."
  @callback timeout_config(state()) :: timeout_config() | nil

  @optional_callbacks [on_enter: 2, on_exit: 2, timeout_config: 1]

  defmacro __using__(_opts) do
    quote do
      @behaviour WorkflowOrchestrator.Workflow

      def on_enter(_state, context), do: context
      def on_exit(_state, context), do: context
      def timeout_config(_state), do: nil

      defoverridable on_enter: 2, on_exit: 2, timeout_config: 1
    end
  end
end
