// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewMaintenancePlanRequest,
    ViewMaintenanceRequest,
} from "./viewMaintenanceTypes.js";
import { assertViewIdentifier } from "./viewContent.js";
import type { ViewBuildTarget, ViewVersion } from "./viewTypes.js";
import type { ViewMaintenanceTargetPlan } from "./viewMaintenanceTypes.js";
import { viewHash } from "./viewMerge.js";
import { ViewBuildStaleError } from "./viewBuilds.js";

export function assertMaintenanceMembership(
    target: ViewBuildTarget,
    current: ViewVersion | undefined,
    plan: ViewMaintenanceTargetPlan,
): void {
    if (
        current?.definition.maintenance &&
        target.definition.maintenance === undefined
    )
        throw new Error(
            "Configured maintenance intent must be retained in an explicit build definition",
        );
    if (plan.state === "blocked") throw new ViewBuildStaleError(plan.reason);
    if (
        plan.selector &&
        viewHash(plan.selector) !== viewHash(target.definition.selector)
    )
        throw new ViewBuildStaleError(
            "Dynamic evidence membership changed; plan maintenance again",
        );
}

export function validateMaintenanceRequest(
    request: ViewMaintenancePlanRequest | ViewMaintenanceRequest,
    writing: boolean,
): void {
    const allowed = writing
        ? ["corpusId", "expectedHead", "targets"]
        : ["corpusId", "viewIds"];
    if (
        !request ||
        typeof request !== "object" ||
        Object.keys(request).some((key) => !allowed.includes(key))
    )
        throw new Error("Unsupported view maintenance request");
    assertViewIdentifier("corpus ID", request.corpusId);
    if ("targets" in request && !Array.isArray(request.targets))
        throw new Error("Maintenance targets must be an array");
    const viewIds =
        "targets" in request
            ? request.targets.map((target) => {
                  if (!target || typeof target !== "object")
                      throw new Error("Invalid maintenance target");
                  return target.viewId;
              })
            : request.viewIds;
    if (
        !Array.isArray(viewIds) ||
        !viewIds.length ||
        viewIds.length > 32 ||
        new Set(viewIds).size !== viewIds.length
    )
        throw new Error("Maintenance requires 1 to 32 distinct explicit views");
    viewIds.forEach((id) => assertViewIdentifier("view ID", id));
    if (!writing) return;
    if (!("targets" in request))
        throw new Error("Maintenance targets are required");
    if (
        request.expectedHead !== null &&
        !/^[0-9a-f]{40}$/.test(request.expectedHead)
    )
        throw new Error("Expected maintenance history head is required");
    for (const target of request.targets) {
        if (
            !target ||
            Object.keys(target).some(
                (key) => !["viewId", "expectedVersion"].includes(key),
            ) ||
            !Number.isSafeInteger(target.expectedVersion) ||
            target.expectedVersion < 1
        )
            throw new Error(
                "Maintenance requires exact existing target versions",
            );
    }
}
