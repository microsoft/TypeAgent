// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const projectSources = {
    charter:
        "Goal: Reduce payment workload latency while preserving safe capacity headroom.\n\nScope: Payments reliability investigation and capacity validation; no live configuration changes.\n\nOwner: Capacity validation owner unknown; service-owner review is required.\n\nMilestone: Peak-load rehearsal is proposed; no committed date.\n\nDecision: Reporting-query explanation rejected by trace correlation; pool-pressure explanation retained.\n\nContext: Project knowledge as-of is unknown; source capture time is not project status time.",
    baseline:
        "Project status: active; project is not complete.\n\nIncident status: closed after recorded recovery, not project completion.\n\nCapacity: BLOCKED pending owner review and peak-load validation.\n\nRisk: Workload memory and headroom remain open questions; no universal pool target is authorized.",
    replacement:
        "Project status: active; project is not complete.\n\nIncident status: closed after recorded recovery, not project completion.\n\nCapacity: BLOCKED pending owner review and measured headroom validation.\n\nRisk: Peak-load rehearsal reached the workload-memory warning level. Require measured headroom before selecting a pool target; the recorded value of 100 is not universal.",
};
