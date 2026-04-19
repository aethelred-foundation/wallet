defmodule OpsRealtime.MixProject do
  use Mix.Project

  def project do
    [
      app: :ops_realtime,
      version: "0.1.0",
      build_path: "../../_build",
      config_path: "../../config/config.exs",
      deps_path: "../../deps",
      lockfile: "../../mix.lock",
      elixir: "~> 1.17",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      compilers: Mix.compilers()
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {OpsRealtime.Application, []}
    ]
  end

  defp deps do
    [
      {:ae_shared, in_umbrella: true},
      {:ae_event_contracts, in_umbrella: true},
      {:phoenix, "~> 1.7"},
      {:phoenix_pubsub, "~> 2.1"},
      {:joken, "~> 2.6"},
      {:jason, "~> 1.4"}
    ]
  end
end
