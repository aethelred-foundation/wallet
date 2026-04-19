defmodule OpsRealtimeTest do
  use ExUnit.Case
  doctest OpsRealtime

  test "greets the world" do
    assert OpsRealtime.hello() == :world
  end
end
