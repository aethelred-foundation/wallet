defmodule NotificationHub.MixProject do
  use Mix.Project

  def project do
    [
      app: :notification_hub,
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
      mod: {NotificationHub.Application, []}
    ]
  end

  defp deps do
    [
      {:ae_shared, in_umbrella: true},
      {:oban, "~> 2.17"},
      {:jason, "~> 1.4"}
    ]
  end
end
