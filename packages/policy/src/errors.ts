export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

export class PolicyBundleNotFoundError extends PolicyError {
  constructor(id: string) {
    super(`Policy bundle not found: ${id}`);
    this.name = "PolicyBundleNotFoundError";
  }
}

export class PolicyEvaluationError extends PolicyError {
  constructor(ruleId: string, reason: string) {
    super(`Failed to evaluate rule ${ruleId}: ${reason}`);
    this.name = "PolicyEvaluationError";
  }
}
