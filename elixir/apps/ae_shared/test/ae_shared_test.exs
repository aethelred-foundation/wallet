defmodule AeSharedTest do
  use ExUnit.Case
  doctest AeShared

  test "greets the world" do
    assert AeShared.hello() == :world
  end
end
