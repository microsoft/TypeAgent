// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
    EnvValue,
    NormalizedMcpServerConfig,
} from "../mcp/mcpServerConfig.js";
import type {
    RegistryArgument,
    RegistryInput,
    RegistryKeyValue,
    RegistryPackage,
} from "./mcpRegistryClient.js";

const execFileAsync = promisify(execFile);
export const MCP_INSTALL_ROOTS_SUBDIR = "mcp";

export interface RegistryNpmInstallArgs {
    spec: string;
    cwd: string;
    registry: string;
    signal?: AbortSignal;
}

export interface RegistryMaterializerDeps {
    installDir: string;
    fetchFn?: typeof fetch;
    npmInstall?: (args: RegistryNpmInstallArgs) => Promise<void>;
    randomId?: () => string;
    npxCliPath?: string;
}

function findNpxCli(): string {
    const candidates =
        process.platform === "win32"
            ? [
                  path.resolve(
                      path.dirname(process.execPath),
                      "node_modules",
                      "npm",
                      "bin",
                      "npx-cli.js",
                  ),
              ]
            : [
                  path.resolve(
                      path.dirname(process.execPath),
                      "..",
                      "lib",
                      "node_modules",
                      "npm",
                      "bin",
                      "npx-cli.js",
                  ),
              ];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (found === undefined) {
        throw new Error(
            "Could not locate the npm npx CLI required by registry runtimeHint 'npx'",
        );
    }
    return found;
}

function inputValue(
    input: RegistryInput,
    name: string,
): string | { kind: "input"; name: string } {
    const value = input.value ?? input.default;
    return value === undefined ? { kind: "input", name } : value;
}

function convertTemplate(
    value: string,
    variables: Record<string, RegistryInput> | undefined,
): EnvValue {
    if (variables === undefined) {
        return value;
    }
    return {
        value,
        variables: Object.fromEntries(
            Object.entries(variables).map(([name, input]) => [
                name,
                inputValue(input, name),
            ]),
        ),
    };
}

export function registryArgumentsToArgv(
    args: RegistryArgument[] | undefined,
): EnvValue[] {
    const argv: EnvValue[] = [];
    for (const arg of args ?? []) {
        const inputName = arg.valueHint ?? arg.name ?? "argument";
        const raw = inputValue(arg, inputName);
        const value =
            typeof raw === "string" ? convertTemplate(raw, arg.variables) : raw;
        if (arg.type === "named") {
            if (arg.name === undefined) {
                throw new Error("Registry named argument is missing its name");
            }
            argv.push(arg.name);
            if (!(arg.format === "boolean" && raw === "true")) {
                argv.push(value);
            }
        } else if (arg.type === "positional") {
            argv.push(value);
        } else {
            throw new Error(`Unsupported registry argument type '${arg.type}'`);
        }
    }
    return argv;
}

export function registryEnvironment(
    entries: RegistryKeyValue[] | undefined,
): Record<string, EnvValue> | undefined {
    if (entries === undefined) return undefined;
    return Object.fromEntries(
        entries.map((entry) => {
            const raw = inputValue(entry, entry.name);
            return [
                entry.name,
                typeof raw === "string"
                    ? convertTemplate(raw, entry.variables)
                    : raw,
            ];
        }),
    );
}

async function defaultNpmInstall(args: RegistryNpmInstallArgs): Promise<void> {
    const npmArgs = [
        "install",
        args.spec,
        "--save=false",
        "--ignore-scripts",
        "--registry",
        args.registry,
    ];
    if (process.platform === "win32") {
        const npmCli = path.resolve(
            path.dirname(process.execPath),
            "node_modules",
            "npm",
            "bin",
            "npm-cli.js",
        );
        if (!fs.existsSync(npmCli)) {
            throw new Error(
                `Could not locate npm CLI at '${npmCli}' for registry package installation`,
            );
        }
        await execFileAsync(process.execPath, [npmCli, ...npmArgs], {
            cwd: args.cwd,
            signal: args.signal,
        });
        return;
    }
    await execFileAsync("npm", npmArgs, {
        cwd: args.cwd,
        signal: args.signal,
    });
}

function packageUrl(registry: string, identifier: string): URL {
    const encoded = identifier.startsWith("@")
        ? identifier.replaceAll("/", "%2F")
        : encodeURIComponent(identifier);
    return new URL(encoded, registry.endsWith("/") ? registry : `${registry}/`);
}

function safeLeaf(value: string): string {
    return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function validateOwnedRoot(installDir: string, candidate: string): string {
    const root = path.resolve(installDir, MCP_INSTALL_ROOTS_SUBDIR);
    const resolved = path.resolve(candidate);
    if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`Invalid owned MCP install path '${candidate}'`);
    }
    return resolved;
}

function readPackageBin(
    root: string,
    identifier: string,
    version: string,
): string {
    const packageDir = path.resolve(root, "node_modules", identifier);
    const installedPackageJson = JSON.parse(
        fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
    ) as {
        name?: string;
        version?: string;
        bin?: string | Record<string, string>;
    };
    if (
        installedPackageJson.name !== undefined &&
        installedPackageJson.name !== identifier
    ) {
        throw new Error(
            `Installed npm package name '${installedPackageJson.name}' does not match '${identifier}'`,
        );
    }
    if (
        installedPackageJson.version !== undefined &&
        installedPackageJson.version !== version
    ) {
        throw new Error(
            `Installed npm package version '${installedPackageJson.version}' does not match '${version}'`,
        );
    }
    const bin =
        typeof installedPackageJson.bin === "string"
            ? installedPackageJson.bin
            : Object.values(installedPackageJson.bin ?? {})[0];
    if (bin === undefined) {
        throw new Error(`npm package '${identifier}' declares no executable`);
    }
    const binPath = path.resolve(packageDir, bin);
    if (!binPath.startsWith(`${packageDir}${path.sep}`)) {
        throw new Error(`npm package '${identifier}' has an unsafe bin path`);
    }
    return binPath;
}

export function cleanupOwnedMcpPaths(
    installDir: string,
    ownedPaths: readonly string[] | undefined,
): void {
    for (const ownedPath of ownedPaths ?? []) {
        fs.rmSync(validateOwnedRoot(installDir, ownedPath), {
            recursive: true,
            force: true,
        });
    }
}

export async function materializeRegistryNpmPackage(
    config: NormalizedMcpServerConfig,
    pkg: RegistryPackage,
    descriptorDigest: string,
    deps: RegistryMaterializerDeps,
    signal?: AbortSignal,
): Promise<NormalizedMcpServerConfig> {
    if (pkg.registryType !== "npm") {
        throw new Error(
            `Unsupported registry package type '${pkg.registryType}'`,
        );
    }
    if (pkg.version === undefined) {
        throw new Error(
            `Registry npm package '${pkg.identifier}' has no exact version`,
        );
    }
    if (
        !/^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(
            pkg.identifier,
        )
    ) {
        throw new Error(
            `Invalid registry npm package name '${pkg.identifier}'`,
        );
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(pkg.version)) {
        throw new Error(
            `Invalid registry npm package version '${pkg.version}'`,
        );
    }
    const runtimeHint = pkg.runtimeHint ?? "npx";
    if (runtimeHint !== "npx" && runtimeHint !== "node") {
        throw new Error(`Unsupported registry runtime hint '${runtimeHint}'`);
    }
    const runtimeArguments = registryArgumentsToArgv(pkg.runtimeArguments);
    const packageArguments = registryArgumentsToArgv(pkg.packageArguments);
    const environment = registryEnvironment(pkg.environmentVariables);
    const registry = pkg.registryBaseUrl ?? "https://registry.npmjs.org/";
    const fetchFn = deps.fetchFn ?? fetch;
    const packumentResponse = await fetchFn(
        packageUrl(registry, pkg.identifier),
        {
            headers: { accept: "application/json" },
            ...(signal === undefined ? {} : { signal }),
        },
    );
    if (!packumentResponse.ok) {
        throw new Error(
            `Could not resolve npm package '${pkg.identifier}@${pkg.version}' (${packumentResponse.status})`,
        );
    }
    const packument = (await packumentResponse.json()) as {
        versions?: Record<
            string,
            {
                dist?: { tarball?: string };
                bin?: string | Record<string, string>;
            }
        >;
    };
    const manifest = packument.versions?.[pkg.version];
    const tarball = manifest?.dist?.tarball;
    if (manifest === undefined || typeof tarball !== "string") {
        throw new Error(
            `npm package '${pkg.identifier}' has no published version '${pkg.version}'`,
        );
    }
    const tarballResponse = await fetchFn(tarball, {
        ...(signal === undefined ? {} : { signal }),
    });
    if (!tarballResponse.ok) {
        throw new Error(
            `Could not download npm package '${pkg.identifier}@${pkg.version}' (${tarballResponse.status})`,
        );
    }
    const bytes = Buffer.from(await tarballResponse.arrayBuffer());
    const packageHash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (
        pkg.fileSha256 !== undefined &&
        packageHash.toLowerCase() !== pkg.fileSha256.toLowerCase()
    ) {
        throw new Error(
            `SHA-256 mismatch for '${pkg.identifier}@${pkg.version}': expected ${pkg.fileSha256}, got ${packageHash}`,
        );
    }
    const rootsDir = path.join(deps.installDir, MCP_INSTALL_ROOTS_SUBDIR);
    const leaf = `${safeLeaf(pkg.identifier)}@${safeLeaf(pkg.version)}-${descriptorDigest.slice(0, 16)}`;
    const finalRoot = validateOwnedRoot(
        deps.installDir,
        path.join(rootsDir, leaf),
    );
    if (!fs.existsSync(path.join(finalRoot, "node_modules", pkg.identifier))) {
        fs.mkdirSync(rootsDir, { recursive: true });
        const randomId =
            deps.randomId?.() ??
            `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const tempRoot = validateOwnedRoot(
            deps.installDir,
            path.join(rootsDir, `.tmp-${safeLeaf(randomId)}`),
        );
        fs.mkdirSync(tempRoot, { recursive: true });
        const tarPath = path.join(tempRoot, "package.tgz");
        try {
            fs.writeFileSync(
                path.join(tempRoot, "package.json"),
                JSON.stringify({ private: true }),
            );
            fs.writeFileSync(tarPath, bytes);
            await (deps.npmInstall ?? defaultNpmInstall)({
                spec: tarPath,
                cwd: tempRoot,
                registry,
                ...(signal === undefined ? {} : { signal }),
            });
            if (
                !fs.existsSync(
                    path.join(tempRoot, "node_modules", pkg.identifier),
                )
            ) {
                throw new Error(
                    `npm install did not materialize '${pkg.identifier}@${pkg.version}'`,
                );
            }
            readPackageBin(tempRoot, pkg.identifier, pkg.version);
            fs.rmSync(tarPath, { force: true });
            if (fs.existsSync(finalRoot)) {
                fs.rmSync(tempRoot, { recursive: true, force: true });
            } else {
                fs.renameSync(tempRoot, finalRoot);
            }
        } catch (error) {
            fs.rmSync(tempRoot, { recursive: true, force: true });
            throw error;
        }
    }
    const binPath = readPackageBin(finalRoot, pkg.identifier, pkg.version);
    const packageDir = path.resolve(finalRoot, "node_modules", pkg.identifier);
    const args =
        runtimeHint === "npx"
            ? [
                  deps.npxCliPath ?? findNpxCli(),
                  ...runtimeArguments,
                  "--offline",
                  "--no-install",
                  pkg.identifier,
                  ...packageArguments,
              ]
            : [...runtimeArguments, binPath, ...packageArguments];
    return {
        ...config,
        transport: {
            kind: "stdio",
            command: process.execPath,
            args,
            ...(environment === undefined
                ? {}
                : {
                      env: environment as Record<string, EnvValue>,
                  }),
            cwd: packageDir,
        },
        provenance: {
            ...config.provenance,
            ownedPaths: [finalRoot],
            packageIdentifier: pkg.identifier,
            packageVersion: pkg.version,
            packageHash,
        },
    };
}
