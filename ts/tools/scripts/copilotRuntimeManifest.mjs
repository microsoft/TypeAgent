#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const tsRoot = path.resolve(scriptsDir, "..", "..");

function readPackage(packageJsonPath, expectedName) {
    if (!fs.existsSync(packageJsonPath)) {
        throw new Error(`Could not locate package.json for ${expectedName}.`);
    }
    const metadata = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    if (metadata.name !== expectedName) {
        throw new Error(
            `Expected ${expectedName} metadata at ${packageJsonPath}.`,
        );
    }
    return { path: packageJsonPath, metadata };
}

export function copilotPlatformPackage(platform, arch) {
    const normalizedArch = arch === "ia32" ? "x64" : arch;
    const suffix =
        platform === "linux"
            ? `linux-${normalizedArch}`
            : `${platform}-${normalizedArch}`;
    return `@github/copilot-${suffix}`;
}

export function createCopilotRuntimeManifest({
    platform = process.platform,
    arch = process.arch,
    registry,
} = {}) {
    const sdkLink = path.join(
        tsRoot,
        "packages",
        "agentServer",
        "bundledRuntime",
        "node_modules",
        "@github",
        "copilot-sdk",
    );
    const sdkDirectory = fs.realpathSync(sdkLink);
    const sdk = readPackage(
        path.join(sdkDirectory, "package.json"),
        "@github/copilot-sdk",
    ).metadata;
    const cliRequirement = sdk.dependencies?.["@github/copilot"];
    if (typeof sdk.version !== "string" || typeof cliRequirement !== "string") {
        throw new Error(
            "@github/copilot-sdk must declare an @github/copilot dependency.",
        );
    }

    const cli = readPackage(
        path.join(path.dirname(sdkDirectory), "copilot", "package.json"),
        "@github/copilot",
    ).metadata;
    const cliVersion = cli.version;
    if (
        typeof cliVersion !== "string" ||
        !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(cliVersion)
    ) {
        throw new Error(
            "The resolved @github/copilot version is not concrete.",
        );
    }

    const platformPackage = copilotPlatformPackage(platform, arch);
    const platformVersion = cli.optionalDependencies?.[platformPackage];
    if (platformVersion !== cliVersion) {
        throw new Error(
            `${platformPackage} must resolve to ${cliVersion}; found ${platformVersion ?? "nothing"}.`,
        );
    }

    const feedConfig = JSON.parse(
        fs.readFileSync(
            path.join(
                tsRoot,
                "tools",
                "installers",
                "common",
                "package-feed.json",
            ),
            "utf8",
        ),
    );
    const resolvedRegistry =
        registry ?? process.env.TYPEAGENT_FEED_REGISTRY ?? feedConfig.registry;
    if (
        typeof resolvedRegistry !== "string" ||
        !resolvedRegistry.startsWith("https://")
    ) {
        throw new Error("A valid HTTPS TypeAgent npm feed is required.");
    }

    return {
        schemaVersion: 1,
        sdkPackage: "@github/copilot-sdk",
        sdkVersion: sdk.version,
        sdkCliRequirement: cliRequirement,
        cliPackage: "@github/copilot",
        cliVersion,
        platformPackage,
        platformVersion,
        registry: resolvedRegistry,
        azureDevOpsResource: feedConfig.azureDevOpsResource,
    };
}

export function writeCopilotRuntimeManifest(outputPath, options) {
    const manifest = createCopilotRuntimeManifest(options);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
}
