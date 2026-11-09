// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ViewExtensionProvider } from "./viewExtensionTypes.js";
import { ViewExtensionRegistry } from "./viewExtensions.js";

export const memoryViewManifestExport = "./memory/views/manifest";
export const memoryViewProviderExport = "./memory/views/provider";

export interface MemoryViewPackManifest {
    schemaVersion: 1;
    packId: string;
    files: string[];
    providers: Array<{ providerId: string; factory: string }>;
}

export interface MemoryViewPackageInstallation {
    schemaVersion: 1;
    packageRoot: string;
    packageName: string;
    packageVersion: string;
    packId: string;
    fingerprint: string;
    manifest: MemoryViewPackManifest;
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Expected a memory-view package object");
    return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, expected: string[]): void {
    if (
        Object.keys(value).length !== expected.length ||
        expected.some(
            (key) => !Object.prototype.hasOwnProperty.call(value, key),
        )
    )
        throw new Error("Invalid memory-view manifest fields");
}

function identifier(value: unknown): string {
    if (
        typeof value !== "string" ||
        !/^[A-Za-z][A-Za-z0-9_.-]{0,199}$/.test(value)
    )
        throw new Error("Invalid memory-view pack/provider identifier");
    return value;
}

function relativeFile(value: unknown): string {
    if (
        typeof value !== "string" ||
        !value ||
        value.length > 1000 ||
        /[\\:\u0000-\u001f]/.test(value) ||
        value.startsWith("/") ||
        value.split("/").some((part) => !part || part === "." || part === "..")
    )
        throw new Error("Memory-view assets must be contained relative files");
    return value;
}

export function parseMemoryViewManifest(
    value: unknown,
): MemoryViewPackManifest {
    const manifest = object(value);
    keys(manifest, ["schemaVersion", "packId", "files", "providers"]);
    if (
        manifest.schemaVersion !== 1 ||
        !Array.isArray(manifest.files) ||
        !manifest.files.length ||
        manifest.files.length > 256 ||
        !Array.isArray(manifest.providers) ||
        !manifest.providers.length ||
        manifest.providers.length > 64
    )
        throw new Error("Unsupported or oversized memory-view manifest");
    const files = manifest.files.map(relativeFile).sort();
    const providers = manifest.providers.map((entry: unknown) => {
        const provider = object(entry);
        keys(provider, ["providerId", "factory"]);
        const factory = identifier(provider.factory);
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(factory))
            throw new Error("Invalid memory-view factory export");
        return { providerId: identifier(provider.providerId), factory };
    });
    if (
        new Set(files).size !== files.length ||
        new Set(providers.map((entry) => entry.providerId)).size !==
            providers.length ||
        new Set(providers.map((entry) => entry.factory)).size !==
            providers.length
    )
        throw new Error("Duplicate memory-view assets or providers");
    return {
        schemaVersion: 1,
        packId: identifier(manifest.packId),
        files,
        providers,
    };
}

async function containedFile(root: string, relative: string): Promise<string> {
    const resolved = await realpath(path.join(root, ...relative.split("/")));
    const remaining = path.relative(root, resolved);
    if (
        !remaining ||
        remaining.startsWith(`..${path.sep}`) ||
        remaining === ".." ||
        path.isAbsolute(remaining) ||
        !(await stat(resolved)).isFile()
    )
        throw new Error("Memory-view asset escapes its installed package");
    return resolved;
}

function exportFile(
    packageJson: Record<string, unknown>,
    name: string,
): string {
    const exports = object(packageJson.exports);
    const value = exports[name];
    if (typeof value !== "string" || !value.startsWith("./"))
        throw new Error(`Memory-view package requires static export '${name}'`);
    return relativeFile(value.slice(2));
}

export async function inspectMemoryViewPackage(
    directory: string,
): Promise<MemoryViewPackageInstallation> {
    if (!path.isAbsolute(directory))
        throw new Error("Memory-view package root must be absolute");
    const root = await realpath(directory);
    const packageText = await readFile(
        await containedFile(root, "package.json"),
        "utf8",
    );
    const packageJson = object(JSON.parse(packageText));
    if (
        typeof packageJson.name !== "string" ||
        !packageJson.name.trim() ||
        typeof packageJson.version !== "string" ||
        !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(packageJson.version) ||
        !/^(?:@[-a-z0-9._]+\/)?[-a-z0-9._]+$/.test(packageJson.name)
    )
        throw new Error(
            "Memory-view package needs a valid npm name and version",
        );
    const manifestFile = exportFile(packageJson, memoryViewManifestExport);
    const providerFile = exportFile(packageJson, memoryViewProviderExport);
    if (
        !providerFile.endsWith(".mjs") &&
        !(providerFile.endsWith(".js") && packageJson.type === "module")
    )
        throw new Error("Memory-view provider export must be an ESM module");
    const manifestText = await readFile(
        await containedFile(root, manifestFile),
        "utf8",
    );
    const manifest = parseMemoryViewManifest(JSON.parse(manifestText));
    if (!manifest.files.includes(providerFile))
        throw new Error(
            "Memory-view provider module must be a fingerprinted asset",
        );
    const hash = createHash("sha256").update(
        JSON.stringify([packageText, manifestText]),
    );
    let total =
        Buffer.byteLength(packageText) + Buffer.byteLength(manifestText);
    for (const file of manifest.files) {
        const filename = await containedFile(root, file);
        const size = (await stat(filename)).size;
        total += size;
        if (total > 32 * 1024 * 1024)
            throw new Error("Memory-view package asset bound exceeded");
        hash.update(JSON.stringify(file)).update(await readFile(filename));
    }
    return {
        schemaVersion: 1,
        packageRoot: root,
        packageName: packageJson.name,
        packageVersion: packageJson.version,
        packId: manifest.packId,
        fingerprint: hash.digest("hex"),
        manifest,
    };
}

const loadedRoots = new Map<string, string>();

export async function loadMemoryViewPackage(
    installation: MemoryViewPackageInstallation,
    selections: Array<{ providerId: string; context: unknown }>,
): Promise<ViewExtensionProvider[]> {
    if (!selections.length || selections.length > 64)
        throw new Error("Explicit memory-view provider selection is required");
    const current = await inspectMemoryViewPackage(installation.packageRoot);
    if (
        current.fingerprint !== installation.fingerprint ||
        current.packageName !== installation.packageName ||
        current.packageVersion !== installation.packageVersion ||
        JSON.stringify(current.manifest) !==
            JSON.stringify(installation.manifest)
    )
        throw new Error(
            "Installed memory-view package changed; update explicitly",
        );
    const entries = selections.map((selection) => {
        const entry = current.manifest.providers.find(
            (provider) => provider.providerId === selection.providerId,
        );
        if (!entry)
            throw new Error("Selected memory-view provider is not installed");
        return entry;
    });
    if (
        new Set(entries.map((entry) => entry.providerId)).size !==
        entries.length
    )
        throw new Error("Duplicate memory-view provider selection");
    const previous = loadedRoots.get(current.packageRoot);
    if (previous !== undefined && previous !== current.fingerprint)
        throw new Error("Changed memory-view package requires host restart");
    const packageJson = object(
        JSON.parse(
            await readFile(
                path.join(current.packageRoot, "package.json"),
                "utf8",
            ),
        ),
    );
    const filename = await containedFile(
        current.packageRoot,
        exportFile(packageJson, memoryViewProviderExport),
    );
    const module: Record<string, unknown> = await import(
        pathToFileURL(filename).href
    );
    loadedRoots.set(current.packageRoot, current.fingerprint);
    const providers: ViewExtensionProvider[] = [];
    for (let index = 0; index < entries.length; index++) {
        const factory = module[entries[index].factory];
        if (typeof factory !== "function")
            throw new Error(
                "Memory-view provider factory export is unavailable",
            );
        const value: unknown = await factory(selections[index].context);
        const provider = object(value);
        for (const method of [
            "authorize",
            "evaluateEligibility",
            "prepare",
            "generate",
        ])
            if (typeof provider[method] !== "function")
                throw new Error(`Memory-view provider requires '${method}'`);
        const descriptor = object(provider.descriptor);
        if (
            object(descriptor.identity).providerId !== entries[index].providerId
        )
            throw new Error(
                "Memory-view factory returned a different provider",
            );
        providers.push(value as ViewExtensionProvider);
    }
    new ViewExtensionRegistry(providers);
    return providers;
}
