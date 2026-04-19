defmodule AeShared.Repo do
  use Ecto.Repo,
    otp_app: :ae_shared,
    adapter: Ecto.Adapters.Postgres
end
