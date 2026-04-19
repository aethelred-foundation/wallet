import Config

config :ae_shared, AeShared.Repo,
  show_sensitive_data_on_connection_error: true,
  pool_size: 10

config :ops_realtime, OpsRealtimeWeb.Endpoint,
  http: [port: 4000],
  debug_errors: true,
  code_reloader: false,
  check_origin: false

config :logger, :default_handler,
  level: :debug
