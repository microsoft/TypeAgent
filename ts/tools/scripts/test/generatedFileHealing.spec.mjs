// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import {
    loadJsonFile,
    prepareCandidateArtifact,
    pushVerifiedPlan,
    validateMetadata,
    verifyCandidateArtifact,
} from "../lib/generatedFileHealing.mjs";

const REPOSITORY = "microsoft/TypeAgent";
const PRODUCER_WORKFLOW = resolve(
    import.meta.dirname,
    "../../../../.github/workflows/heal-generated-files.yml",
);
const FINALIZER_WORKFLOW = resolve(
    import.meta.dirname,
    "../../../../.github/workflows/heal-generated-files-finalize.yml",
);
const HEALER_SCRIPT = resolve(
    import.meta.dirname,
    "../heal-generated-files.mjs",
);

function checkedOutput(command, args, result) {
    assert.ifError(result.error);
    assert.equal(
        result.status,
        0,
        `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
    );
    return result.stdout.trim();
}

function runGit(args, options = {}) {
    const result = spawnSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...options,
    });
    return checkedOutput("git", args, result);
}

function runNode(args, options = {}) {
    const result = spawnSync(process.execPath, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...options,
    });
    return checkedOutput(process.execPath, args, result);
}

function locatePnpmWithWhich() {
    const args = ["pnpm"];
    const result = spawnSync("which", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    return checkedOutput("which", args, result);
}

function locatePnpmWithWhere() {
    const args = ["pnpm"];
    const result = spawnSync("where.exe", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    return checkedOutput("where.exe", args, result);
}

function git(repository, ...args) {
    return runGit([
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgSign=false",
        "-c",
        "safe.bareRepository=all",
        "-C",
        repository,
        ...args,
    ]);
}

function write(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
}

function packageJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function createFakePnpm(directory, auditPath, options = {}) {
    const script = join(directory, "fake-pnpm.mjs");
    write(
        script,
        `#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function manifests(directory) {
  const values = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) values.push(...manifests(path));
    if (entry.isFile() && entry.name === "package.json") {
      values.push(JSON.parse(readFileSync(path, "utf8")));
    }
  }
  return values;
}

const visible = {
  env: process.env,
  homeGitConfig: (() => {
    try { return readFileSync(join(process.env.HOME, "gitconfig"), "utf8"); }
    catch { return ""; }
  })(),
  npmrc: readFileSync(join(process.cwd(), ".npmrc"), "utf8"),
  pnpmfile: readFileSync(join(process.cwd(), ".pnpmfile.cjs"), "utf8"),
};
writeFileSync(${JSON.stringify(auditPath)}, JSON.stringify(visible, null, 2));
const packages = manifests(process.cwd())
  .map((pkg) => ({ name: pkg.name, dependencies: pkg.dependencies ?? {} }))
  .sort((left, right) => String(left.name).localeCompare(String(right.name)));
if (
  ${JSON.stringify(options.failPackageName ?? null)} &&
  packages.some((pkg) => pkg.name === ${JSON.stringify(options.failPackageName ?? null)})
) {
  process.stderr.write("inert pnpm failure\\n");
  process.exit(2);
}
writeFileSync(
  join(process.cwd(), "pnpm-lock.yaml"),
  "lockfileVersion: '9.0'\\n# " + JSON.stringify(packages) + "\\n",
);
`,
    );
    chmodSync(script, 0o700);
    return script;
}

function resolveStandalonePnpmCommand() {
    if (process.platform !== "win32") {
        return locatePnpmWithWhich();
    }
    const candidates = [];
    if (process.env.PNPM_HOME) {
        candidates.push(
            resolve(process.env.PNPM_HOME, "..", "pnpm", "bin", "pnpm.cjs"),
            resolve(
                process.env.PNPM_HOME,
                "node_modules",
                "pnpm",
                "bin",
                "pnpm.cjs",
            ),
        );
    }
    for (const command of locatePnpmWithWhere().split(/\r?\n/)) {
        candidates.push(
            resolve(
                dirname(command),
                "node_modules",
                "pnpm",
                "bin",
                "pnpm.cjs",
            ),
        );
        if (dirname(command).endsWith(`${sep}.bin`)) {
            candidates.push(
                resolve(dirname(command), "..", "pnpm", "bin", "pnpm.cjs"),
            );
        }
    }
    const command = candidates.find(existsSync);
    assert.ok(command, "Unable to locate the standalone pnpm entrypoint");
    return command;
}

function createFixture(options = {}) {
    const root = mkdtempSync(join(tmpdir(), "generated-healing-test-"));
    const source = join(root, "source");
    const remote = join(root, "remote.git");
    const markerDirectory = join(root, "markers");
    mkdirSync(source, { recursive: true });
    mkdirSync(markerDirectory, { recursive: true });
    git(source, "init", "--initial-branch=main");
    git(source, "config", "user.name", "fixture");
    git(source, "config", "user.email", "fixture@example.com");

    write(
        join(source, "ts", "package.json"),
        packageJson({
            name: "fixture-root",
            private: true,
            packageManager: "pnpm@11.9.0",
            scripts: {},
        }),
    );
    write(
        join(source, "ts", "pnpm-workspace.yaml"),
        "packages:\n  - packages/*\n",
    );
    write(
        join(source, "ts", ".pnpmfile.cjs"),
        `module.exports = {
  hooks: {
    readPackage(pkg) {
      if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
        throw new Error("credential exposed to trusted pnpmfile");
      }
      if (pkg.name === "fixture-app") {
        pkg.dependencies = { ...(pkg.dependencies || {}), "fixture-lib": "workspace:*" };
      }
      return pkg;
    },
  },
};
`,
    );
    write(join(source, "ts", "pnpm-lock.yaml"), "lockfileVersion: base\n");
    write(
        join(source, "ts", "packages", "app", "README.AUTOGEN.md"),
        "base readme\n",
    );
    write(
        join(source, "ts", "packages", "app", "package.json"),
        packageJson({
            name: "fixture-app",
            version: "1.0.0",
            scripts: {},
        }),
    );
    write(
        join(source, "ts", "packages", "lib", "package.json"),
        packageJson({ name: "fixture-lib", version: "1.0.0" }),
    );
    write(
        join(source, "ts", "tools", "scripts", "heal-generated-files.mjs"),
        'console.log("trusted healer");\n',
    );
    if (options.nonGeneratedConflict || options.maliciousMergeAttributes) {
        write(join(source, "ts", "packages", "app", "source.ts"), "base\n");
    }
    git(source, "add", "-A");
    git(source, "commit", "-m", "base");
    const historicalBaseSha = git(source, "rev-parse", "HEAD");

    git(source, "checkout", "-b", "feature");
    write(join(source, "ts", "pnpm-lock.yaml"), "lockfileVersion: pr\n");
    const rootPackagePath = join(source, "ts", "package.json");
    const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
    rootPackage.scripts.postinstall = `node -e "require('fs').writeFileSync('${join(markerDirectory, "root-lifecycle").replaceAll("\\", "\\\\")}','ran')"`;
    if (options.maliciousPackageManager) {
        rootPackage.packageManager = "pnpm@99.0.0";
    }
    write(rootPackagePath, packageJson(rootPackage));
    write(
        join(source, "ts", "packages", "app", "README.AUTOGEN.md"),
        "pull request readme\n",
    );
    write(
        join(source, "ts", "packages", "app", "package.json"),
        packageJson({
            name: "fixture-app",
            version: "1.0.0",
            scripts: {
                postinstall: `node -e "require('fs').writeFileSync('${join(markerDirectory, "lifecycle").replaceAll("\\", "\\\\")}','ran')"`,
            },
        }),
    );
    write(
        join(source, "ts", "tools", "scripts", "heal-generated-files.mjs"),
        `require("node:fs").writeFileSync(${JSON.stringify(join(markerDirectory, "healer"))}, "ran");\n`,
    );
    if (options.maliciousPnpmfile) {
        write(
            join(source, "ts", ".pnpmfile.cjs"),
            `require("node:fs").writeFileSync(${JSON.stringify(join(markerDirectory, "pnpmfile"))}, "ran"); module.exports = {};\n`,
        );
    }
    if (options.maliciousNpmrc) {
        write(
            join(source, "ts", ".npmrc"),
            `node-options=--require=${join(markerDirectory, "npmrc-loader.cjs")}\n`,
        );
        write(
            join(markerDirectory, "npmrc-loader.cjs"),
            `require("node:fs").writeFileSync(${JSON.stringify(join(markerDirectory, "npmrc"))}, "ran");\n`,
        );
    }
    if (options.maliciousWorkspace) {
        write(
            join(source, "ts", "pnpm-workspace.yaml"),
            "packages:\n  - packages/*\nconfigDependencies:\n  malicious: 1.0.0\n",
        );
    }
    if (options.nonGeneratedConflict) {
        write(
            join(source, "ts", "packages", "app", "source.ts"),
            "pull request\n",
        );
    }
    if (options.maliciousMergeAttributes) {
        write(
            join(source, ".gitattributes"),
            "ts/packages/app/source.ts merge=union\n",
        );
        write(
            join(source, "ts", "packages", "app", "source.ts"),
            "pull request\n",
        );
    }
    git(source, "add", "-A");
    git(source, "commit", "-m", "pull request");
    const headSha = git(source, "rev-parse", "HEAD");

    git(source, "checkout", "main");
    write(join(source, "ts", "pnpm-lock.yaml"), "lockfileVersion: main\n");
    write(
        join(source, "ts", "packages", "app", "README.AUTOGEN.md"),
        "main readme\n",
    );
    write(join(source, "main-only.txt"), "main\n");
    if (options.nonGeneratedConflict) {
        write(join(source, "ts", "packages", "app", "source.ts"), "main\n");
    }
    if (options.maliciousMergeAttributes) {
        write(join(source, "ts", "packages", "app", "source.ts"), "main\n");
    }
    git(source, "add", "-A");
    git(source, "commit", "-m", "trusted main");
    const trustedSha = git(source, "rev-parse", "HEAD");

    runGit(["clone", "--bare", source, remote]);
    git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
    const metadata = {
        repository: REPOSITORY,
        defaultBranch: "main",
        trustedSha,
        runId: "12345",
        pullRequests: [
            {
                number: 17,
                state: "open",
                isCrossRepository: false,
                headRepository: REPOSITORY,
                baseRepository: REPOSITORY,
                headRefName: "feature",
                headSha,
                baseRefName: "main",
                baseSha: historicalBaseSha,
            },
        ],
    };
    return {
        root,
        source,
        remote,
        markerDirectory,
        metadata,
        trustedSha,
        historicalBaseSha,
        headSha,
        cleanup() {
            rmSync(root, { recursive: true, force: true });
        },
    };
}

function prepare(fixture, options = {}) {
    const outputDirectory = join(fixture.root, "artifact");
    const auditPath = join(fixture.root, "pnpm-audit.json");
    const attackerHome = join(fixture.root, "attacker-home");
    const runnerTemp = join(fixture.root, "runner-temp-with-credentials");
    mkdirSync(attackerHome, { recursive: true });
    mkdirSync(runnerTemp, { recursive: true });
    write(
        join(attackerHome, "gitconfig"),
        '[http "https://github.com/"]\n\textraheader = AUTHORIZATION: sentinel-git-extraheader\n[include]\n\tpath = sentinel-checkout-credential-file\n',
    );
    write(
        join(runnerTemp, "checkout-credential"),
        "sentinel-runner-temp-credential\n",
    );
    const pnpmCommand =
        options.pnpmCommand ??
        createFakePnpm(join(fixture.root, "tools"), auditPath);
    const summary = prepareCandidateArtifact({
        metadata: fixture.metadata,
        outputDirectory,
        repositoryUrl: fixture.remote,
        pnpmCommand,
        baseEnvironment: {
            ...process.env,
            GH_TOKEN: "sentinel-gh-token",
            GITHUB_TOKEN: "sentinel-github-token",
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
            GIT_CONFIG_VALUE_0: "AUTHORIZATION: sentinel-git-config-env",
            HOME: attackerHome,
            RUNNER_TEMP: runnerTemp,
            TEST_SECRET: "sentinel-test-secret",
        },
        workDirectory: join(fixture.root, "prepare"),
        now: () => new Date("2026-10-20T20:00:00.000Z"),
    });
    return { summary, outputDirectory, auditPath, pnpmCommand };
}

function verify(fixture, prepared) {
    const planPath = join(fixture.root, "plan.json");
    const plan = verifyCandidateArtifact({
        artifactDirectory: prepared.outputDirectory,
        liveMetadata: fixture.metadata,
        expectedRunId: fixture.metadata.runId,
        repositoryUrl: fixture.remote,
        pnpmCommand: prepared.pnpmCommand,
        planPath,
        baseEnvironment: process.env,
        workDirectory: join(fixture.root, "verify"),
    });
    return { plan, planPath };
}

function assertGeneratedSymlinkBlocked(reason, generatedPath, trustedSha) {
    if (/non-regular Git mode|regular filesystem file/.test(reason)) {
        return;
    }
    assert.ok(
        reason.includes(
            `Conflicts beyond generated files: ${generatedPath}~${trustedSha}`,
        ),
        `Unexpected generated-symlink rejection: ${reason}`,
    );
}

function rewriteCandidateCommitMessage(fixture, prepared, message) {
    const summaryPath = join(prepared.outputDirectory, "summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    const candidate = summary.candidates[0];
    const repositoryPath = join(fixture.root, "prepare", "repository.git");
    const environment = {
        ...process.env,
        GIT_AUTHOR_NAME: "typeagent-bot",
        GIT_AUTHOR_EMAIL: "typeagent-bot[bot]@users.noreply.github.com",
        GIT_AUTHOR_DATE: candidate.preparedAt,
        GIT_COMMITTER_NAME: "typeagent-bot",
        GIT_COMMITTER_EMAIL: "typeagent-bot[bot]@users.noreply.github.com",
        GIT_COMMITTER_DATE: candidate.preparedAt,
    };
    const candidateSha = runGit(
        [
            "-c",
            "commit.gpgSign=false",
            "-c",
            "safe.bareRepository=all",
            "-C",
            repositoryPath,
            "commit-tree",
            candidate.treeSha,
            "-p",
            candidate.headSha,
            "-p",
            fixture.trustedSha,
        ],
        {
            env: environment,
            input: message,
            stdio: ["pipe", "pipe", "pipe"],
        },
    );
    git(
        repositoryPath,
        "update-ref",
        `refs/heal/candidates/pr-${candidate.number}`,
        candidateSha,
    );
    const bundlePath = join(prepared.outputDirectory, candidate.bundle);
    rmSync(bundlePath);
    git(
        repositoryPath,
        "bundle",
        "create",
        bundlePath,
        `refs/heal/candidates/pr-${candidate.number}`,
        `^${candidate.headSha}`,
        `^${fixture.trustedSha}`,
    );
    candidate.candidateSha = candidateSha;
    write(summaryPath, packageJson(summary));
}

function createForgedCandidateArtifact(fixture, path) {
    const artifactDirectory = join(fixture.root, "forged-artifact");
    const repositoryPath = join(fixture.root, "forged-repository.git");
    const preparedAt = "2026-10-20T20:00:00.000Z";
    runGit(["clone", "--bare", fixture.remote, repositoryPath]);
    const treeSha = git(
        repositoryPath,
        "rev-parse",
        `${fixture.metadata.pullRequests[0].headSha}^{tree}`,
    );
    const message = `chore: heal generated file conflicts\n\nPR #17\nTrusted-Base: ${fixture.trustedSha}\n`;
    const candidateSha = runGit(
        [
            "-c",
            "commit.gpgSign=false",
            "-c",
            "safe.bareRepository=all",
            "-C",
            repositoryPath,
            "commit-tree",
            treeSha,
            "-p",
            fixture.metadata.pullRequests[0].headSha,
            "-p",
            fixture.trustedSha,
        ],
        {
            env: {
                ...process.env,
                GIT_AUTHOR_NAME: "typeagent-bot",
                GIT_AUTHOR_EMAIL: "typeagent-bot[bot]@users.noreply.github.com",
                GIT_AUTHOR_DATE: preparedAt,
                GIT_COMMITTER_NAME: "typeagent-bot",
                GIT_COMMITTER_EMAIL:
                    "typeagent-bot[bot]@users.noreply.github.com",
                GIT_COMMITTER_DATE: preparedAt,
            },
            input: message,
            stdio: ["pipe", "pipe", "pipe"],
        },
    );
    git(
        repositoryPath,
        "update-ref",
        "refs/heal/candidates/pr-17",
        candidateSha,
    );
    mkdirSync(artifactDirectory, { recursive: true });
    git(
        repositoryPath,
        "bundle",
        "create",
        join(artifactDirectory, "pr-17.bundle"),
        "refs/heal/candidates/pr-17",
        `^${fixture.metadata.pullRequests[0].headSha}`,
        `^${fixture.trustedSha}`,
    );
    write(
        join(artifactDirectory, "summary.json"),
        packageJson({
            version: 1,
            repository: REPOSITORY,
            defaultBranch: "main",
            trustedSha: fixture.trustedSha,
            producerRunId: fixture.metadata.runId,
            preparedAt,
            candidates: [
                {
                    ...fixture.metadata.pullRequests[0],
                    candidateSha,
                    treeSha,
                    conflicts: [path],
                    bundle: "pr-17.bundle",
                    commitMessage: message,
                    preparedAt,
                },
            ],
            skipped: [],
        }),
    );
    return artifactDirectory;
}

test("trusted healer prepares a candidate without exposing credentials or running PR code", () => {
    const fixture = createFixture();
    try {
        const prepared = prepare(fixture);
        assert.equal(prepared.summary.candidates.length, 1);
        assert.equal(prepared.summary.skipped.length, 0);
        assert.equal(
            existsSync(join(fixture.markerDirectory, "healer")),
            false,
        );
        assert.equal(
            existsSync(join(fixture.markerDirectory, "lifecycle")),
            false,
        );
        assert.equal(
            existsSync(join(fixture.markerDirectory, "root-lifecycle")),
            false,
        );

        const audit = JSON.parse(readFileSync(prepared.auditPath, "utf8"));
        const visible = JSON.stringify(audit);
        assert.doesNotMatch(visible, /sentinel-(gh|github|test|git|runner)-/);
        assert.doesNotMatch(visible, /runner-temp-with-credentials/);
        assert.match(audit.pnpmfile, /trusted pnpmfile|readPackage/);
        assert.match(audit.npmrc, /ignore-scripts=true/);
        assert.equal(audit.env.GH_TOKEN, undefined);
        assert.equal(audit.env.GITHUB_TOKEN, undefined);
        assert.equal(audit.env.TEST_SECRET, undefined);
    } finally {
        fixture.cleanup();
    }
});

test("prepare CLI consumes metadata without invoking GitHub CLI or APIs", () => {
    const fixture = createFixture();
    try {
        const metadataPath = join(fixture.root, "metadata.json");
        const outputDirectory = join(fixture.root, "cli-artifact");
        const auditPath = join(fixture.root, "cli-pnpm-audit.json");
        const commandDirectory = join(
            fixture.root,
            "commands with spaces [literal]",
        );
        const ghMarker = join(fixture.markerDirectory, "gh");
        const pnpmCommand = createFakePnpm(commandDirectory, auditPath);
        const ghCommand = join(
            commandDirectory,
            process.platform === "win32" ? "gh.cmd" : "gh",
        );
        write(
            ghCommand,
            process.platform === "win32"
                ? `@echo off\r\nnode -e "require('fs').writeFileSync(${JSON.stringify(ghMarker)}, 'ran')"\r\nexit /b 99\r\n`
                : `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(ghMarker)}, "ran");\nprocess.exit(99);\n`,
        );
        chmodSync(ghCommand, 0o700);
        write(metadataPath, packageJson(fixture.metadata));

        runNode(
            [
                HEALER_SCRIPT,
                "prepare",
                "--metadata",
                metadataPath,
                "--output",
                outputDirectory,
                "--repository-url",
                fixture.remote,
                "--pnpm",
                pnpmCommand,
            ],
            {
                env: {
                    ...process.env,
                    GH_TOKEN: "",
                    GITHUB_API_URL: "https://invalid.example.test",
                    GITHUB_TOKEN: "",
                    PATH: `${commandDirectory}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
                },
            },
        );

        assert.equal(existsSync(ghMarker), false);
        assert.equal(existsSync(join(outputDirectory, "summary.json")), true);
        const source = readFileSync(HEALER_SCRIPT, "utf8");
        const library = readFileSync(
            resolve(import.meta.dirname, "../lib/generatedFileHealing.mjs"),
            "utf8",
        );
        assert.doesNotMatch(source, /(["'])gh\1/);
        assert.doesNotMatch(library, /(["'])gh\1/);
    } finally {
        fixture.cleanup();
    }
});

for (const [name, options, marker, expected] of [
    [
        "pnpmfile",
        { maliciousPnpmfile: true },
        "pnpmfile",
        /executable package-manager configuration/,
    ],
    [
        "npmrc",
        { maliciousNpmrc: true },
        "npmrc",
        /executable package-manager configuration/,
    ],
    [
        "workspace resolver config",
        { maliciousWorkspace: true },
        "workspace",
        /executable package-manager configuration/,
    ],
    [
        "package manager pin",
        { maliciousPackageManager: true },
        "package-manager",
        /package\.json#packageManager/,
    ],
]) {
    test(`rejects PR-controlled ${name} before candidate creation`, () => {
        const fixture = createFixture(options);
        try {
            const prepared = prepare(fixture);
            assert.equal(prepared.summary.candidates.length, 0);
            assert.equal(prepared.summary.skipped.length, 1);
            assert.equal(prepared.summary.skipped[0].status, "blocked");
            assert.match(prepared.summary.skipped[0].reason, expected);
            assert.equal(
                existsSync(join(fixture.markerDirectory, marker)),
                false,
            );
            assert.equal(
                existsSync(join(fixture.root, "artifact", "summary.json")),
                true,
            );
        } finally {
            fixture.cleanup();
        }
    });
}

test(
    "literal backslash manifest paths cannot escape scratch through a symlink",
    { skip: process.platform === "win32" },
    () => {
        const fixture = createFixture();
        try {
            const outsidePath = join(
                fixture.root,
                "outside-trusted-healer.mjs",
            );
            write(outsidePath, "trusted outside content\n");
            git(fixture.source, "checkout", "feature");
            write(
                join(
                    fixture.source,
                    "ts",
                    String.raw`00\..\..\worktree`,
                    "payload",
                    "package.json",
                ),
                packageJson({ name: "escape-payload", version: "1.0.0" }),
            );
            mkdirSync(join(fixture.source, "payload"), { recursive: true });
            symlinkSync(
                outsidePath,
                join(fixture.source, "payload", "package.json"),
            );
            git(fixture.source, "add", "-A");
            git(fixture.source, "commit", "-m", "add manifest escape");
            git(fixture.source, "push", fixture.remote, "feature");
            fixture.metadata.pullRequests[0].headSha = git(
                fixture.source,
                "rev-parse",
                "HEAD",
            );

            const prepared = prepare(fixture);
            assert.equal(prepared.summary.candidates.length, 0);
            assert.equal(prepared.summary.skipped[0].status, "blocked");
            assert.match(prepared.summary.skipped[0].reason, /backslash/);
            assert.equal(
                readFileSync(outsidePath, "utf8"),
                "trusted outside content\n",
            );
            assert.equal(
                git(
                    fixture.source,
                    "show",
                    "main:ts/tools/scripts/heal-generated-files.mjs",
                ),
                'console.log("trusted healer");',
            );
        } finally {
            fixture.cleanup();
        }
    },
);

test(
    "symlinked package manifests are blocked before scratch copying",
    { skip: process.platform === "win32" },
    () => {
        const fixture = createFixture();
        try {
            git(fixture.source, "checkout", "feature");
            mkdirSync(join(fixture.source, "ts", "packages", "symlinked"), {
                recursive: true,
            });
            symlinkSync(
                "../app/package.json",
                join(
                    fixture.source,
                    "ts",
                    "packages",
                    "symlinked",
                    "package.json",
                ),
            );
            git(fixture.source, "add", "-A");
            git(fixture.source, "commit", "-m", "add symlink manifest");
            git(fixture.source, "push", fixture.remote, "feature");
            fixture.metadata.pullRequests[0].headSha = git(
                fixture.source,
                "rev-parse",
                "HEAD",
            );

            const prepared = prepare(fixture);
            assert.equal(prepared.summary.candidates.length, 0);
            assert.equal(prepared.summary.skipped[0].status, "blocked");
            assert.match(
                prepared.summary.skipped[0].reason,
                /not a regular file/,
            );
        } finally {
            fixture.cleanup();
        }
    },
);

for (const generatedPath of [
    "ts/pnpm-lock.yaml",
    "ts/packages/app/README.AUTOGEN.md",
]) {
    test(
        `generated symlink ${generatedPath} cannot overwrite an outside file during preparation`,
        { skip: process.platform === "win32" },
        () => {
            const fixture = createFixture();
            try {
                const outsidePath = join(
                    fixture.root,
                    `${basename(generatedPath)}-outside`,
                );
                write(outsidePath, "outside trusted content\n");
                git(fixture.source, "checkout", "feature");
                rmSync(join(fixture.source, ...generatedPath.split("/")));
                symlinkSync(
                    outsidePath,
                    join(fixture.source, ...generatedPath.split("/")),
                );
                git(fixture.source, "add", "-A");
                git(fixture.source, "commit", "-m", "symlink generated file");
                git(fixture.source, "push", fixture.remote, "feature");
                fixture.metadata.pullRequests[0].headSha = git(
                    fixture.source,
                    "rev-parse",
                    "HEAD",
                );

                const prepared = prepare(fixture);
                assert.equal(prepared.summary.candidates.length, 0);
                assert.equal(prepared.summary.skipped.length, 1);
                assertGeneratedSymlinkBlocked(
                    prepared.summary.skipped[0].reason,
                    generatedPath,
                    fixture.trustedSha,
                );
                assert.equal(
                    readFileSync(outsidePath, "utf8"),
                    "outside trusted content\n",
                );
                assert.equal(
                    existsSync(
                        join(fixture.root, "prepare", "pr-17", "worktree"),
                    ),
                    false,
                );
            } finally {
                fixture.cleanup();
            }
        },
    );
}

test(
    "privileged reconstruction blocks a forged generated symlink candidate",
    { skip: process.platform === "win32" },
    () => {
        const fixture = createFixture();
        try {
            const outsidePath = join(
                fixture.root,
                "privileged-reconstruction-outside",
            );
            write(outsidePath, "outside trusted content\n");
            git(fixture.source, "checkout", "feature");
            rmSync(join(fixture.source, "ts", "pnpm-lock.yaml"));
            symlinkSync(
                outsidePath,
                join(fixture.source, "ts", "pnpm-lock.yaml"),
            );
            git(fixture.source, "add", "-A");
            git(fixture.source, "commit", "-m", "symlink lockfile");
            git(fixture.source, "push", fixture.remote, "feature");
            fixture.metadata.pullRequests[0].headSha = git(
                fixture.source,
                "rev-parse",
                "HEAD",
            );
            const artifactDirectory = createForgedCandidateArtifact(
                fixture,
                "ts/pnpm-lock.yaml",
            );

            const plan = verifyCandidateArtifact({
                artifactDirectory,
                liveMetadata: fixture.metadata,
                expectedRunId: fixture.metadata.runId,
                repositoryUrl: fixture.remote,
                pnpmCommand: createFakePnpm(
                    join(fixture.root, "forged-tools"),
                    join(fixture.root, "forged-audit"),
                ),
                planPath: join(fixture.root, "forged-plan.json"),
                workDirectory: join(fixture.root, "forged-verify"),
            });
            assert.equal(plan.candidates.length, 0);
            assert.equal(plan.skipped.length, 1);
            assertGeneratedSymlinkBlocked(
                plan.skipped[0].reason,
                "ts/pnpm-lock.yaml",
                fixture.trustedSha,
            );
            assert.equal(
                readFileSync(outsidePath, "utf8"),
                "outside trusted content\n",
            );
            assert.equal(
                existsSync(
                    join(
                        fixture.root,
                        "forged-verify",
                        "expected-pr-17",
                        "worktree",
                    ),
                ),
                false,
            );
        } finally {
            fixture.cleanup();
        }
    },
);

test("isolated repository configures the fixed bot identity before merging", () => {
    const fixture = createFixture();
    try {
        const prepared = prepare(fixture);
        assert.equal(prepared.summary.candidates.length, 1);
        const repositoryPath = join(fixture.root, "prepare", "repository.git");
        assert.equal(
            git(repositoryPath, "config", "--local", "user.name"),
            "typeagent-bot",
        );
        assert.equal(
            git(repositoryPath, "config", "--local", "user.email"),
            "typeagent-bot[bot]@users.noreply.github.com",
        );
        assert.equal(
            readFileSync(
                join(fixture.root, "prepare", "home", "gitconfig"),
                "utf8",
            ),
            "",
        );
    } finally {
        fixture.cleanup();
    }
});

test("a blocked malicious PR does not prevent another PR candidate", () => {
    const fixture = createFixture();
    try {
        git(fixture.source, "checkout", "feature");
        git(fixture.source, "checkout", "-b", "malicious-feature");
        write(
            join(fixture.source, "ts", ".pnpmfile.cjs"),
            `require("node:fs").writeFileSync(${JSON.stringify(join(fixture.markerDirectory, "mixed-pnpmfile"))}, "ran"); module.exports = {};\n`,
        );
        git(fixture.source, "add", "ts/.pnpmfile.cjs");
        git(fixture.source, "commit", "-m", "add malicious pnpmfile");
        git(fixture.source, "push", fixture.remote, "malicious-feature");
        const maliciousHead = git(fixture.source, "rev-parse", "HEAD");
        git(fixture.remote, "branch", "valid-feature-2", fixture.headSha);
        fixture.metadata.pullRequests = [
            fixture.metadata.pullRequests[0],
            {
                ...fixture.metadata.pullRequests[0],
                number: 18,
                headRefName: "malicious-feature",
                headSha: maliciousHead,
            },
            {
                ...fixture.metadata.pullRequests[0],
                number: 19,
                headRefName: "valid-feature-2",
            },
        ];

        const prepared = prepare(fixture);
        assert.deepEqual(
            prepared.summary.candidates.map((candidate) => candidate.number),
            [17, 19],
        );
        assert.deepEqual(
            prepared.summary.skipped.map((candidate) => candidate.number),
            [18],
        );
        assert.equal(prepared.summary.skipped[0].status, "blocked");
        assert.match(
            prepared.summary.skipped[0].reason,
            /executable package-manager configuration/,
        );
        assert.equal(
            existsSync(join(fixture.markerDirectory, "mixed-pnpmfile")),
            false,
        );
        assert.equal(
            existsSync(join(prepared.outputDirectory, "summary.json")),
            true,
        );
    } finally {
        fixture.cleanup();
    }
});

test("deleted heads, malformed manifests, and pnpm failures do not abort a scan", () => {
    const fixture = createFixture();
    try {
        git(fixture.remote, "branch", "valid-feature-2", fixture.headSha);

        git(fixture.source, "checkout", "-B", "invalid-json", "feature");
        write(
            join(fixture.source, "ts", "packages", "app", "package.json"),
            "{ invalid json\n",
        );
        git(fixture.source, "add", "-A");
        git(fixture.source, "commit", "-m", "invalid manifest");
        git(fixture.source, "push", fixture.remote, "invalid-json");
        const invalidJsonHead = git(fixture.source, "rev-parse", "HEAD");

        git(fixture.source, "checkout", "-B", "pnpm-failure", "feature");
        const appPath = join(
            fixture.source,
            "ts",
            "packages",
            "app",
            "package.json",
        );
        const app = JSON.parse(readFileSync(appPath, "utf8"));
        app.name = "trigger-pnpm-failure";
        write(appPath, packageJson(app));
        git(fixture.source, "add", "-A");
        git(fixture.source, "commit", "-m", "trigger pnpm failure");
        git(fixture.source, "push", fixture.remote, "pnpm-failure");
        const pnpmFailureHead = git(fixture.source, "rev-parse", "HEAD");

        const original = fixture.metadata.pullRequests[0];
        fixture.metadata.pullRequests = [
            {
                ...original,
                number: 18,
                headRefName: "deleted-feature",
            },
            {
                ...original,
                number: 19,
                headRefName: "invalid-json",
                headSha: invalidJsonHead,
            },
            {
                ...original,
                number: 20,
                headRefName: "pnpm-failure",
                headSha: pnpmFailureHead,
            },
            original,
            {
                ...original,
                number: 21,
                headRefName: "valid-feature-2",
            },
        ];
        const outputDirectory = join(fixture.root, "isolated-artifact");
        const summary = prepareCandidateArtifact({
            metadata: fixture.metadata,
            outputDirectory,
            repositoryUrl: fixture.remote,
            pnpmCommand: createFakePnpm(
                join(fixture.root, "isolated-tools"),
                join(fixture.root, "isolated-audit"),
                { failPackageName: "trigger-pnpm-failure" },
            ),
            workDirectory: join(fixture.root, "isolated-prepare"),
        });

        assert.deepEqual(
            summary.candidates.map((candidate) => candidate.number),
            [17, 21],
        );
        assert.deepEqual(
            summary.skipped.map((candidate) => candidate.number),
            [18, 19, 20],
        );
        assert.ok(
            summary.skipped.every(
                (candidate) => candidate.status === "retryable",
            ),
        );
        assert.match(summary.skipped[0].reason, /could not be fetched/);
        assert.match(summary.skipped[1].reason, /JSON|failed with exit code/);
        assert.match(summary.skipped[2].reason, /failed with exit code/);
        assert.equal(existsSync(join(outputDirectory, "summary.json")), true);
    } finally {
        fixture.cleanup();
    }
});

test("valid candidate preserves the PR README and exact merge parents", () => {
    const fixture = createFixture();
    try {
        assert.notEqual(fixture.historicalBaseSha, fixture.trustedSha);
        assert.equal(
            fixture.metadata.pullRequests[0].baseSha,
            fixture.historicalBaseSha,
        );
        const prepared = prepare(fixture);
        assert.equal(
            prepared.summary.candidates[0].commitMessage,
            `chore: heal generated file conflicts\n\nPR #17\nTrusted-Base: ${fixture.trustedSha}\n`,
        );
        const { plan } = verify(fixture, prepared);
        const candidate = plan.candidates[0];
        const parents = git(
            plan.repositoryPath,
            "show",
            "-s",
            "--format=%P",
            candidate.candidateSha,
        ).split(" ");
        assert.deepEqual(parents, [fixture.headSha, fixture.trustedSha]);
        assert.equal(
            git(
                plan.repositoryPath,
                "show",
                `${candidate.candidateSha}:ts/packages/app/README.AUTOGEN.md`,
            ),
            "pull request readme",
        );
        assert.match(
            git(
                plan.repositoryPath,
                "show",
                `${candidate.candidateSha}:ts/pnpm-lock.yaml`,
            ),
            /fixture-lib/,
        );
    } finally {
        fixture.cleanup();
    }
});

test("finalization accepts a historical PR base SHA distinct from trusted main", () => {
    const fixture = createFixture();
    try {
        const prepared = prepare(fixture);
        const liveMetadata = {
            ...fixture.metadata,
            pullRequests: [
                {
                    ...fixture.metadata.pullRequests[0],
                    baseSha: "3".repeat(40),
                },
            ],
        };
        const plan = verifyCandidateArtifact({
            artifactDirectory: prepared.outputDirectory,
            liveMetadata,
            expectedRunId: fixture.metadata.runId,
            repositoryUrl: fixture.remote,
            pnpmCommand: prepared.pnpmCommand,
            planPath: join(fixture.root, "historical-base-plan.json"),
            workDirectory: join(fixture.root, "historical-base-verify"),
        });

        assert.deepEqual(
            plan.candidates.map((candidate) => candidate.number),
            [17],
        );
        assert.equal(plan.skipped.length, 0);
        const parents = git(
            plan.repositoryPath,
            "show",
            "-s",
            "--format=%P",
            plan.candidates[0].candidateSha,
        ).split(" ");
        assert.deepEqual(parents, [fixture.headSha, fixture.trustedSha]);
    } finally {
        fixture.cleanup();
    }
});

test("artifact metadata rejects commit message suffixes, newlines, and directives", () => {
    const fixture = createFixture();
    try {
        const prepared = prepare(fixture);
        const summaryPath = join(prepared.outputDirectory, "summary.json");
        const original = JSON.parse(readFileSync(summaryPath, "utf8"));
        const expected = original.candidates[0].commitMessage;
        for (const [name, message] of [
            ["suffix", `${expected}unexpected suffix\n`],
            ["newline", `${expected}\n`],
            ["directive", `${expected}[skip ci]\n`],
        ]) {
            const changed = structuredClone(original);
            changed.candidates[0].commitMessage = message;
            write(summaryPath, packageJson(changed));
            assert.throws(
                () =>
                    verifyCandidateArtifact({
                        artifactDirectory: prepared.outputDirectory,
                        liveMetadata: fixture.metadata,
                        expectedRunId: fixture.metadata.runId,
                        repositoryUrl: fixture.remote,
                        pnpmCommand: prepared.pnpmCommand,
                        planPath: join(fixture.root, `${name}-plan.json`),
                        workDirectory: join(fixture.root, `${name}-verify`),
                    }),
                /commit message is invalid/,
            );
        }
        write(summaryPath, packageJson(original));
    } finally {
        fixture.cleanup();
    }
});

test("commit verification rejects an object with a check-suppression directive", () => {
    const fixture = createFixture();
    try {
        const prepared = prepare(fixture);
        const expected = prepared.summary.candidates[0].commitMessage;
        rewriteCandidateCommitMessage(
            fixture,
            prepared,
            `${expected}[skip ci]\n`,
        );
        const { plan } = verify(fixture, prepared);
        assert.equal(plan.candidates.length, 0);
        assert.equal(plan.skipped.length, 1);
        assert.match(
            plan.skipped[0].reason,
            /commit message for PR #17 is invalid/,
        );
    } finally {
        fixture.cleanup();
    }
});

test("verified push advances only the exact PR head", async () => {
    const fixture = createFixture();
    try {
        git(fixture.remote, "branch", "unrelated", fixture.trustedSha);
        const prepared = prepare(fixture);
        const { plan } = verify(fixture, prepared);
        const originalMain = git(
            fixture.remote,
            "rev-parse",
            "refs/heads/main",
        );
        const originalUnrelated = git(
            fixture.remote,
            "rev-parse",
            "refs/heads/unrelated",
        );
        const api = {
            async getRepository() {
                return {
                    repository: REPOSITORY,
                    defaultBranch: "main",
                    trustedSha: fixture.trustedSha,
                };
            },
            async getPullRequest() {
                return fixture.metadata.pullRequests[0];
            },
        };
        await pushVerifiedPlan({ plan, api, token: "inert-test-token" });
        assert.equal(
            git(fixture.remote, "rev-parse", "refs/heads/feature"),
            plan.candidates[0].candidateSha,
        );
        assert.equal(
            git(fixture.remote, "rev-parse", "refs/heads/main"),
            originalMain,
        );
        assert.equal(
            git(fixture.remote, "rev-parse", "refs/heads/unrelated"),
            originalUnrelated,
        );
    } finally {
        fixture.cleanup();
    }
});

test("exact-head lease rejects a race after final verification", async () => {
    const fixture = createFixture();
    try {
        const prepared = prepare(fixture);
        const { plan } = verify(fixture, prepared);
        git(fixture.source, "checkout", "feature");
        write(join(fixture.source, "race.txt"), "moved\n");
        git(fixture.source, "add", "race.txt");
        git(fixture.source, "commit", "-m", "move head");
        git(fixture.source, "push", fixture.remote, "feature");
        const movedHead = git(
            fixture.remote,
            "rev-parse",
            "refs/heads/feature",
        );
        const api = {
            async getRepository() {
                return {
                    repository: REPOSITORY,
                    defaultBranch: "main",
                    trustedSha: fixture.trustedSha,
                };
            },
            async getPullRequest() {
                return fixture.metadata.pullRequests[0];
            },
        };
        const result = await pushVerifiedPlan({
            plan,
            api,
            token: "inert-test-token",
        });
        assert.deepEqual(result.pushed, []);
        assert.equal(result.skipped.length, 1);
        assert.match(
            result.skipped[0].reason,
            /stale info|failed with exit code/,
        );
        assert.equal(
            git(fixture.remote, "rev-parse", "refs/heads/feature"),
            movedHead,
        );
    } finally {
        fixture.cleanup();
    }
});

test("one raced push does not prevent another verified candidate from advancing", async () => {
    const fixture = createFixture();
    try {
        git(fixture.remote, "branch", "feature-race", fixture.headSha);
        git(fixture.remote, "branch", "feature-valid", fixture.headSha);
        const original = fixture.metadata.pullRequests[0];
        fixture.metadata.pullRequests = [
            {
                ...original,
                number: 18,
                headRefName: "feature-race",
            },
            {
                ...original,
                number: 19,
                headRefName: "feature-valid",
            },
        ];
        const prepared = prepare(fixture);
        const { plan } = verify(fixture, prepared);

        git(fixture.source, "checkout", "-B", "feature-race", "feature");
        write(join(fixture.source, "race.txt"), "moved\n");
        git(fixture.source, "add", "race.txt");
        git(fixture.source, "commit", "-m", "race candidate");
        git(fixture.source, "push", fixture.remote, "feature-race");
        const movedRace = git(
            fixture.remote,
            "rev-parse",
            "refs/heads/feature-race",
        );
        const api = {
            async getRepository() {
                return {
                    repository: REPOSITORY,
                    defaultBranch: "main",
                    trustedSha: fixture.trustedSha,
                };
            },
            async getPullRequest(number) {
                return fixture.metadata.pullRequests.find(
                    (pr) => pr.number === number,
                );
            },
        };
        const result = await pushVerifiedPlan({
            plan,
            api,
            token: "inert-test-token",
        });

        assert.deepEqual(result.pushed, [19]);
        assert.equal(result.skipped.length, 1);
        assert.equal(result.skipped[0].number, 18);
        assert.equal(
            git(fixture.remote, "rev-parse", "refs/heads/feature-race"),
            movedRace,
        );
        assert.equal(
            git(fixture.remote, "rev-parse", "refs/heads/feature-valid"),
            plan.candidates.find((candidate) => candidate.number === 19)
                .candidateSha,
        );
    } finally {
        fixture.cleanup();
    }
});

test("final API revalidation rejects changed PR identity without updating a ref", async () => {
    const fixture = createFixture();
    try {
        const prepared = prepare(fixture);
        const { plan } = verify(fixture, prepared);
        const expectedHead = git(
            fixture.remote,
            "rev-parse",
            "refs/heads/feature",
        );
        const variants = [
            { state: "closed" },
            { isCrossRepository: true },
            { headRepository: "attacker/fork" },
            { baseRepository: "attacker/fork" },
            { baseRefName: "release" },
            { headRefName: "renamed" },
            { headSha: "4".repeat(40) },
        ];
        for (const variant of variants) {
            const api = {
                async getRepository() {
                    return {
                        repository: REPOSITORY,
                        defaultBranch: "main",
                        trustedSha: fixture.trustedSha,
                    };
                },
                async getPullRequest() {
                    return {
                        ...fixture.metadata.pullRequests[0],
                        ...variant,
                    };
                },
            };
            const result = await pushVerifiedPlan({
                plan,
                api,
                token: "inert-test-token",
            });
            assert.deepEqual(result.pushed, []);
            assert.equal(result.skipped.length, 1);
            assert.equal(
                git(fixture.remote, "rev-parse", "refs/heads/feature"),
                expectedHead,
            );
        }
    } finally {
        fixture.cleanup();
    }
});

test("non-generated conflicts produce no candidate and update no ref", () => {
    const fixture = createFixture({ nonGeneratedConflict: true });
    try {
        const prepared = prepare(fixture);
        assert.equal(prepared.summary.candidates.length, 0);
        assert.equal(prepared.summary.skipped[0].status, "blocked");
        assert.match(prepared.summary.skipped[0].reason, /source\.ts/);
        assert.equal(
            git(fixture.remote, "rev-parse", "refs/heads/feature"),
            fixture.headSha,
        );
    } finally {
        fixture.cleanup();
    }
});

test("PR-controlled merge attributes cannot hide a non-generated conflict", () => {
    const fixture = createFixture({ maliciousMergeAttributes: true });
    try {
        const prepared = prepare(fixture);
        assert.equal(prepared.summary.candidates.length, 0);
        assert.equal(prepared.summary.skipped.length, 1);
        assert.equal(prepared.summary.skipped[0].status, "blocked");
        assert.match(
            prepared.summary.skipped[0].reason,
            /merge behavior differs.*\.gitattributes/,
        );
        assert.equal(
            git(fixture.remote, "rev-parse", "refs/heads/feature"),
            fixture.headSha,
        );
    } finally {
        fixture.cleanup();
    }
});

test("missing, malformed, or moved trusted revisions fail before candidate creation", () => {
    const fixture = createFixture();
    try {
        for (const trustedSha of [
            "not-a-sha",
            "0".repeat(40),
            fixture.headSha,
        ]) {
            const outputDirectory = join(
                fixture.root,
                `artifact-${trustedSha.slice(0, 8)}`,
            );
            assert.throws(
                () =>
                    prepareCandidateArtifact({
                        metadata: {
                            ...fixture.metadata,
                            trustedSha,
                            pullRequests: fixture.metadata.pullRequests.map(
                                (pr) => ({ ...pr, baseSha: trustedSha }),
                            ),
                        },
                        outputDirectory,
                        repositoryUrl: fixture.remote,
                        pnpmCommand: createFakePnpm(
                            join(
                                fixture.root,
                                `tools-${trustedSha.slice(0, 8)}`,
                            ),
                            join(fixture.root, "unused-audit.json"),
                        ),
                        workDirectory: join(
                            fixture.root,
                            `work-${trustedSha.slice(0, 8)}`,
                        ),
                    }),
                /full lowercase commit SHA|couldn't find remote ref|Default branch moved|head unexpectedly equals/,
            );
            assert.equal(
                existsSync(join(outputDirectory, "summary.json")),
                false,
            );
        }
    } finally {
        fixture.cleanup();
    }
});

for (const [name, mutate, expected] of [
    ["fork", (pr) => ({ ...pr, isCrossRepository: true }), /cross-repository/],
    [
        "wrong repository",
        (pr) => ({ ...pr, headRepository: "attacker/fork" }),
        /head repository/,
    ],
    [
        "wrong base repository",
        (pr) => ({ ...pr, baseRepository: "attacker/fork" }),
        /base repository/,
    ],
    [
        "wrong base",
        (pr) => ({ ...pr, baseRefName: "release" }),
        /targets release/,
    ],
    ["closed PR", (pr) => ({ ...pr, state: "closed" }), /is not open/],
    [
        "moved head",
        (pr) => ({ ...pr, headSha: "1".repeat(40) }),
        /head moved|changed/,
    ],
    [
        "renamed head",
        (pr) => ({ ...pr, headRefName: "renamed" }),
        /head ref|couldn't find remote ref/,
    ],
]) {
    test(`${name} metadata fails closed`, () => {
        const fixture = createFixture();
        try {
            const metadata = {
                ...fixture.metadata,
                pullRequests: [mutate(fixture.metadata.pullRequests[0])],
            };
            if (name === "moved head" || name === "renamed head") {
                const summary = prepareCandidateArtifact({
                    metadata,
                    outputDirectory: join(fixture.root, "bad-artifact"),
                    repositoryUrl: fixture.remote,
                    pnpmCommand: createFakePnpm(
                        join(fixture.root, "bad-tools"),
                        join(fixture.root, "bad-audit"),
                    ),
                    workDirectory: join(fixture.root, "bad-work"),
                });
                assert.equal(summary.candidates.length, 0);
                assert.equal(summary.skipped.length, 1);
                assert.match(summary.skipped[0].reason, expected);
            } else {
                assert.throws(() => validateMetadata(metadata), expected);
            }
        } finally {
            fixture.cleanup();
        }
    });
}

test("artifact verification rejects stale live PR metadata", () => {
    const fixture = createFixture();
    try {
        const prepared = prepare(fixture);
        const stale = {
            ...fixture.metadata,
            pullRequests: [
                {
                    ...fixture.metadata.pullRequests[0],
                    headSha: "2".repeat(40),
                },
            ],
        };
        const plan = verifyCandidateArtifact({
            artifactDirectory: prepared.outputDirectory,
            liveMetadata: stale,
            expectedRunId: fixture.metadata.runId,
            repositoryUrl: fixture.remote,
            pnpmCommand: prepared.pnpmCommand,
            planPath: join(fixture.root, "stale-plan.json"),
            workDirectory: join(fixture.root, "stale-verify"),
        });
        assert.equal(plan.candidates.length, 0);
        assert.equal(plan.skipped.length, 1);
        assert.match(plan.skipped[0].reason, /headSha changed/);
    } finally {
        fixture.cleanup();
    }
});

test("one stale artifact candidate does not prevent another from finalizing", () => {
    const fixture = createFixture();
    try {
        git(fixture.remote, "branch", "valid-feature-2", fixture.headSha);
        const original = fixture.metadata.pullRequests[0];
        fixture.metadata.pullRequests = [
            original,
            {
                ...original,
                number: 18,
                headRefName: "valid-feature-2",
            },
        ];
        const prepared = prepare(fixture);
        const liveMetadata = {
            ...fixture.metadata,
            pullRequests: [
                {
                    ...original,
                    headSha: "2".repeat(40),
                },
                fixture.metadata.pullRequests[1],
            ],
        };
        const plan = verifyCandidateArtifact({
            artifactDirectory: prepared.outputDirectory,
            liveMetadata,
            expectedRunId: fixture.metadata.runId,
            repositoryUrl: fixture.remote,
            pnpmCommand: prepared.pnpmCommand,
            planPath: join(fixture.root, "mixed-stale-plan.json"),
            workDirectory: join(fixture.root, "mixed-stale-verify"),
        });

        assert.deepEqual(
            plan.candidates.map((candidate) => candidate.number),
            [18],
        );
        assert.deepEqual(
            plan.skipped.map((candidate) => candidate.number),
            [17],
        );
        assert.match(plan.skipped[0].reason, /headSha changed/);
    } finally {
        fixture.cleanup();
    }
});

test("real pnpm heals an entirely local workspace without lifecycle markers", (t) => {
    const probe = spawnSync("pnpm", ["--version"], {
        encoding: "utf8",
        shell: process.platform === "win32",
    });
    if (probe.status !== 0) {
        t.skip("standalone pnpm is not available");
        return;
    }
    const fixture = createFixture();
    try {
        const marker = join(fixture.markerDirectory, "real-pnpm-lifecycle");
        git(fixture.source, "checkout", "feature");
        const appPath = join(
            fixture.source,
            "ts",
            "packages",
            "app",
            "package.json",
        );
        const app = JSON.parse(readFileSync(appPath, "utf8"));
        app.scripts.postinstall = `node -e "require('fs').writeFileSync('${marker.replaceAll("\\", "\\\\")}','ran')"`;
        write(appPath, packageJson(app));
        git(fixture.source, "add", appPath);
        git(fixture.source, "commit", "-m", "local workspace dependency");
        git(fixture.source, "push", fixture.remote, "feature");
        fixture.metadata.pullRequests[0].headSha = git(
            fixture.source,
            "rev-parse",
            "HEAD",
        );

        const outputDirectory = join(fixture.root, "real-artifact");
        const pnpmCommand = resolveStandalonePnpmCommand();
        const summary = prepareCandidateArtifact({
            metadata: fixture.metadata,
            outputDirectory,
            repositoryUrl: fixture.remote,
            pnpmCommand,
            workDirectory: join(fixture.root, "real-prepare"),
        });
        assert.equal(summary.candidates.length, 1);
        assert.equal(existsSync(marker), false);
        assert.equal(
            existsSync(join(fixture.markerDirectory, "root-lifecycle")),
            false,
        );
        const verified = verifyCandidateArtifact({
            artifactDirectory: outputDirectory,
            liveMetadata: fixture.metadata,
            expectedRunId: fixture.metadata.runId,
            repositoryUrl: fixture.remote,
            pnpmCommand,
            planPath: join(fixture.root, "real-plan.json"),
            workDirectory: join(fixture.root, "real-verify"),
        });
        const lockfile = git(
            verified.repositoryPath,
            "show",
            `${verified.candidates[0].candidateSha}:ts/pnpm-lock.yaml`,
        );
        assert.match(lockfile, /fixture-lib/);
    } finally {
        fixture.cleanup();
    }
});

test("workflow split keeps trusted preparation credential-free and token use isolated", () => {
    const producerText = readFileSync(PRODUCER_WORKFLOW, "utf8");
    const finalizerText = readFileSync(FINALIZER_WORKFLOW, "utf8");
    const producer = yaml.load(producerText);
    const finalizer = yaml.load(finalizerText);
    const producerSteps = producer.jobs.prepare.steps;
    const finalizerSteps = finalizer.jobs.finalize.steps;
    const allCheckouts = [...producerSteps, ...finalizerSteps].filter((step) =>
        String(step.uses ?? "").startsWith("actions/checkout@"),
    );

    assert.equal(producer.permissions.contents, "read");
    assert.equal(producer.permissions["pull-requests"], "read");
    const metadataStep = producerSteps.find(
        (step) =>
            step.name === "Resolve trusted revision and pull request metadata",
    );
    const fetchStep = producerSteps.find(
        (step) =>
            step.name ===
            "Fetch and verify trusted implementation without credentials",
    );
    const prepareStep = producerSteps.find(
        (step) => step.name === "Prepare credential-free healing candidates",
    );
    const contractStep = producerSteps.find(
        (step) => step.name === "Verify trusted healer contract",
    );
    const uploadStep = producerSteps.find(
        (step) => step.name === "Upload healing candidates",
    );
    assert.equal(metadataStep.with["github-token"], "${{ github.token }}");
    assert.doesNotMatch(JSON.stringify(fetchStep), /\$\{\{ github\.token \}\}/);
    assert.match(fetchStep.run, /credential\.helper=/);
    assert.match(
        fetchStep.run,
        /\+refs\/heads\/\$\{DEFAULT_BRANCH\}:refs\/remotes\/origin\/\$\{DEFAULT_BRANCH\}/,
    );
    assert.deepEqual(Object.keys(prepareStep.env).sort(), [
        "METADATA_PATH",
        "REPOSITORY",
    ]);
    assert.doesNotMatch(
        JSON.stringify(prepareStep),
        /\$\{\{ github\.token \}\}/,
    );
    assert.match(prepareStep.run, /env -i/);
    assert.doesNotMatch(
        prepareStep.run,
        /\b(?:GH_TOKEN|GITHUB_TOKEN|GIT_ASKPASS|SSH_ASKPASS|GIT_CONFIG_COUNT)\b/,
    );
    assert.equal(
        producerSteps.filter((step) =>
            JSON.stringify(step).includes("${{ github.token }}"),
        ).length,
        1,
    );
    assert.equal(contractStep.if, undefined);
    assert.match(contractStep.run, /previously_deployed/);
    assert.match(contractStep.run, /EVENT_NAME.*pull_request/s);
    assert.equal(
        prepareStep.if,
        "steps.healer-contract.outputs.available == 'true'",
    );
    assert.equal(uploadStep.if, prepareStep.if);
    assert.equal(
        producerSteps.some((step) =>
            String(step.uses ?? "").includes("create-github-app-token"),
        ),
        false,
    );
    assert.ok(allCheckouts.length > 0);
    assert.ok(
        allCheckouts.every(
            (step) => step.with?.["persist-credentials"] === false,
        ),
    );
    assert.equal(
        finalizer.on.workflow_run.workflows[0],
        "Prepare Generated File Healing",
    );
    const verifyIndex = finalizerSteps.findIndex(
        (step) =>
            step.name ===
            "Verify candidate object graph and live pull request state",
    );
    const tokenIndex = finalizerSteps.findIndex(
        (step) => step.name === "Mint minimally scoped App token",
    );
    const pushIndex = finalizerSteps.findIndex(
        (step) => step.name === "Revalidate and push with exact-head lease",
    );
    assert.ok(verifyIndex < tokenIndex);
    assert.ok(tokenIndex < pushIndex);
    assert.equal(
        finalizerSteps[tokenIndex].with["permission-contents"],
        "write",
    );
    assert.equal(
        finalizerSteps[tokenIndex].with["permission-pull-requests"],
        "read",
    );
    assert.deepEqual(Object.keys(finalizerSteps[pushIndex].env).sort(), [
        "GITHUB_API_URL",
        "HEAL_PUSH_TOKEN",
        "PLAN_PATH",
    ]);
    assert.doesNotMatch(producerText, /\b(?:GH_TOKEN|GITHUB_TOKEN)\b/);
    assert.doesNotMatch(finalizerText, /GH_TOKEN|GITHUB_TOKEN/);
    assert.match(finalizerText, /--force-with-lease|exact-head lease/);
    assert.match(producerText, /trusted\/ts\/package\.json/);
    assert.match(finalizerText, /trusted\/ts\/package\.json/);
    assert.match(producerText, /baseRepository/);
    assert.match(finalizerText, /baseRepository/);
});
