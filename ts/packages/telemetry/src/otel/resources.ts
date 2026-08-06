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
} from "@opentelemetry/semantic-conventions/incubating";

const PROCESS_INSTANCE_ID = randomUUID();
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
    /** `deployment.environment.name`, when known. */
    readonly deploymentEnvironment?: string;
    /**
     * Additional caller-supplied resource attributes. These cannot override
     * the service or process attributes defined by this helper.
     */
    readonly attributes?: Readonly<Record<string, AttributeValue>>;
}

/**
 * Build the process-level OTel {@link Resource} for a TypeAgent-owned host:
 * `service.name` (required), optional service and deployment metadata, and the
 * current process's host, PID, runtime name, and runtime version.
 *
 * `options.attributes` is merged in first, so it can supply anything not
 * covered above but cannot override the process attributes this function sets.
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
    const serviceInstanceId =
        normalizeOptional(options.serviceInstanceId, "serviceInstanceId") ??
        PROCESS_INSTANCE_ID;
    const deploymentEnvironment = normalizeOptional(
        options.deploymentEnvironment,
        "deploymentEnvironment",
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
    if (deploymentEnvironment !== undefined) {
        identity[ATTR_DEPLOYMENT_ENVIRONMENT_NAME] = deploymentEnvironment;
    }

    const attributes = { ...options.attributes };
    for (const key of [
        ATTR_SERVICE_NAME,
        ATTR_SERVICE_INSTANCE_ID,
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
