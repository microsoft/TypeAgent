// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const semver = require("semver");
const yaml = require("js-yaml");
const tsRoot = fileURLToPath(new URL("../../../", import.meta.url));
const repo = path.dirname(tsRoot);
const pinnedBuildVersion = "24.22.1";
const supportedVersions = ["22.23.4", pinnedBuildVersion, "26.12.1"];
const typesVersion = "22.20.5";
const read = (file) => fs.readFileSync(path.join(repo, file), "utf8");
const nodeRange = JSON.parse(read("ts/package.json")).engines.node;
const lock = yaml.load(read("ts/pnpm-lock.yaml"));
const cases = [
    ["18.20.8", false],
    ["20.20.1", false],
    ["21.7.3", false],
    ["22.23.3", false],
    ["22.23.4", true],
    ["22.24.0", true],
    ["23.11.0", false],
    ["24.22.0", false],
    ["24.22.1", true],
    ["24.23.0", true],
    ["25.9.0", false],
    ["26.12.0", false],
    ["26.12.1", true],
    ["26.13.0", true],
    ["26.13.0-rc.1", false],
    ["27.0.0", false],
    ["28.0.0", false],
];

test("Node engines accept patched supported lines and reject EOL or unpatched runtimes", () => {
    for (const [version, accepted] of cases) {
        assert.equal(
            semver.satisfies(version, nodeRange),
            accepted,
            `Node ${version}`,
        );
    }
    for (const importer of Object.keys(lock.importers)) {
        const file = path.join(tsRoot, importer, "package.json");
        const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
        if (pkg.engines?.node) {
            assert.equal(pkg.engines.node, nodeRange, file);
        }
    }
});

test("standalone installers enforce the same patched Node policy as package engines", () => {
    for (const file of [
        "ts/tools/scripts/install-typeagent.ps1",
        "ts/tools/scripts/install-typeagent.sh",
        "ts/tools/scripts/setup-typeagent-prereqs.ps1",
        "ts/tools/installers/wix/resolve-node.ps1",
    ]) {
        const match = read(file).match(
            /-e "(const \[major, minor, patch\][^\r\n"]+)"/,
        );
        assert.ok(match, `Node version check missing from ${file}`);
        for (const [version, accepted] of cases) {
            let exitCode;
            runInNewContext(match[1], {
                process: {
                    versions: { node: version },
                    exit: (code) => {
                        exitCode = code;
                    },
                },
            });
            assert.equal(
                exitCode,
                accepted ? 0 : 1,
                `${file}: Node ${version}`,
            );
        }
    }
});

test("direct Node types and lockfile entries match the oldest supported release line", () => {
    let checked = 0;
    for (const [importer, entry] of Object.entries(lock.importers)) {
        const pkg = JSON.parse(
            fs.readFileSync(
                path.join(tsRoot, importer, "package.json"),
                "utf8",
            ),
        );
        for (const section of ["dependencies", "devDependencies"]) {
            if (!pkg[section]?.["@types/node"]) {
                continue;
            }
            assert.equal(
                pkg[section]["@types/node"],
                `^${typesVersion}`,
                importer,
            );
            assert.deepEqual(entry[section]["@types/node"], {
                specifier: `^${typesVersion}`,
                version: typesVersion,
            });
            checked++;
        }
    }
    assert.ok(checked > 0);
    const scaffold = read(
        "ts/packages/agents/onboarding/src/scaffolder/scaffolderHandler.ts",
    );
    assert.equal(
        scaffold.match(/"@types\/node": "([^"]+)"/)?.[1],
        `^${typesVersion}`,
    );
});

test("SQLite dependencies and the prebuild installer support every supported Node ABI", () => {
    for (const [importer, entry] of Object.entries(lock.importers)) {
        const dependency = entry.dependencies?.["better-sqlite3"];
        if (dependency) {
            assert.deepEqual(
                dependency,
                { specifier: "12.11.1", version: "12.11.1" },
                importer,
            );
        }
    }
    const sqliteRequire = createRequire(
        path.join(tsRoot, "packages", "memory", "storage", "package.json"),
    );
    const nativeRequire = createRequire(
        sqliteRequire.resolve("better-sqlite3/package.json"),
    );
    const prebuildRequire = createRequire(
        nativeRequire.resolve("prebuild-install/package.json"),
    );
    const nodeAbi = prebuildRequire("node-abi");
    for (const [version, abi] of [
        [supportedVersions[0], "127"],
        [supportedVersions[1], "137"],
        [supportedVersions[2], "147"],
    ]) {
        assert.equal(nodeAbi.getAbi(version, "node"), abi, version);
        assert.ok(
            semver.satisfies(
                version,
                lock.packages["better-sqlite3@12.11.1"].engines.node,
            ),
        );
    }
});

test("CI tests Node 22, 24 and 26 while single-version jobs pin Node 24", () => {
    const directory = path.join(repo, ".github", "workflows");
    for (const file of fs.readdirSync(directory)) {
        if (!file.endsWith(".yml")) {
            continue;
        }
        const workflow = yaml.load(
            fs.readFileSync(path.join(directory, file), "utf8"),
        );
        for (const job of Object.values(workflow.jobs ?? {})) {
            for (const step of job.steps ?? []) {
                if (!step.uses?.startsWith("actions/setup-node@")) {
                    continue;
                }
                const version = step.with["node-version"];
                if (version === "${{ matrix.version }}") {
                    assert.deepEqual(
                        job.strategy.matrix.version,
                        file === "build-ts.yml"
                            ? supportedVersions
                            : [pinnedBuildVersion],
                        file,
                    );
                } else {
                    assert.equal(version, pinnedBuildVersion, file);
                }
            }
        }
    }
    const docsAction = yaml.load(
        read(".github/actions/docs-generate/action.yml"),
    );
    const docsNode = docsAction.runs.steps.find((step) =>
        step.uses?.startsWith("actions/setup-node@"),
    );
    assert.equal(docsNode.with["node-version"], pinnedBuildVersion);
});

test("development setup tracks the latest Node LTS release", () => {
    assert.equal(read(".nvmrc").trim(), "lts/*");
    for (const file of [
        ".devcontainer/devcontainer.json",
        ".devcontainer/agent/devcontainer.json",
        ".devcontainer/vnc/devcontainer.json",
    ]) {
        const feature = read(file).match(
            /"ghcr\.io\/devcontainers\/features\/node:1":\s*\{\s*"version":\s*"([^"]+)"/,
        );
        assert.equal(feature?.[1], "lts", file);
    }
    const bootstrap = read("ts/tools/scripts/setup-typeagent-prereqs.ps1");
    const installLts = bootstrap.match(
        /^\s*Install-WingetPackage -Id "OpenJS.NodeJS.LTS"[^\r\n]*/m,
    )?.[0];
    assert.ok(installLts, "The Windows bootstrap must select Node.js LTS");
    assert.doesNotMatch(installLts, /-Version\b/);
});

test("setup guides select LTS and install pnpm without bundled Corepack", () => {
    const nvmGuides = [
        "docs/content/setup/setup-Linux.md",
        "docs/content/setup/setup-macOS.md",
        "docs/content/setup/setup-WSL2.md",
        "ts/docs/overview/setup-linux.md",
        "ts/docs/overview/setup-macos.md",
        "ts/docs/overview/setup-wsl2.md",
        "ts/packages/copilot-plugin/README.md",
    ];
    for (const file of nvmGuides) {
        const text = read(file);
        assert.ok(text.includes("nvm install --lts"), file);
        assert.ok(text.includes("nvm use --lts"), file);
    }
    for (const file of [
        ...nvmGuides,
        "docs/content/setup/setup-Windows.md",
        "ts/docs/overview/setup-windows.md",
    ]) {
        const text = read(file);
        assert.ok(text.includes("npm install --global pnpm"), file);
        assert.ok(!text.includes("`corepack enable`"), file);
    }
    const windowsNvm = read("ts/packages/copilot-plugin/README.md");
    assert.ok(windowsNvm.includes("nvm install lts"));
    assert.ok(windowsNvm.includes("nvm use lts"));
});

test("pipeline and release container versions remain pinned to patched Node 24", () => {
    for (const file of [
        "pipelines/azure-build-publish-all.yml",
        "pipelines/azure-smoke-tests.yml",
    ]) {
        const pipeline = yaml.load(read(file));
        assert.equal(
            pipeline.variables.find((item) => item.name === "nodeVersion")
                .value,
            pinnedBuildVersion,
            file,
        );
    }
    assert.ok(
        read("ts/Dockerfile").includes(
            `FROM node:${pinnedBuildVersion}-bookworm AS runtime-base`,
        ),
    );
    for (const file of [
        "ts/packages/security/mcpValidation/example-policy.json",
        "ts/packages/security/mcpValidation/policies/ci.json",
        "ts/packages/security/mcpValidation/policies/dev.json",
    ]) {
        assert.equal(
            JSON.parse(read(file)).container.image,
            `node:${pinnedBuildVersion}-slim`,
            file,
        );
    }
});
