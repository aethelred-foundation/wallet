defmodule ZeroidCredentialWorkflows.MixProject do
  use Mix.Project

  def project do
    [
      app: :zeroid_credential_workflows,
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
      mod: {ZeroidCredentialWorkflows.Application, []}
    ]
  end

  defp deps do
    [
      {:ae_shared, in_umbrella: true},
      {:ae_event_contracts, in_umbrella: true},
      {:workflow_orchestrator, in_umbrella: true}
    ]
  end
end
