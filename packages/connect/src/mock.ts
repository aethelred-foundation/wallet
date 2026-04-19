import type {
  AethelredConnectKernel,
  AethelredWalletState,
  EIP1193RequestArguments,
  IntentRequest,
  IntentResponse
} from "./contracts";
import { providerError } from "./errors";

const createIntentId = () => `intent-${Math.random().toString(36).slice(2, 10)}`;
const createApprovalId = () => `approval-${Math.random().toString(36).slice(2, 10)}`;

const cloneState = (state: AethelredWalletState): AethelredWalletState => ({
  ...state,
  subject: { ...state.subject },
  activeWorkspace: { ...state.activeWorkspace },
  policy: {
    ...state.policy,
    highlights: [...state.policy.highlights]
  },
  accounts: state.accounts.map((account) => ({ ...account })),
  sessions: state.sessions.map((session) => ({
    ...session,
    permissions: [...session.permissions]
  })),
  pendingApprovals: state.pendingApprovals.map((approval) => ({ ...approval })),
  catalog: state.catalog.map((app) => ({ ...app }))
});

const getIntentFromArgs = (args: EIP1193RequestArguments): IntentRequest => {
  const payload = Array.isArray(args.params) ? args.params[0] : undefined;

  if (!payload || typeof payload !== "object") {
    throw providerError(4001, "Intent payload is required.");
  }

  return payload as IntentRequest;
};

export const createDemoConnectKernel = (): AethelredConnectKernel => {
  let state: AethelredWalletState = {
    mode: "enterprise",
    locked: false,
    subject: {
      id: "subject-ramesh",
      displayName: "Ramesh Tamilselvan",
      kind: "person"
    },
    activeWorkspace: {
      id: "workspace-foundation",
      name: "AETHELRED",
      kind: "enterprise",
      role: "treasury-admin",
      summary:
        "Shared operational workspace for treasury, governance, approvals, and ecosystem administration."
    },
    accounts: [
      {
        id: "acct-evm-01",
        label: "Ops EVM signer",
        address: "0xae7e3d7c2a4c5b11f9d0b9ea81c3f4e55cafef10",
        namespace: "eip155",
        custody: "local",
        assurance: "device-key"
      },
      {
        id: "acct-ael-01",
        label: "Aethelred sovereign identity",
        address: "aethel1q2w3e4r5t6y7u8i9o0p0a1s2d3f4g5h6j7k8",
        namespace: "aethelred",
        custody: "approval-bound",
        assurance: "approval-bound"
      }
    ],
    policy: {
      mode: "approval-required",
      highlights: [
        "First-party app sessions may connect automatically.",
        "Treasury actions require approval evidence.",
        "Cross-workspace transfers require reviewer routing."
      ]
    },
    sessions: [
      {
        id: "session-cruzible",
        appName: "Cruzible Treasury Console",
        origin: "https://cruzible.aethelred.org",
        trustLevel: "first-party",
        permissions: ["accounts", "sign-message"],
        status: "active"
      }
    ],
    pendingApprovals: [
      {
        id: "approval-seed",
        title: "Treasury transfer review",
        summary: "250000 AEL to Treasury Operations Vault requires approval.",
        appName: "Aethelred Governance Console",
        requiredAction: "one reviewer",
        status: "pending"
      }
    ],
    catalog: [
      {
        id: "cruzible",
        name: "Cruzible Treasury Console",
        category: "treasury",
        trustLevel: "first-party",
        readiness: "live",
        integrationMode: "evm",
        summary: "Primary EVM-style operating target for early connect and signing flows."
      },
      {
        id: "zeroid",
        name: "ZeroID",
        category: "identity",
        trustLevel: "first-party",
        readiness: "planned",
        integrationMode: "evm",
        summary: "Identity-heavy app that will exercise message signing and policy-bound sessions."
      },
      {
        id: "shiora",
        name: "Shiora",
        category: "health",
        trustLevel: "first-party",
        readiness: "design",
        integrationMode: "compatibility",
        summary: "Cosmos-style compatibility target for the first non-EVM adapter design."
      }
    ]
  };

  const listeners = new Set<(nextState: AethelredWalletState) => void>();

  const notify = () => {
    const snapshot = cloneState(state);

    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const addPendingApproval = (intent: IntentRequest) => {
    const approvalId = createApprovalId();

    state = {
      ...state,
      pendingApprovals: [
        {
          id: approvalId,
          title: `${intent.app.name} requires approval`,
          summary: `Review ${intent.kind} request from ${intent.app.origin}.`,
          appName: intent.app.name,
          requiredAction: "one reviewer",
          status: "pending"
        },
        ...state.pendingApprovals
      ]
    };

    notify();

    return approvalId;
  };

  return {
    getState() {
      return cloneState(state);
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(cloneState(state));

      return () => {
        listeners.delete(listener);
      };
    },

    async request(args) {
      switch (args.method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return state.accounts
            .filter((account) => account.namespace === "eip155")
            .map((account) => account.address);

        case "wallet_getCapabilities":
          return {
            intents: [
              "connect",
              "sign-message",
              "sign-transaction",
              "switch-workspace"
            ],
            policyModes: ["guided", "approval-required", "dual-control", "committee"],
            namespaces: ["eip155", "aethelred"]
          };

        case "aethelred_getState":
          return cloneState(state);

        case "aethelred_requestIntent": {
          const intent = getIntentFromArgs(args);
          const intentId = intent.id ?? createIntentId();

          if (intent.kind === "connect") {
            const response: IntentResponse = {
              intentId,
              outcome: "allow",
              summary: "Application session approved.",
              warnings: [],
              result: {
                accounts: state.accounts.map((account) => account.address)
              }
            };
            return response;
          }

          if (intent.kind === "sign-message") {
            const response: IntentResponse = {
              intentId,
              outcome: "warn",
              summary: "Message signing allowed with elevated review visibility.",
              warnings: ["Message signing should be visible in the audit trail."],
              result: {
                signature:
                  "0x9af4b12d13c5b7f79a0b9f98d3a108cf59f72c48b22d6f4a9f5c2e5f18bd2a0e"
              }
            };
            return response;
          }

          if (intent.kind === "sign-transaction") {
            const approvalId = addPendingApproval(intent);
            const response: IntentResponse = {
              intentId,
              outcome: "approval-required",
              summary: "Transaction queued for approval.",
              warnings: [
                "Transaction requires reviewer approval before signer execution."
              ],
              approvalId
            };
            return response;
          }

          const response: IntentResponse = {
            intentId,
            outcome: "allow",
            summary: "Intent accepted.",
            warnings: []
          };

          return response;
        }

        default:
          throw providerError(4200, `Unsupported method: ${args.method}`);
      }
    }
  };
};
