defmodule ApprovalRouter.MixProject do
  use Mix.Project

  def project do
    [
      app: :approval_router,
      version: "0.1.0",
      build_path: "../../_build",
      config_path: "../../config/config.exs",
      deps_path: "../../deps",
      lockfile: "../../mix.lock",
      elixir: "~> 1.17",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {ApprovalRouter.Application, []}
    ]
  end

  defp deps do
    [
      {:ae_shared, in_umbrella: true},
      {:ae_event_contracts, in_umbrella: true},
      {:workflow_orchestrator, in_umbrella: true},
      {:notification_hub, in_umbrella: true},
      {:jason, "~> 1.4"}
    ]
  end
end
