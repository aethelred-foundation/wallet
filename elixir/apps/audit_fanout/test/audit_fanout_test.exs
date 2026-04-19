defmodule AuditFanoutTest do
  use ExUnit.Case
  doctest AuditFanout

  test "greets the world" do
    assert AuditFanout.hello() == :world
  end
end
