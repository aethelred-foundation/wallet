import Config

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise "DATABASE_URL environment variable is missing"

  config :ae_shared, AeShared.Repo,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10")

  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise "SECRET_KEY_BASE environment variable is missing"

  config :ops_realtime, OpsRealtimeWeb.Endpoint,
    http: [port: String.to_integer(System.get_env("PORT") || "4000")],
    secret_key_base: secret_key_base,
    server: true

  config :ops_realtime, :jwt_secret,
    System.get_env("JWT_SECRET") ||
      raise "JWT_SECRET environment variable is missing"

  config :event_ingestion, :nats,
    host: System.get_env("NATS_HOST") || "localhost",
    port: String.to_integer(System.get_env("NATS_PORT") || "4222")
end
