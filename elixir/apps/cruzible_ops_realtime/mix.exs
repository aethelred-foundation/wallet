defmodule CruzibleOpsRealtime.MixProject do
  use Mix.Project

  def project do
    [
      app: :cruzible_ops_realtime,
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
      mod: {CruzibleOpsRealtime.Application, []}
    ]
  end

  defp deps do
    [
      {:ae_shared, in_umbrella: true},
      {:ae_event_contracts, in_umbrella: true},
      {:phoenix, "~> 1.7"},
      {:phoenix_pubsub, "~> 2.1"}
    ]
  end
end
