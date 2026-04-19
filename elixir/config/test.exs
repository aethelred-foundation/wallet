import Config

config :ae_shared, AeShared.Repo,
  database: "aethelred_platform_test#{System.get_env("MIX_TEST_PARTITION")}",
  username: "aethelred",
  password: "aethelred_dev",
  hostname: "localhost",
  port: 5433,
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

config :notification_hub, Oban,
  testing: :inline

config :ops_realtime, OpsRealtimeWeb.Endpoint,
  http: [port: 4002],
  server: false

config :logger, :default_handler,
  level: :warning
