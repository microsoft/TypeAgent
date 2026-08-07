// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as os from "node:os";

import {
    ATTR_SERVICE_INSTANCE_ID,
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import {
    ATTR_HOST_NAME,
    ATTR_OS_TYPE,
    ATTR_PROCESS_PID,
    ATTR_PROCESS_RUNTIME_NAME,
    ATTR_PROCESS_RUNTIME_VERSION,
} from "@opentelemetry/semantic-conventions/incubating";

import { createProcessResource } from "../src/otel/resources.js";

describe("createProcessResource", () => {
    it("sets required service and process identity attributes", () => {
        const resource = createProcessResource({ serviceName: "my-service" });

        expect(resource.attributes[ATTR_SERVICE_NAME]).toBe("my-service");
        expect(resource.attributes[ATTR_SERVICE_INSTANCE_ID]).toEqual(
            expect.any(String),
        );
        expect(resource.attributes[ATTR_HOST_NAME]).toBe(os.hostname());
        expect(resource.attributes[ATTR_OS_TYPE]).toBe(
            process.platform === "win32"
                ? "windows"
                : process.platform === "sunos"
                  ? "solaris"
                  : process.platform,
        );
        expect(resource.attributes[ATTR_PROCESS_PID]).toBe(process.pid);
        expect(resource.attributes[ATTR_PROCESS_RUNTIME_NAME]).toBe("nodejs");
        expect(resource.attributes[ATTR_PROCESS_RUNTIME_VERSION]).toBe(
            process.versions.node,
        );
        expect(resource.attributes[ATTR_SERVICE_VERSION]).toBeUndefined();
    });

    it("sets the optional service version when provided", () => {
        const resource = createProcessResource({
            serviceName: "my-service",
            serviceVersion: "1.2.3",
        });

        expect(resource.attributes[ATTR_SERVICE_VERSION]).toBe("1.2.3");
    });

    it("uses a caller-provided service instance ID", () => {
        const resource = createProcessResource({
            serviceName: "my-service",
            serviceInstanceId: "instance-1",
        });

        expect(resource.attributes[ATTR_SERVICE_INSTANCE_ID]).toBe(
            "instance-1",
        );
    });

    it("reuses the default service instance ID within the process", () => {
        const first = createProcessResource({ serviceName: "first" });
        const second = createProcessResource({ serviceName: "second" });

        expect(first.attributes[ATTR_SERVICE_INSTANCE_ID]).toBe(
            second.attributes[ATTR_SERVICE_INSTANCE_ID],
        );
    });

    it("merges caller-supplied attributes", () => {
        const resource = createProcessResource({
            serviceName: "my-service",
            attributes: { "deployment.environment": "test" },
        });

        expect(resource.attributes["deployment.environment"]).toBe("test");
        expect(resource.attributes[ATTR_SERVICE_NAME]).toBe("my-service");
    });

    it("does not allow caller-supplied attributes to override identity attributes", () => {
        const resource = createProcessResource({
            serviceName: "my-service",
            attributes: {
                [ATTR_SERVICE_NAME]: "spoofed-service",
                [ATTR_SERVICE_VERSION]: "spoofed-version",
                [ATTR_PROCESS_PID]: -1,
                [ATTR_PROCESS_RUNTIME_NAME]: "spoofed-runtime",
                [ATTR_PROCESS_RUNTIME_VERSION]: "0.0.0",
            },
        });

        expect(resource.attributes[ATTR_SERVICE_NAME]).toBe("my-service");
        expect(resource.attributes[ATTR_SERVICE_VERSION]).toBeUndefined();
        expect(resource.attributes[ATTR_PROCESS_PID]).toBe(process.pid);
        expect(resource.attributes[ATTR_PROCESS_RUNTIME_NAME]).toBe("nodejs");
        expect(resource.attributes[ATTR_PROCESS_RUNTIME_VERSION]).toBe(
            process.versions.node,
        );
    });

    it("throws for an empty or all-whitespace service name", () => {
        expect(() => createProcessResource({ serviceName: "" })).toThrow();
        expect(() => createProcessResource({ serviceName: "   " })).toThrow();
    });
});
