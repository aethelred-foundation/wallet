import Config

config :ae_shared, AeShared.Repo,
  database: "aethelred_platform_dev",
  username: "aethelred",
  password: "aethelred_dev",
  hostname: "localhost",
  port: 5433,
  pool_size: 10

config :ae_shared,
  ecto_repos: [AeShared.Repo]

config :notification_hub, Oban,
  repo: AeShared.Repo,
  queues: [
    notifications: 10,
    escalations: 5,
    retries: 5
  ]

config :ops_realtime, OpsRealtimeWeb.Endpoint,
  http: [port: 4000],
  url: [host: "localhost"],
  secret_key_base: String.duplicate("a", 64),
  server: false,
  pubsub_server: AethelredPlatform.PubSub

config :ops_realtime, :jwt_secret, "dev-jwt-secret-change-in-production"

config :event_ingestion, :nats,
  host: "localhost",
  port: 4222

config :logger, :default_handler,
  level: :info

config :logger, :default_formatter,
  format: "$date $time [$level] $metadata$message\n",
  metadata: [:request_id, :product, :workflow_id]

import_config "#{config_env()}.exs"
