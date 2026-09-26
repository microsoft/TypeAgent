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
    if (arch !== "x64" && arch !== "arm64") {
        throw new Error(`Unsupported Copilot runtime architecture: ${arch}.`);
    }
    if (
        platform !== "win32" &&
        platform !== "darwin" &&
        platform !== "linux" &&
        platform !== "linuxmusl"
    ) {
        throw new Error(
            `Unsupported Copilot runtime platform: ${platform}-${arch}.`,
        );
    }
    return `@github/copilot-sdk-${platform}-${arch}`;
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
    const runtimeVersion = sdk.copilotCliVersion;
    if (
        typeof sdk.version !== "string" ||
        typeof runtimeVersion !== "string" ||
        !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(runtimeVersion)
    ) {
        throw new Error(
            "@github/copilot-sdk must declare a concrete copilotCliVersion.",
        );
    }

    const platformPackage = copilotPlatformPackage(platform, arch);
    const platformVersion = sdk.optionalDependencies?.[platformPackage];
    if (platformVersion !== sdk.version) {
        throw new Error(
            `${platformPackage} must resolve to ${sdk.version}; found ${platformVersion ?? "nothing"}.`,
        );
    }
    const runtimePlatform = `${platform}-${arch}`;
    const prebuildDirectory = `prebuilds/${runtimePlatform}`;

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
        schemaVersion: 2,
        sdkPackage: "@github/copilot-sdk",
        sdkVersion: sdk.version,
        runtimeVersion,
        runtimePlatform,
        platformPackage,
        platformVersion,
        executablePath: `${prebuildDirectory}/${platform === "win32" ? "copilot-runtime.exe" : "copilot-runtime"}`,
        runtimeLibraryPath: `${prebuildDirectory}/runtime.node`,
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
