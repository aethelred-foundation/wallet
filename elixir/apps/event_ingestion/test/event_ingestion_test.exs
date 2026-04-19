defmodule EventIngestionTest do
  use ExUnit.Case
  doctest EventIngestion

  test "greets the world" do
    assert EventIngestion.hello() == :world
  end
end
