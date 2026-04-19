import type { ComplianceAlert, AlertSeverity, AlertStatus, AlertCategory } from "./enterprise-types";

function generateId(): string {
  return `alt-${crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
}

/**
 * Enterprise compliance alert management system.
 * Handles alert creation, deduplication, routing, escalation,
 * suppression, and resolution tracking.
 */
export class AlertSystem {
  private alerts = new Map<string, ComplianceAlert>();
  private suppressionRules = new Map<string, { category: AlertCategory; sourcePattern: string; until: number }>();

  createAlert(opts: {
    category: AlertCategory;
    severity: AlertSeverity;
    title: string;
    description: string;
    sourceId: string;
    workspaceId: string;
    escalationPath: string[];
    dueDate?: number;
  }): ComplianceAlert | null {
    // Deduplication: check for existing unresolved alert with same source
    const existing = Array.from(this.alerts.values()).find(
      (a) => a.sourceId === opts.sourceId && a.category === opts.category &&
             a.status !== "resolved" && a.status !== "false-positive"
    );
    if (existing) return existing;

    // Check suppression rules
    for (const rule of this.suppressionRules.values()) {
      if (rule.category === opts.category && rule.until > Date.now()) {
        return null; // Suppressed
      }
    }

    const alert: ComplianceAlert = {
      id: generateId(),
      category: opts.category,
      severity: opts.severity,
      status: "new",
      title: opts.title,
      description: opts.description,
      sourceId: opts.sourceId,
      workspaceId: opts.workspaceId,
      escalationLevel: 0,
      escalationPath: opts.escalationPath,
      createdAt: Date.now(),
      dueDate: opts.dueDate,
      relatedAlertIds: [],
    };

    // Auto-assign to first person in escalation path
    if (opts.escalationPath.length > 0) {
      alert.assignedTo = opts.escalationPath[0];
      alert.status = "assigned";
    }

    this.alerts.set(alert.id, alert);
    return alert;
  }

  acknowledge(alertId: string, officerId: string): ComplianceAlert {
    const alert = this.getAlert(alertId);
    alert.status = "acknowledged";
    alert.acknowledgedAt = Date.now();
    alert.assignedTo = officerId;
    return alert;
  }

  startReview(alertId: string): ComplianceAlert {
    const alert = this.getAlert(alertId);
    alert.status = "under-review";
    return alert;
  }

  resolve(alertId: string, resolution: NonNullable<ComplianceAlert["resolution"]>): ComplianceAlert {
    const alert = this.getAlert(alertId);
    alert.status = resolution.outcome === "false-positive" ? "false-positive" : "resolved";
    alert.resolution = resolution;
    alert.resolvedAt = Date.now();
    return alert;
  }

  escalate(alertId: string, reason: string): ComplianceAlert {
    const alert = this.getAlert(alertId);
    alert.escalationLevel += 1;
    if (alert.escalationLevel < alert.escalationPath.length) {
      alert.assignedTo = alert.escalationPath[alert.escalationLevel];
    }
    // Increase severity on escalation
    const severityOrder: AlertSeverity[] = ["info", "low", "medium", "high", "critical"];
    const currentIdx = severityOrder.indexOf(alert.severity);
    if (currentIdx < severityOrder.length - 1) {
      alert.severity = severityOrder[currentIdx + 1];
    }
    // Record the escalation reason on the alert history so auditors can
    // see why it was escalated — previously this parameter was dropped on
    // the floor, which was both a compliance gap (missing audit trail)
    // and a TS6133 unused-parameter error.
    alert.history = [
      ...(alert.history ?? []),
      { at: Date.now(), action: "escalated", detail: reason, level: alert.escalationLevel },
    ];
    return alert;
  }

  suppress(category: AlertCategory, durationMs: number, reason: string): void {
    this.suppressionRules.set(`${category}-${Date.now()}`, {
      category,
      sourcePattern: reason,
      until: Date.now() + durationMs,
    });
  }

  linkAlerts(alertId1: string, alertId2: string): void {
    const a1 = this.getAlert(alertId1);
    const a2 = this.getAlert(alertId2);
    if (!a1.relatedAlertIds.includes(alertId2)) a1.relatedAlertIds.push(alertId2);
    if (!a2.relatedAlertIds.includes(alertId1)) a2.relatedAlertIds.push(alertId1);
  }

  getAlert(id: string): ComplianceAlert {
    const alert = this.alerts.get(id);
    if (!alert) throw new Error(`Alert not found: ${id}`);
    return alert;
  }

  listAlerts(opts?: { status?: AlertStatus; severity?: AlertSeverity; category?: AlertCategory; assignedTo?: string; workspaceId?: string }): ComplianceAlert[] {
    let results = Array.from(this.alerts.values());
    if (opts?.status) results = results.filter((a) => a.status === opts.status);
    if (opts?.severity) results = results.filter((a) => a.severity === opts.severity);
    if (opts?.category) results = results.filter((a) => a.category === opts.category);
    if (opts?.assignedTo) results = results.filter((a) => a.assignedTo === opts.assignedTo);
    if (opts?.workspaceId) results = results.filter((a) => a.workspaceId === opts.workspaceId);
    return results.sort((a, b) => {
      const sev = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (sev[a.severity] ?? 5) - (sev[b.severity] ?? 5);
    });
  }

  getUnresolved(): ComplianceAlert[] {
    return Array.from(this.alerts.values()).filter((a) => !["resolved", "false-positive", "suppressed"].includes(a.status));
  }

  getOverdue(): ComplianceAlert[] {
    const now = Date.now();
    return Array.from(this.alerts.values()).filter((a) => a.dueDate && a.dueDate < now && !a.resolvedAt);
  }

  getMetrics(workspaceId?: string): {
    total: number; unresolved: number; critical: number; overdue: number;
    avgResolutionMs: number; falsePositiveRate: number;
    byCategory: Record<string, number>; bySeverity: Record<string, number>;
  } {
    const alerts = workspaceId ? this.listAlerts({ workspaceId }) : Array.from(this.alerts.values());
    const resolved = alerts.filter((a) => a.resolvedAt);
    const falsePositives = alerts.filter((a) => a.status === "false-positive");

    return {
      total: alerts.length,
      unresolved: alerts.filter((a) => !a.resolvedAt).length,
      critical: alerts.filter((a) => a.severity === "critical").length,
      overdue: alerts.filter((a) => a.dueDate && a.dueDate < Date.now() && !a.resolvedAt).length,
      avgResolutionMs: resolved.length > 0
        ? resolved.reduce((sum, a) => sum + (a.resolvedAt! - a.createdAt), 0) / resolved.length
        : 0,
      falsePositiveRate: alerts.length > 0 ? falsePositives.length / alerts.length : 0,
      byCategory: alerts.reduce((acc, a) => { acc[a.category] = (acc[a.category] ?? 0) + 1; return acc; }, {} as Record<string, number>),
      bySeverity: alerts.reduce((acc, a) => { acc[a.severity] = (acc[a.severity] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    };
  }
}
