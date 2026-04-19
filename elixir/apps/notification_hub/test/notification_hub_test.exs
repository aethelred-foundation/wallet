defmodule NotificationHubTest do
  use ExUnit.Case
  doctest NotificationHub

  test "greets the world" do
    assert NotificationHub.hello() == :world
  end
end
