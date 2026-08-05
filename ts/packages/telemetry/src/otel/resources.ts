// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AttributeValue } from "@opentelemetry/api";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import {
    resourceFromAttributes,
    type Resource,
} from "@opentelemetry/resources";
import {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_INSTANCE_ID,
    ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import {
    ATTR_HOST_NAME,
    ATTR_OS_TYPE,
    ATTR_PROCESS_PID,
    ATTR_PROCESS_RUNTIME_NAME,
    ATTR_PROCESS_RUNTIME_VERSION,
} from "@opentelemetry/semantic-conventions/incubating";

/**
 * Constructs the process-level OTel {@link Resource} TypeAgent-owned hosts
 * attach to their providers. This module only builds resource attributes; it
 * does not create or configure any provider.
 */

/** Options for {@link createProcessResource}. */
export interface ProcessResourceOptions {
    /** `service.name`. Required: every TypeAgent-owned process must set it. */
    readonly serviceName: string;
    /** `service.version`, when known. */
    readonly serviceVersion?: string;
    /** Unique identity for this running process. Defaults to a UUID. */
    readonly serviceInstanceId?: string;
    /**
     * Additional caller-supplied resource attributes, e.g.
     * `deployment.environment`. These cannot override the required
     * service/process identity attributes below.
     */
    readonly attributes?: Readonly<Record<string, AttributeValue>>;
}

/**
 * Build the process-level OTel {@link Resource} for a TypeAgent-owned host:
 * `service.name` (required), `service.version` (optional), and the current
 * process's PID, runtime name, and runtime version.
 *
 * `options.attributes` is merged in first, so it can supply anything not
 * covered above (e.g. `deployment.environment`) but cannot override the
 * identity attributes this function sets.
 *
 * @throws {Error} if `serviceName` is empty or all whitespace.
 */
export function createProcessResource(
    options: ProcessResourceOptions,
): Resource {
    const serviceName = options.serviceName.trim();
    if (serviceName.length === 0) {
        throw new Error(
            "createProcessResource requires a non-empty 'serviceName'.",
        );
    }

    const identity: Record<string, AttributeValue> = {
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SERVICE_INSTANCE_ID]:
            options.serviceInstanceId?.trim() || randomUUID(),
        [ATTR_HOST_NAME]: os.hostname(),
        [ATTR_OS_TYPE]: normalizeOsType(process.platform),
        [ATTR_PROCESS_PID]: process.pid,
        [ATTR_PROCESS_RUNTIME_NAME]: "nodejs",
        [ATTR_PROCESS_RUNTIME_VERSION]: process.versions.node,
    };
    if (options.serviceVersion !== undefined) {
        identity[ATTR_SERVICE_VERSION] = options.serviceVersion;
    }

    const attributes = { ...options.attributes };
    for (const key of [
        ATTR_SERVICE_NAME,
        ATTR_SERVICE_INSTANCE_ID,
        ATTR_SERVICE_VERSION,
        ATTR_HOST_NAME,
        ATTR_OS_TYPE,
        ATTR_PROCESS_PID,
        ATTR_PROCESS_RUNTIME_NAME,
        ATTR_PROCESS_RUNTIME_VERSION,
    ]) {
        delete attributes[key];
    }

    return resourceFromAttributes({
        ...attributes,
        ...identity,
    });
}

function normalizeOsType(platform: NodeJS.Platform): string {
    switch (platform) {
        case "win32":
            return "windows";
        case "sunos":
            return "solaris";
        default:
            return platform;
    }
}
