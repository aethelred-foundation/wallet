defmodule AeEventContractsTest do
  use ExUnit.Case

  alias AeEventContracts.{Envelope, Registry}

  describe "Envelope" do
    test "creates envelope from attributes" do
      envelope =
        Envelope.new(%{
          source: "test-service",
          type: "payment.created",
          schema_version: 1,
          subject: "pay_123",
          product: :noblepay,
          correlation_id: "corr_1",
          data: %{amount: 100}
        })

      assert envelope.source == "test-service"
      assert envelope.type == "payment.created"
      assert envelope.product == :noblepay
      assert envelope.data == %{amount: 100}
      assert is_binary(envelope.id)
      assert %DateTime{} = envelope.time
    end

    test "serializes to JSON and back" do
      envelope =
        Envelope.new(%{
          source: "test",
          type: "payment.created",
          schema_version: 1,
          subject: "pay_1",
          product: :noblepay,
          correlation_id: "c1",
          data: %{"amount" => 100}
        })

      {:ok, json} = Envelope.to_json(envelope)
      assert is_binary(json)

      {:ok, decoded} = Envelope.from_json(json)
      assert decoded.type == "payment.created"
      assert decoded.product == :noblepay
      assert decoded.data == %{"amount" => 100}
    end
  end

  describe "Registry" do
    test "looks up NoblePay payment.created" do
      assert {:ok, mod} = Registry.lookup(:noblepay, "payment.created", 1)
      assert mod == AeEventContracts.Schemas.NoblePay.PaymentCreated
    end

    test "looks up TerraQura verification.batch_submitted" do
      assert {:ok, mod} = Registry.lookup(:terraqura, "verification.batch_submitted", 1)
      assert mod == AeEventContracts.Schemas.TerraQura.VerificationBatchSubmitted
    end

    test "looks up ZeroID credential.issued" do
      assert {:ok, mod} = Registry.lookup(:zeroid, "credential.issued", 1)
      assert mod == AeEventContracts.Schemas.ZeroID.CredentialIssued
    end

    test "looks up Cruzible alert.created" do
      assert {:ok, mod} = Registry.lookup(:cruzible, "alert.created", 1)
      assert mod == AeEventContracts.Schemas.Cruzible.AlertCreated
    end

    test "returns error for unknown event" do
      assert {:error, {:unknown_event, :unknown, "foo", 1}} =
               Registry.lookup(:unknown, "foo", 1)
    end

    test "returns all keys" do
      keys = Registry.all_keys()
      assert length(keys) == 45
    end

    test "returns keys for product" do
      noblepay_keys = Registry.keys_for_product(:noblepay)
      assert length(noblepay_keys) == 13

      terraqura_keys = Registry.keys_for_product(:terraqura)
      assert length(terraqura_keys) == 13

      zeroid_keys = Registry.keys_for_product(:zeroid)
      assert length(zeroid_keys) == 10

      cruzible_keys = Registry.keys_for_product(:cruzible)
      assert length(cruzible_keys) == 9
    end
  end

  describe "Schema validation" do
    test "NoblePay PaymentCreated validates required fields" do
      valid_data = %{
        payment_id: "pay_1",
        amount: "100.00",
        currency: "USD",
        sender: "alice",
        recipient: "bob",
        payment_type: "cross_border"
      }

      assert {:ok, validated} =
               AeEventContracts.Schemas.NoblePay.PaymentCreated.validate(valid_data)

      assert validated.payment_id == "pay_1"
    end

    test "NoblePay PaymentCreated rejects missing required fields" do
      invalid_data = %{payment_id: "pay_1", amount: "100.00"}

      assert {:error, {:missing_fields, missing}} =
               AeEventContracts.Schemas.NoblePay.PaymentCreated.validate(invalid_data)

      assert :currency in missing
      assert :sender in missing
    end

    test "TerraQura VerificationBatchSubmitted validates" do
      data = %{
        batch_id: "batch_1",
        dac_unit_id: "dac_1",
        period_start: "2026-01-01",
        period_end: "2026-01-31"
      }

      assert {:ok, _} =
               AeEventContracts.Schemas.TerraQura.VerificationBatchSubmitted.validate(data)
    end

    test "Cruzible AlertCreated validates" do
      data = %{
        alert_id: "alert_1",
        alert_type: "reconciliation_mismatch",
        severity: "critical",
        title: "TVL drift detected",
        source: "reconciliation_scheduler"
      }

      assert {:ok, _} = AeEventContracts.Schemas.Cruzible.AlertCreated.validate(data)
    end

    test "validates with string keys (from JSON)" do
      data = %{
        "payment_id" => "pay_1",
        "amount" => "100.00",
        "currency" => "USD",
        "sender" => "alice",
        "recipient" => "bob",
        "payment_type" => "domestic"
      }

      assert {:ok, validated} =
               AeEventContracts.Schemas.NoblePay.PaymentCreated.validate(data)

      assert validated.payment_id == "pay_1"
    end
  end

  describe "NATS subjects" do
    test "generates correct NATS subject" do
      assert AeEventContracts.nats_subject(:noblepay, "payment.created") ==
               "aethelred.noblepay.payment.created"
    end

    test "returns NATS subjects for product" do
      subjects = Registry.nats_subjects(:noblepay)
      assert "aethelred.noblepay.payment.created" in subjects
      assert "aethelred.noblepay.compliance.case_opened" in subjects
    end
  end
end
