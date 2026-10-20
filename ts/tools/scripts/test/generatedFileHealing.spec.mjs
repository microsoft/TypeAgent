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
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...options,
    });
    assert.ifError(result.error);
    assert.equal(
        result.status,
        0,
        `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
    );
    return result.stdout.trim();
}

function git(repository, ...args) {
    return run("git", [
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

function createFakePnpm(directory, auditPath) {
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
writeFileSync(
  join(process.cwd(), "pnpm-lock.yaml"),
  "lockfileVersion: '9.0'\\n# " + JSON.stringify(packages) + "\\n",
);
`,
    );
    chmodSync(script, 0o700);
    return script;
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
    if (options.nonGeneratedConflict) {
        write(join(source, "ts", "packages", "app", "source.ts"), "base\n");
    }
    git(source, "add", "-A");
    git(source, "commit", "-m", "base");

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
    git(source, "add", "-A");
    git(source, "commit", "-m", "trusted main");
    const trustedSha = git(source, "rev-parse", "HEAD");

    run("git", ["clone", "--bare", source, remote]);
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
                headRefName: "feature",
                headSha,
                baseRefName: "main",
                baseSha: trustedSha,
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
            assert.throws(() => prepare(fixture), expected);
            assert.equal(
                existsSync(join(fixture.markerDirectory, marker)),
                false,
            );
            assert.equal(
                existsSync(join(fixture.root, "artifact", "summary.json")),
                false,
            );
        } finally {
            fixture.cleanup();
        }
    });
}

test("valid candidate preserves the PR README and exact merge parents", () => {
    const fixture = createFixture();
    try {
        const prepared = prepare(fixture);
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
        await assert.rejects(
            () =>
                pushVerifiedPlan({
                    plan,
                    api,
                    token: "inert-test-token",
                }),
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
            { baseRefName: "release" },
            { baseSha: "3".repeat(40) },
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
            await assert.rejects(() =>
                pushVerifiedPlan({
                    plan,
                    api,
                    token: "inert-test-token",
                }),
            );
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
                assert.throws(
                    () =>
                        prepareCandidateArtifact({
                            metadata,
                            outputDirectory: join(fixture.root, "bad-artifact"),
                            repositoryUrl: fixture.remote,
                            pnpmCommand: createFakePnpm(
                                join(fixture.root, "bad-tools"),
                                join(fixture.root, "bad-audit"),
                            ),
                            workDirectory: join(fixture.root, "bad-work"),
                        }),
                    expected,
                );
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
        assert.throws(
            () =>
                verifyCandidateArtifact({
                    artifactDirectory: prepared.outputDirectory,
                    liveMetadata: stale,
                    expectedRunId: fixture.metadata.runId,
                    repositoryUrl: fixture.remote,
                    pnpmCommand: prepared.pnpmCommand,
                    planPath: join(fixture.root, "stale-plan.json"),
                    workDirectory: join(fixture.root, "stale-verify"),
                }),
            /headSha changed/,
        );
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
        const pnpmCommand =
            process.platform === "win32"
                ? join(
                      dirname(
                          run("where.exe", ["pnpm"])
                              .split(/\r?\n/)
                              .filter((path) => path.endsWith("pnpm.cmd"))
                              .at(-1),
                      ),
                      "node_modules",
                      "pnpm",
                      "bin",
                      "pnpm.cjs",
                  )
                : run("sh", ["-c", "command -v pnpm"]);
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

test("workflow split keeps untrusted preparation unprivileged and token use isolated", () => {
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
    assert.doesNotMatch(producerText, /GH_TOKEN|GITHUB_TOKEN/);
    assert.doesNotMatch(finalizerText, /GH_TOKEN|GITHUB_TOKEN/);
    assert.match(finalizerText, /--force-with-lease|exact-head lease/);
    assert.match(producerText, /trusted\/ts\/package\.json/);
    assert.match(finalizerText, /trusted\/ts\/package\.json/);
});
