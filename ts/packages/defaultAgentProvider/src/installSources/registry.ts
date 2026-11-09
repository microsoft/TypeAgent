// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createInstallSourceRegistry as createSharedRegistry,
    createPackageInstallSource,
    type InstallSourceFactory,
    type RegistryDeps,
} from "@typeagent/package-installation/sources/registry";
import type { InstallSourceConfig } from "./config.js";
import { createMcpConfigSource } from "./mcpConfigSource.js";
import { createMcpRegistrySource } from "./mcpRegistrySource.js";

export * from "@typeagent/package-installation/sources/registry";

export function createInstallSourceRegistry(
    configs: InstallSourceConfig[],
    deps: RegistryDeps,
    sourceFactory?: InstallSourceFactory,
) {
    return createSharedRegistry(
        configs,
        deps,
        sourceFactory ??
            ((config) => {
                if (config.kind === "mcp-config")
                    return createMcpConfigSource(config);
                if (config.kind === "registry")
                    return createMcpRegistrySource(config, {
                        installDir: deps.installDir,
                    });
                return createPackageInstallSource(config, deps);
            }),
    );
}
