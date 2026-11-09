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
    ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
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
    ATTR_VCS_REF_BASE_REVISION,
    ATTR_VCS_REF_HEAD_REVISION,
} from "@opentelemetry/semantic-conventions/incubating";

const PROCESS_INSTANCE_ID = randomUUID();
export const TYPEAGENT_PROCESS_NAME_ATTRIBUTE = "typeagent.process.name";

/**
 * Constructs the process-level OTel {@link Resource} TypeAgent-owned hosts
 * attach to their providers. This module only builds resource attributes; it
 * does not create or configure any provider.
 */

/** Options for {@link createProcessResource}. */
export interface ProcessResourceOptions {
    /** `service.name`. Required: every TypeAgent-owned process must set it. */
    readonly serviceName: string;
    /** Stable TypeAgent process role, such as `agent-server` or `shell`. */
    readonly processName?: string;
    /** `service.version`, when known. */
    readonly serviceVersion?: string;
    /** VCS revision checked out in the running build. */
    readonly headRevision?: string;
    /** VCS revision the running build is based on. */
    readonly baseRevision?: string;
    /** Unique identity for this running process. Defaults to a UUID. */
    readonly serviceInstanceId?: string;
    /** `deployment.environment.name`, when known. */
    readonly deploymentEnvironment?: string;
    /**
     * Additional caller-supplied resource attributes, e.g.
     * `deployment.environment`. These cannot override the required
     * service/process identity attributes below.
     */
    readonly attributes?: Readonly<Record<string, AttributeValue>>;
}

/**
 * Build the process-level OTel {@link Resource} for a TypeAgent-owned host:
 * `service.name` (required), optional service and deployment metadata, and the
 * current process's host, PID, runtime name, and runtime version.
 *
 * `options.attributes` is merged in first, so it can supply anything not
 * covered above (e.g. `deployment.environment`) but cannot override the
 * identity attributes this function sets.
 *
 * @throws {Error} if a supplied string attribute is empty or all whitespace.
 */
export function createProcessResource(
    options: ProcessResourceOptions,
): Resource {
    const serviceName = requireNonEmpty(options.serviceName, "serviceName");
    const serviceVersion = normalizeOptional(
        options.serviceVersion,
        "serviceVersion",
    );
    const processName = normalizeOptional(options.processName, "processName");
    const serviceInstanceId =
        normalizeOptional(options.serviceInstanceId, "serviceInstanceId") ??
        PROCESS_INSTANCE_ID;
    const deploymentEnvironment = normalizeOptional(
        options.deploymentEnvironment,
        "deploymentEnvironment",
    );
    const headRevision = normalizeOptional(
        options.headRevision,
        "headRevision",
    );
    const baseRevision = normalizeOptional(
        options.baseRevision,
        "baseRevision",
    );

    const identity: Record<string, AttributeValue> = {
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SERVICE_INSTANCE_ID]: serviceInstanceId,
        [ATTR_HOST_NAME]: os.hostname(),
        [ATTR_OS_TYPE]: normalizeOsType(process.platform),
        [ATTR_PROCESS_PID]: process.pid,
        [ATTR_PROCESS_RUNTIME_NAME]: "nodejs",
        [ATTR_PROCESS_RUNTIME_VERSION]: process.versions.node,
    };
    if (serviceVersion !== undefined) {
        identity[ATTR_SERVICE_VERSION] = serviceVersion;
    }
    if (processName !== undefined) {
        identity[TYPEAGENT_PROCESS_NAME_ATTRIBUTE] = processName;
    }
    if (deploymentEnvironment !== undefined) {
        identity[ATTR_DEPLOYMENT_ENVIRONMENT_NAME] = deploymentEnvironment;
    }
    if (headRevision !== undefined) {
        identity[ATTR_VCS_REF_HEAD_REVISION] = headRevision;
    }
    if (baseRevision !== undefined) {
        identity[ATTR_VCS_REF_BASE_REVISION] = baseRevision;
    }

    const attributes = { ...options.attributes };
    for (const key of [
        ATTR_SERVICE_NAME,
        ATTR_SERVICE_INSTANCE_ID,
        ATTR_SERVICE_VERSION,
        ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
        ATTR_HOST_NAME,
        ATTR_OS_TYPE,
        ATTR_PROCESS_PID,
        ATTR_PROCESS_RUNTIME_NAME,
        ATTR_PROCESS_RUNTIME_VERSION,
        ATTR_VCS_REF_HEAD_REVISION,
        ATTR_VCS_REF_BASE_REVISION,
        TYPEAGENT_PROCESS_NAME_ATTRIBUTE,
    ]) {
        delete attributes[key];
    }

    return resourceFromAttributes({
        ...attributes,
        ...identity,
    });
}

function requireNonEmpty(value: string, optionName: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) {
        throw new Error(
            `createProcessResource requires a non-empty '${optionName}'.`,
        );
    }
    return normalized;
}

function normalizeOptional(
    value: string | undefined,
    optionName: string,
): string | undefined {
    return value === undefined ? undefined : requireNonEmpty(value, optionName);
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
