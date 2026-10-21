// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    chmodSync,
    closeSync,
    constants as fsConstants,
    copyFileSync,
    fstatSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    realpathSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
    sep,
} from "node:path";

export const ARTIFACT_VERSION = 1;
export const LOCKFILE = "ts/pnpm-lock.yaml";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const AUTOGEN_README_PATTERN = /^ts\/packages\/.+\/README\.AUTOGEN\.md$/;
const BLOCKED_PACKAGE_MANAGER_PATHS = [
    /(^|\/)\.npmrc$/,
    /(^|\/)\.pnpmrc$/,
    /(^|\/)\.?pnpmfile(?:\.[^/]+)?$/,
    /^ts\/pnpm-workspace\.yaml$/,
    /^ts\/patches\//,
    /^ts\/\.pnpm\//,
];
const BLOCKED_MERGE_BEHAVIOR_PATHS = [
    /(^|\/)\.gitattributes$/,
    /^\.gitmodules$/,
];
const TRUSTED_ROOT_PACKAGE_FIELDS = [
    "packageManager",
    "pnpm",
    "engines",
    "devEngines",
];
const COMMIT_MESSAGE = "chore: heal generated file conflicts";
const BOT_NAME = "typeagent-bot";
const BOT_EMAIL = "typeagent-bot[bot]@users.noreply.github.com";

function fail(message) {
    throw new Error(message);
}

class RepositoryFatalError extends Error {
    constructor(message) {
        super(message);
        this.name = "RepositoryFatalError";
    }
}

class CandidateOutcomeError extends Error {
    constructor(status, message) {
        super(message);
        this.name = "CandidateOutcomeError";
        this.status = status;
    }
}

function blockCandidate(message) {
    throw new CandidateOutcomeError("blocked", message);
}

function retryCandidate(message) {
    throw new CandidateOutcomeError("retryable", message);
}

function fatalRepository(message) {
    throw new RepositoryFatalError(message);
}

function isInfrastructureFailure(error) {
    return new Set([
        "EACCES",
        "EBUSY",
        "EIO",
        "EMFILE",
        "ENFILE",
        "ENOMEM",
        "ENOSPC",
        "EPERM",
        "EROFS",
    ]).has(error?.code);
}

function candidateOutcome(number, error, fallbackStatus = "retryable") {
    if (
        error instanceof RepositoryFatalError ||
        isInfrastructureFailure(error)
    ) {
        throw error;
    }
    return {
        number,
        status:
            error instanceof CandidateOutcomeError
                ? error.status
                : fallbackStatus,
        reason: error.message,
        conflicts:
            error instanceof CandidateOutcomeError
                ? (error.conflicts ?? [])
                : [],
    };
}

function assert(condition, message) {
    if (!condition) {
        fail(message);
    }
}

function normalizeRepository(repository) {
    assert(
        typeof repository === "string" &&
            /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository),
        `Invalid repository: ${repository}`,
    );
    return repository;
}

function normalizeSha(value, label) {
    assert(
        typeof value === "string" && SHA_PATTERN.test(value),
        `${label} must be a full lowercase commit SHA`,
    );
    return value;
}

function normalizeRef(value, label) {
    assert(
        typeof value === "string" &&
            value.length > 0 &&
            value.length <= 255 &&
            !value.startsWith("-") &&
            !value.startsWith("/") &&
            !value.endsWith("/") &&
            !value.endsWith(".") &&
            !value.includes("..") &&
            !value.includes("@{") &&
            !/[~^:?*[\\\x00-\x20\x7f]/.test(value) &&
            !value
                .split("/")
                .some((part) => part === "" || part.endsWith(".lock")),
        `${label} is not a safe Git branch name`,
    );
    return value;
}

function normalizePrNumber(value) {
    assert(
        Number.isInteger(value) && value > 0,
        `Invalid pull request number: ${value}`,
    );
    return value;
}

function normalizePath(path) {
    assert(typeof path === "string" && path.length > 0, "Git path is invalid");
    assert(!path.includes("\\"), `Git path contains a backslash: ${path}`);
    assert(
        path
            .split("/")
            .every((part) => part !== "" && part !== "." && part !== ".."),
        `Git path contains an unsafe component: ${path}`,
    );
    return path;
}

function normalizeCandidatePath(path) {
    try {
        return normalizePath(path);
    } catch (error) {
        blockCandidate(error.message);
    }
}

export function isAutogenReadme(path) {
    return AUTOGEN_README_PATTERN.test(normalizePath(path));
}

export function isResolvableConflict(path) {
    const normalized = normalizePath(path);
    return normalized === LOCKFILE || isAutogenReadme(normalized);
}

export function isBlockedPackageManagerPath(path) {
    const normalized = normalizePath(path);
    return BLOCKED_PACKAGE_MANAGER_PATHS.some((pattern) =>
        pattern.test(normalized),
    );
}

function stableJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function deepEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function readJson(path, label = path) {
    const stat = lstatSync(path);
    assert(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a file`);
    assert(stat.size <= 1024 * 1024, `${label} is unexpectedly large`);
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
        fail(`${label} is not valid JSON: ${error.message}`);
    }
}

function writeJson(path, value) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stableJson(value));
}

function commandError(command, args, result) {
    return new Error(
        `${command} ${args.join(" ")} failed with exit code ${result.status}\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...options,
    });
    if (result.error) {
        if (result.error.code === "ENOENT") {
            fatalRepository(
                `Trusted pnpm executable is unavailable: ${command}`,
            );
        }
        throw result.error;
    }
    if (result.status !== 0) {
        throw commandError(command, args, result);
    }
    return result.stdout;
}

function tryRun(command, args, options = {}) {
    const result = spawnSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...options,
    });
    return {
        ok: !result.error && result.status === 0,
        status: result.status,
        output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
        error: result.error,
    };
}

function createIsolatedEnvironment(baseEnvironment, home) {
    mkdirSync(home, { recursive: true });
    const globalConfig = join(home, "gitconfig");
    const npmConfig = join(home, "npmrc");
    writeFileSync(globalConfig, "");
    writeFileSync(
        npmConfig,
        [
            "ignore-scripts=true",
            "manage-package-manager-versions=false",
            "enable-pre-post-scripts=false",
            "",
        ].join("\n"),
    );

    const environment = {
        CI: "true",
        HOME: home,
        XDG_CONFIG_HOME: join(home, "xdg-config"),
        XDG_CACHE_HOME: join(home, "xdg-cache"),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: globalConfig,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ATTR_NOSYSTEM: "1",
        GCM_INTERACTIVE: "Never",
        NPM_CONFIG_USERCONFIG: npmConfig,
        npm_config_userconfig: npmConfig,
        NPM_CONFIG_IGNORE_SCRIPTS: "true",
        npm_config_ignore_scripts: "true",
        NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: "false",
        npm_config_manage_package_manager_versions: "false",
    };
    for (const name of [
        "PATH",
        "Path",
        "PATHEXT",
        "SYSTEMROOT",
        "SystemRoot",
        "WINDIR",
        "COMSPEC",
        "TEMP",
        "TMP",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "TZ",
    ]) {
        if (baseEnvironment[name] !== undefined) {
            environment[name] = baseEnvironment[name];
        }
    }
    return environment;
}

function gitArguments(args) {
    return [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "credential.helper=",
        "-c",
        "credential.interactive=never",
        "-c",
        "protocol.file.allow=always",
        "-c",
        "safe.bareRepository=all",
        "-c",
        "merge.pnpm-lock.driver=false",
        "-c",
        "merge.keep-ours.driver=false",
        ...args,
    ];
}

function git(repositoryPath, args, options = {}) {
    const location = repositoryPath
        ? ["-C", repositoryPath, ...gitArguments(args)]
        : gitArguments(args);
    return run("git", location, options).trim();
}

function tryGit(repositoryPath, args, options = {}) {
    const location = repositoryPath
        ? ["-C", repositoryPath, ...gitArguments(args)]
        : gitArguments(args);
    return tryRun("git", location, options);
}

function lines(value) {
    return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function zeroTerminated(value) {
    return value.split("\0").filter(Boolean);
}

function readGitFile(repositoryPath, revision, path, environment) {
    return run(
        "git",
        [
            "-C",
            repositoryPath,
            ...gitArguments(["show", `${revision}:${normalizePath(path)}`]),
        ],
        { env: environment },
    );
}

function validatePullRequest(pr, repository, defaultBranch, trustedSha) {
    assert(pr && typeof pr === "object", "Pull request metadata is missing");
    const normalized = {
        number: normalizePrNumber(pr.number),
        state: pr.state,
        isCrossRepository: pr.isCrossRepository,
        headRepository: normalizeRepository(pr.headRepository),
        baseRepository: normalizeRepository(pr.baseRepository),
        headRefName: normalizeRef(pr.headRefName, "Pull request head ref"),
        headSha: normalizeSha(pr.headSha, "Pull request head SHA"),
        baseRefName: normalizeRef(pr.baseRefName, "Pull request base ref"),
        baseSha: normalizeSha(pr.baseSha, "Pull request base SHA"),
    };
    assert(normalized.state === "open", `PR #${normalized.number} is not open`);
    assert(
        normalized.isCrossRepository === false,
        `PR #${normalized.number} is cross-repository`,
    );
    assert(
        normalized.headRepository === repository,
        `PR #${normalized.number} head repository does not match ${repository}`,
    );
    assert(
        normalized.baseRepository === repository,
        `PR #${normalized.number} base repository does not match ${repository}`,
    );
    assert(
        normalized.baseRefName === defaultBranch,
        `PR #${normalized.number} targets ${normalized.baseRefName}, not ${defaultBranch}`,
    );
    assert(
        normalized.headRefName !== defaultBranch,
        `PR #${normalized.number} head ref must not be the default branch`,
    );
    assert(
        normalized.headSha !== trustedSha,
        `PR #${normalized.number} head unexpectedly equals the trusted revision`,
    );
    return normalized;
}

export function validateMetadata(metadata) {
    assert(metadata && typeof metadata === "object", "Metadata is missing");
    const repository = normalizeRepository(metadata.repository);
    const defaultBranch = normalizeRef(
        metadata.defaultBranch,
        "Default branch",
    );
    const trustedSha = normalizeSha(
        metadata.trustedSha,
        "Trusted default-branch SHA",
    );
    assert(
        typeof metadata.runId === "string" && /^\d+$/.test(metadata.runId),
        "Workflow run ID is invalid",
    );
    assert(
        Array.isArray(metadata.pullRequests),
        "Pull request list is invalid",
    );
    const pullRequests = metadata.pullRequests.map((pr) =>
        validatePullRequest(pr, repository, defaultBranch, trustedSha),
    );
    assert(
        new Set(pullRequests.map((pr) => pr.number)).size ===
            pullRequests.length,
        "Pull request metadata contains duplicate numbers",
    );
    assert(
        new Set(pullRequests.map((pr) => pr.headRefName)).size ===
            pullRequests.length,
        "Pull request metadata contains duplicate head refs",
    );
    return {
        repository,
        defaultBranch,
        trustedSha,
        runId: metadata.runId,
        pullRequests,
    };
}

function validateMatchingPullRequest(expected, actual) {
    for (const field of [
        "number",
        "state",
        "isCrossRepository",
        "headRepository",
        "baseRepository",
        "headRefName",
        "headSha",
        "baseRefName",
    ]) {
        assert(
            actual[field] === expected[field],
            `PR #${expected.number} ${field} changed after candidate preparation`,
        );
    }
}

function initRepository({ directory, repositoryUrl, metadata, environment }) {
    mkdirSync(directory, { recursive: true });
    git(null, ["init", "--bare", directory], { env: environment });
    git(directory, ["config", "user.name", BOT_NAME], {
        env: environment,
    });
    git(directory, ["config", "user.email", BOT_EMAIL], {
        env: environment,
    });
    git(directory, ["remote", "add", "origin", repositoryUrl], {
        env: environment,
    });

    git(
        directory,
        [
            "fetch",
            "--no-tags",
            "origin",
            `+refs/heads/${metadata.defaultBranch}:refs/heal/default`,
        ],
        { env: environment },
    );

    const fetchedDefault = git(
        directory,
        ["rev-parse", "refs/heal/default^{commit}"],
        { env: environment },
    );
    if (fetchedDefault !== metadata.trustedSha) {
        fatalRepository(
            `Default branch moved from trusted SHA ${metadata.trustedSha} to ${fetchedDefault}`,
        );
    }
    git(
        directory,
        ["merge-base", "--is-ancestor", metadata.trustedSha, fetchedDefault],
        { env: environment },
    );

    git(directory, ["fsck", "--strict"], { env: environment });
}

function fetchPullRequest(repositoryPath, pr, environment) {
    const target = `refs/heal/heads/pr-${pr.number}`;
    tryGit(repositoryPath, ["update-ref", "-d", target], {
        env: environment,
    });
    const fetched = tryGit(
        repositoryPath,
        [
            "fetch",
            "--no-tags",
            "origin",
            `+refs/heads/${pr.headRefName}:${target}`,
        ],
        { env: environment },
    );
    if (!fetched.ok) {
        retryCandidate(
            `PR #${pr.number} head ${pr.headRefName} could not be fetched: ${fetched.output.trim()}`,
        );
    }
    const fetchedHead = git(
        repositoryPath,
        ["rev-parse", `${target}^{commit}`],
        { env: environment },
    );
    if (fetchedHead !== pr.headSha) {
        retryCandidate(
            `PR #${pr.number} head moved from ${pr.headSha} to ${fetchedHead}`,
        );
    }
}

function changedPaths(repositoryPath, trustedSha, headSha, environment) {
    return zeroTerminated(
        run(
            "git",
            [
                "-C",
                repositoryPath,
                ...gitArguments([
                    "diff",
                    "--name-only",
                    "-z",
                    `${trustedSha}...${headSha}`,
                    "--",
                ]),
            ],
            { env: environment },
        ),
    ).map(normalizeCandidatePath);
}

function assertTrustedRootPackageFields(
    repositoryPath,
    trustedSha,
    headSha,
    environment,
) {
    const trusted = JSON.parse(
        readGitFile(repositoryPath, trustedSha, "ts/package.json", environment),
    );
    const head = JSON.parse(
        readGitFile(repositoryPath, headSha, "ts/package.json", environment),
    );
    for (const field of TRUSTED_ROOT_PACKAGE_FIELDS) {
        if (!deepEqual(trusted[field], head[field])) {
            blockCandidate(
                `PR changes trusted package-manager field ts/package.json#${field}`,
            );
        }
    }
}

function assertSafePackageManagerInputs(
    repositoryPath,
    trustedSha,
    headSha,
    environment,
) {
    const blockedPath = changedPaths(
        repositoryPath,
        trustedSha,
        headSha,
        environment,
    ).find(isBlockedPackageManagerPath);
    if (blockedPath) {
        blockCandidate(
            `PR changes executable package-manager configuration: ${blockedPath}`,
        );
    }
    assertTrustedRootPackageFields(
        repositoryPath,
        trustedSha,
        headSha,
        environment,
    );
}

function assertTrustedMergeBehavior(
    repositoryPath,
    trustedSha,
    headSha,
    environment,
) {
    const changed = zeroTerminated(
        run(
            "git",
            [
                "-C",
                repositoryPath,
                ...gitArguments([
                    "diff",
                    "--name-only",
                    "-z",
                    trustedSha,
                    headSha,
                    "--",
                ]),
            ],
            { env: environment },
        ),
    ).map(normalizeCandidatePath);
    const blockedPath = changed.find((path) =>
        BLOCKED_MERGE_BEHAVIOR_PATHS.some((pattern) => pattern.test(path)),
    );
    if (blockedPath) {
        blockCandidate(
            `PR merge behavior differs from the trusted revision: ${blockedPath}`,
        );
    }
}

function isRegularGitMode(mode) {
    return mode === "100644" || mode === "100755";
}

function indexEntries(worktree, path, environment) {
    const output = run(
        "git",
        [
            "-C",
            worktree,
            ...gitArguments(["ls-files", "--stage", "-z", "--", path]),
        ],
        { env: environment },
    );
    return zeroTerminated(output).map((entry) => {
        const match = /^(\d{6}) ([0-9a-f]+) ([0-3])\t(.*)$/.exec(entry);
        assert(match, `Invalid index entry for ${path}`);
        return {
            mode: match[1],
            stage: Number(match[3]),
            path: match[4],
        };
    });
}

function assertRegularGeneratedConflict(worktree, path, environment) {
    const entries = indexEntries(worktree, path, environment);
    if (
        entries.length === 0 ||
        entries.some(
            (entry) => entry.path !== path || !isRegularGitMode(entry.mode),
        )
    ) {
        blockCandidate(`Generated path has a non-regular Git mode: ${path}`);
    }
    const ours = entries.find((entry) => entry.stage === 2);
    if (!ours) {
        blockCandidate(`Generated path has no PR-side conflict entry: ${path}`);
    }
    return ours.mode;
}

function containedRegularPath(root, path) {
    const normalized = normalizeCandidatePath(path);
    const rootPath = realpathSync(root);
    const destination = resolve(root, ...normalized.split("/"));
    const relativeDestination = relative(rootPath, destination);
    if (
        relativeDestination === "" ||
        relativeDestination === ".." ||
        relativeDestination.startsWith(`..${sep}`) ||
        isAbsolute(relativeDestination)
    ) {
        blockCandidate(`Generated path escapes the worktree: ${path}`);
    }
    const parent = realpathSync(dirname(destination));
    const relativeParent = relative(rootPath, parent);
    if (
        relativeParent === ".." ||
        relativeParent.startsWith(`..${sep}`) ||
        isAbsolute(relativeParent)
    ) {
        blockCandidate(`Generated path parent escapes the worktree: ${path}`);
    }
    const stat = lstatSync(destination);
    if (!stat.isFile() || stat.isSymbolicLink()) {
        blockCandidate(
            `Generated path is not a regular filesystem file: ${path}`,
        );
    }
    return { destination, parent };
}

function atomicReplaceGeneratedFile({
    worktree,
    path,
    content,
    sourcePath,
    gitMode,
}) {
    const { destination, parent } = containedRegularPath(worktree, path);
    if (sourcePath) {
        const sourceStat = lstatSync(sourcePath);
        if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
            blockCandidate(
                `Generated source is not a regular file: ${sourcePath}`,
            );
        }
    }
    const temporaryPath = join(
        parent,
        `.${basename(destination)}.heal-${randomUUID()}.tmp`,
    );
    let descriptor;
    try {
        descriptor = openSync(temporaryPath, "wx", 0o600);
        const bytes = sourcePath
            ? readFileSync(sourcePath)
            : Buffer.from(content);
        writeFileSync(descriptor, bytes);
        const temporaryStat = fstatSync(descriptor);
        if (!temporaryStat.isFile()) {
            blockCandidate(`Generated temporary path is not regular: ${path}`);
        }
        closeSync(descriptor);
        descriptor = undefined;
        chmodSync(temporaryPath, gitMode === "100755" ? 0o755 : 0o644);
        renameSync(temporaryPath, destination);
    } finally {
        if (descriptor !== undefined) {
            closeSync(descriptor);
        }
        rmSync(temporaryPath, { force: true });
    }
    const finalPath = containedRegularPath(worktree, path);
    assert(
        realpathSync(finalPath.destination) === finalPath.destination,
        `Generated path did not resolve to the expected file: ${path}`,
    );
}

function stageGeneratedFile(worktree, path, expectedMode, environment) {
    git(worktree, ["add", "--", path], { env: environment });
    const entries = indexEntries(worktree, path, environment);
    if (
        entries.length !== 1 ||
        entries[0].stage !== 0 ||
        entries[0].path !== path ||
        entries[0].mode !== expectedMode ||
        !isRegularGitMode(entries[0].mode)
    ) {
        blockCandidate(`Generated path staged with an unsafe mode: ${path}`);
    }
}

function copyManifestInputs(worktree, scratchDirectory) {
    const resolvedWorktree = realpathSync(worktree);
    const resolvedScratch = realpathSync(scratchDirectory);
    const manifestOutput = run("git", [
        "-C",
        worktree,
        ...gitArguments(["ls-files", "-z", "--", ":(glob)ts/**/package.json"]),
    ]);
    for (const path of zeroTerminated(manifestOutput)) {
        if (path.includes("\\")) {
            blockCandidate(`Manifest path contains a backslash: ${path}`);
        }
        const components = path.split("/");
        if (
            components.some(
                (part) => part === "" || part === "." || part === "..",
            ) ||
            components[0] !== "ts" ||
            components.at(-1) !== "package.json"
        ) {
            blockCandidate(`Unexpected manifest path: ${path}`);
        }
        const source = join(worktree, ...components);
        const sourceStat = lstatSync(source);
        if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
            blockCandidate(`Manifest source is not a regular file: ${path}`);
        }
        const resolvedSource = realpathSync(source);
        const sourceRelative = relative(resolvedWorktree, resolvedSource);
        if (
            sourceRelative === "" ||
            sourceRelative === ".." ||
            sourceRelative.startsWith(`..${sep}`) ||
            isAbsolute(sourceRelative)
        ) {
            blockCandidate(`Manifest source escapes the worktree: ${path}`);
        }
        const destination = resolve(scratchDirectory, ...components.slice(1));
        const destinationRelative = relative(resolvedScratch, destination);
        if (
            destinationRelative === "" ||
            destinationRelative === ".." ||
            destinationRelative.startsWith(`..${sep}`) ||
            isAbsolute(destinationRelative)
        ) {
            blockCandidate(`Manifest destination escapes scratch: ${path}`);
        }
        mkdirSync(dirname(destination), { recursive: true });
        const resolvedParent = realpathSync(dirname(destination));
        const parentRelative = relative(resolvedScratch, resolvedParent);
        if (
            parentRelative === ".." ||
            parentRelative.startsWith(`..${sep}`) ||
            isAbsolute(parentRelative)
        ) {
            blockCandidate(
                `Manifest destination parent escapes scratch: ${path}`,
            );
        }
        copyFileSync(source, destination, fsConstants.COPYFILE_EXCL);
        const destinationStat = lstatSync(destination);
        if (!destinationStat.isFile() || destinationStat.isSymbolicLink()) {
            blockCandidate(
                `Manifest destination is not a regular file: ${path}`,
            );
        }
    }
}

function writeTrustedPackageManagerInputs({
    repositoryPath,
    trustedSha,
    scratchDirectory,
    environment,
}) {
    for (const path of [
        "ts/pnpm-workspace.yaml",
        "ts/pnpm-lock.yaml",
        "ts/.pnpmfile.cjs",
    ]) {
        writeFileSync(
            join(scratchDirectory, basename(path)),
            readGitFile(repositoryPath, trustedSha, path, environment),
        );
    }
    writeFileSync(
        join(scratchDirectory, ".npmrc"),
        [
            "ignore-scripts=true",
            "manage-package-manager-versions=false",
            "enable-pre-post-scripts=false",
            "",
        ].join("\n"),
    );
}

function runPnpm({ pnpmCommand, scratchDirectory, environment }) {
    const command = resolve(pnpmCommand);
    const pnpmArgs = [
        "install",
        "--lockfile-only",
        "--no-frozen-lockfile",
        "--ignore-scripts",
        "--config.manage-package-manager-versions=false",
    ];
    const isNodeScript = /\.[cm]?js$/i.test(command);
    const executable = isNodeScript ? process.execPath : command;
    const args = isNodeScript ? [command, ...pnpmArgs] : pnpmArgs;
    const result = spawnSync(executable, args, {
        cwd: scratchDirectory,
        env: environment,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw commandError(executable, args, result);
    }
}

function regenerateLockfile({
    repositoryPath,
    worktree,
    trustedSha,
    pnpmCommand,
    environment,
    temporaryDirectory,
}) {
    const scratchDirectory = join(temporaryDirectory, "pnpm-scratch");
    mkdirSync(scratchDirectory, { recursive: true });
    copyManifestInputs(worktree, scratchDirectory);
    writeTrustedPackageManagerInputs({
        repositoryPath,
        trustedSha,
        scratchDirectory,
        environment,
    });
    runPnpm({
        pnpmCommand,
        scratchDirectory,
        environment,
    });
    const generatedLockfile = join(scratchDirectory, "pnpm-lock.yaml");
    assert(
        lstatSync(generatedLockfile).isFile(),
        "pnpm did not generate pnpm-lock.yaml",
    );
    return generatedLockfile;
}

function unmergedFiles(worktree, environment) {
    return zeroTerminated(
        run(
            "git",
            [
                "-C",
                worktree,
                ...gitArguments([
                    "diff",
                    "--name-only",
                    "--diff-filter=U",
                    "-z",
                ]),
            ],
            { env: environment },
        ),
    ).map(normalizeCandidatePath);
}

function buildCandidateTree({
    repositoryPath,
    pr,
    trustedSha,
    pnpmCommand,
    environment,
    temporaryDirectory,
}) {
    mkdirSync(temporaryDirectory, { recursive: true });
    const worktree = join(temporaryDirectory, "worktree");
    git(repositoryPath, ["worktree", "add", "--detach", worktree, pr.headSha], {
        env: environment,
    });
    let conflicts = [];
    try {
        assertTrustedMergeBehavior(
            repositoryPath,
            trustedSha,
            pr.headSha,
            environment,
        );
        const merge = tryGit(
            worktree,
            ["merge", "--no-ff", "--no-commit", trustedSha],
            { env: environment },
        );
        conflicts = unmergedFiles(worktree, environment);
        if (merge.ok && conflicts.length === 0) {
            return {
                status: "clean",
                reason: "Merge has no generated-file conflicts",
            };
        }
        assert(
            conflicts.length > 0,
            `Merge failed without conflicts:\n${merge.output}`,
        );
        const unsupported = conflicts.filter(
            (path) => !isResolvableConflict(path),
        );
        if (unsupported.length > 0) {
            return {
                status: "blocked",
                reason: `Conflicts beyond generated files: ${unsupported.join(", ")}`,
                conflicts,
            };
        }

        for (const path of conflicts.filter(isAutogenReadme)) {
            const mode = assertRegularGeneratedConflict(
                worktree,
                path,
                environment,
            );
            const content = run(
                "git",
                ["-C", worktree, ...gitArguments(["show", `:2:${path}`])],
                { env: environment },
            );
            atomicReplaceGeneratedFile({
                worktree,
                path,
                content,
                gitMode: mode,
            });
            stageGeneratedFile(worktree, path, mode, environment);
        }
        if (conflicts.includes(LOCKFILE)) {
            const mode = assertRegularGeneratedConflict(
                worktree,
                LOCKFILE,
                environment,
            );
            assertSafePackageManagerInputs(
                repositoryPath,
                trustedSha,
                pr.headSha,
                environment,
            );
            const generatedLockfile = regenerateLockfile({
                repositoryPath,
                worktree,
                trustedSha,
                pnpmCommand,
                environment,
                temporaryDirectory,
            });
            atomicReplaceGeneratedFile({
                worktree,
                path: LOCKFILE,
                sourcePath: generatedLockfile,
                gitMode: mode,
            });
            stageGeneratedFile(worktree, LOCKFILE, mode, environment);
        }

        const remaining = unmergedFiles(worktree, environment);
        assert(
            remaining.length === 0,
            `Generated conflicts remain unresolved: ${remaining.join(", ")}`,
        );
        git(worktree, ["diff", "--check", "--cached"], {
            env: environment,
        });
        return {
            status: "candidate",
            conflicts: [...conflicts].sort(),
            treeSha: git(worktree, ["write-tree"], { env: environment }),
        };
    } catch (error) {
        if (error instanceof CandidateOutcomeError) {
            error.conflicts = [...conflicts].sort();
        }
        throw error;
    } finally {
        tryGit(worktree, ["merge", "--abort"], { env: environment });
        tryGit(repositoryPath, ["worktree", "remove", "--force", worktree], {
            env: environment,
        });
    }
}

function createCandidateCommit({
    repositoryPath,
    pr,
    trustedSha,
    treeSha,
    preparedAt,
    environment,
}) {
    const commitEnvironment = {
        ...environment,
        GIT_AUTHOR_NAME: BOT_NAME,
        GIT_AUTHOR_EMAIL: BOT_EMAIL,
        GIT_AUTHOR_DATE: preparedAt,
        GIT_COMMITTER_NAME: BOT_NAME,
        GIT_COMMITTER_EMAIL: BOT_EMAIL,
        GIT_COMMITTER_DATE: preparedAt,
    };
    const message = candidateCommitMessage(pr.number, trustedSha);
    const candidateSha = execFileSync(
        "git",
        [
            "-C",
            repositoryPath,
            ...gitArguments([
                "commit-tree",
                treeSha,
                "-p",
                pr.headSha,
                "-p",
                trustedSha,
            ]),
        ],
        {
            env: commitEnvironment,
            encoding: "utf8",
            input: message,
            stdio: ["pipe", "pipe", "pipe"],
        },
    ).trim();
    normalizeSha(candidateSha, "Candidate commit SHA");
    git(
        repositoryPath,
        ["update-ref", `refs/heal/candidates/pr-${pr.number}`, candidateSha],
        { env: environment },
    );
    return { candidateSha, message };
}

function candidateCommitMessage(number, trustedSha) {
    return `${COMMIT_MESSAGE}\n\nPR #${normalizePrNumber(number)}\nTrusted-Base: ${normalizeSha(trustedSha, "Trusted default-branch SHA")}\n`;
}

function createBundle({
    repositoryPath,
    pr,
    trustedSha,
    candidateSha,
    bundlePath,
    environment,
}) {
    git(
        repositoryPath,
        [
            "bundle",
            "create",
            bundlePath,
            `refs/heal/candidates/pr-${pr.number}`,
            `^${pr.headSha}`,
            `^${trustedSha}`,
        ],
        { env: environment },
    );
    const heads = lines(
        git(repositoryPath, ["bundle", "list-heads", bundlePath], {
            env: environment,
        }),
    );
    assert(
        heads.length === 1 &&
            heads[0] === `${candidateSha} refs/heal/candidates/pr-${pr.number}`,
        `Candidate bundle for PR #${pr.number} has unexpected heads`,
    );
}

export function prepareCandidateArtifact({
    metadata,
    outputDirectory,
    repositoryUrl,
    pnpmCommand,
    baseEnvironment = process.env,
    workDirectory,
    now = () => new Date(),
}) {
    const validated = validateMetadata(metadata);
    assert(
        typeof repositoryUrl === "string" && repositoryUrl.length > 0,
        "Repository URL is required",
    );
    assert(
        typeof pnpmCommand === "string" && pnpmCommand.length > 0,
        "An absolute pnpm command is required",
    );
    const temporaryRoot =
        workDirectory ?? mkdtempSync(join(tmpdir(), "typeagent-heal-prepare-"));
    const ownsTemporaryRoot = workDirectory === undefined;
    const environment = createIsolatedEnvironment(
        baseEnvironment,
        join(temporaryRoot, "home"),
    );
    const repositoryPath = join(temporaryRoot, "repository.git");
    rmSync(outputDirectory, { recursive: true, force: true });
    mkdirSync(outputDirectory, { recursive: true });

    try {
        initRepository({
            directory: repositoryPath,
            repositoryUrl,
            metadata: validated,
            environment,
        });
        const preparedDate = now();
        preparedDate.setMilliseconds(0);
        const preparedAt = preparedDate.toISOString();
        const candidates = [];
        const skipped = [];
        for (const pr of validated.pullRequests) {
            try {
                fetchPullRequest(repositoryPath, pr, environment);
                const result = buildCandidateTree({
                    repositoryPath,
                    pr,
                    trustedSha: validated.trustedSha,
                    pnpmCommand,
                    environment,
                    temporaryDirectory: join(temporaryRoot, `pr-${pr.number}`),
                });
                if (result.status !== "candidate") {
                    skipped.push({
                        number: pr.number,
                        status: result.status,
                        reason: result.reason,
                        conflicts: result.conflicts ?? [],
                    });
                    continue;
                }
                const commit = createCandidateCommit({
                    repositoryPath,
                    pr,
                    trustedSha: validated.trustedSha,
                    treeSha: result.treeSha,
                    preparedAt,
                    environment,
                });
                const bundleName = `pr-${pr.number}.bundle`;
                createBundle({
                    repositoryPath,
                    pr,
                    trustedSha: validated.trustedSha,
                    candidateSha: commit.candidateSha,
                    bundlePath: join(outputDirectory, bundleName),
                    environment,
                });
                candidates.push({
                    ...pr,
                    candidateSha: commit.candidateSha,
                    treeSha: result.treeSha,
                    conflicts: result.conflicts,
                    bundle: bundleName,
                    commitMessage: commit.message,
                    preparedAt,
                });
            } catch (error) {
                skipped.push(candidateOutcome(pr.number, error));
            }
        }
        git(repositoryPath, ["fsck", "--strict"], { env: environment });
        const summary = {
            version: ARTIFACT_VERSION,
            repository: validated.repository,
            defaultBranch: validated.defaultBranch,
            trustedSha: validated.trustedSha,
            producerRunId: validated.runId,
            preparedAt,
            candidates,
            skipped,
        };
        writeJson(join(outputDirectory, "summary.json"), summary);
        return summary;
    } finally {
        if (ownsTemporaryRoot) {
            rmSync(temporaryRoot, { recursive: true, force: true });
        }
    }
}

function validateCandidateSummary(summary, expectedRunId) {
    assert(summary?.version === ARTIFACT_VERSION, "Unknown artifact version");
    const repository = normalizeRepository(summary.repository);
    const defaultBranch = normalizeRef(
        summary.defaultBranch,
        "Artifact default branch",
    );
    const trustedSha = normalizeSha(summary.trustedSha, "Artifact trusted SHA");
    assert(
        summary.producerRunId === expectedRunId,
        "Artifact producer run ID does not match workflow_run",
    );
    assert(
        typeof summary.preparedAt === "string" &&
            Number.isFinite(Date.parse(summary.preparedAt)),
        "Artifact preparation timestamp is invalid",
    );
    assert(
        Array.isArray(summary.candidates),
        "Artifact candidates are invalid",
    );
    for (const candidate of summary.candidates) {
        assert(
            candidate.preparedAt === summary.preparedAt,
            "Candidate preparation timestamp does not match the artifact",
        );
        assert(
            candidate.commitMessage ===
                candidateCommitMessage(candidate.number, trustedSha),
            "Candidate commit message is invalid",
        );
    }
    return {
        ...summary,
        repository,
        defaultBranch,
        trustedSha,
        candidates: summary.candidates.map((candidate) => ({
            ...validatePullRequest(
                candidate,
                repository,
                defaultBranch,
                trustedSha,
            ),
            candidateSha: normalizeSha(candidate.candidateSha, "Candidate SHA"),
            treeSha: normalizeSha(candidate.treeSha, "Candidate tree SHA"),
            conflicts: Array.isArray(candidate.conflicts)
                ? candidate.conflicts.map(normalizePath).sort()
                : fail("Candidate conflicts are invalid"),
            bundle: candidate.bundle,
            commitMessage: candidate.commitMessage,
            preparedAt: candidate.preparedAt,
        })),
    };
}

function validateArtifactFiles(artifactDirectory, summary) {
    const expected = new Set([
        "summary.json",
        ...summary.candidates.map((candidate) => candidate.bundle),
    ]);
    const actual = readdirSync(artifactDirectory);
    assert(
        actual.length === expected.size &&
            actual.every((name) => expected.has(name)),
        "Artifact contains unexpected or missing files",
    );
    for (const name of actual) {
        assert(
            basename(name) === name && !name.includes(sep),
            `Unsafe artifact path: ${name}`,
        );
        const stat = lstatSync(join(artifactDirectory, name));
        assert(
            stat.isFile() && !stat.isSymbolicLink(),
            `Artifact entry ${name} is not a regular file`,
        );
    }
}

function verifyCommit({ repositoryPath, candidate, trustedSha, environment }) {
    const type = git(
        repositoryPath,
        ["cat-file", "-t", candidate.candidateSha],
        { env: environment },
    );
    assert(type === "commit", "Candidate object is not a commit");
    const parents = lines(
        git(
            repositoryPath,
            ["show", "-s", "--format=%P", candidate.candidateSha],
            { env: environment },
        ),
    )
        .join(" ")
        .split(" ");
    assert(
        parents.length === 2 &&
            parents[0] === candidate.headSha &&
            parents[1] === trustedSha,
        `Candidate parents for PR #${candidate.number} are invalid`,
    );
    const treeSha = git(
        repositoryPath,
        ["show", "-s", "--format=%T", candidate.candidateSha],
        { env: environment },
    );
    assert(
        treeSha === candidate.treeSha,
        `Candidate tree metadata for PR #${candidate.number} is invalid`,
    );
    const commitMetadata = lines(
        git(
            repositoryPath,
            [
                "show",
                "-s",
                "--format=%an%n%ae%n%aI%n%cn%n%ce%n%cI",
                candidate.candidateSha,
            ],
            { env: environment },
        ),
    );
    assert(
        commitMetadata.length === 6 &&
            commitMetadata[0] === BOT_NAME &&
            commitMetadata[1] === BOT_EMAIL &&
            commitMetadata[3] === BOT_NAME &&
            commitMetadata[4] === BOT_EMAIL &&
            Date.parse(commitMetadata[2]) ===
                Date.parse(candidate.preparedAt) &&
            Date.parse(commitMetadata[5]) === Date.parse(candidate.preparedAt),
        `Candidate author metadata for PR #${candidate.number} is invalid`,
    );
    const rawCommit = run(
        "git",
        [
            "-C",
            repositoryPath,
            ...gitArguments(["cat-file", "commit", candidate.candidateSha]),
        ],
        { env: environment },
    );
    const messageStart = rawCommit.indexOf("\n\n");
    assert(
        messageStart !== -1,
        `Candidate commit for PR #${candidate.number} has no message`,
    );
    assert(
        rawCommit.slice(messageStart + 2) ===
            candidateCommitMessage(candidate.number, trustedSha),
        `Candidate commit message for PR #${candidate.number} is invalid`,
    );
}

function importCandidateBundle({
    repositoryPath,
    artifactDirectory,
    candidate,
    environment,
}) {
    assert(
        typeof candidate.bundle === "string" &&
            candidate.bundle === `pr-${candidate.number}.bundle`,
        `Candidate bundle name for PR #${candidate.number} is invalid`,
    );
    const bundlePath = resolve(artifactDirectory, candidate.bundle);
    assert(
        relative(resolve(artifactDirectory), bundlePath) === candidate.bundle,
        `Candidate bundle path for PR #${candidate.number} escapes the artifact`,
    );
    git(repositoryPath, ["bundle", "verify", bundlePath], {
        env: environment,
    });
    const heads = lines(
        git(repositoryPath, ["bundle", "list-heads", bundlePath], {
            env: environment,
        }),
    );
    assert(
        heads.length === 1 &&
            heads[0] ===
                `${candidate.candidateSha} refs/heal/candidates/pr-${candidate.number}`,
        `Candidate bundle for PR #${candidate.number} has unexpected heads`,
    );
    git(
        repositoryPath,
        [
            "fetch",
            "--no-tags",
            bundlePath,
            `refs/heal/candidates/pr-${candidate.number}:refs/heal/verified/pr-${candidate.number}`,
        ],
        { env: environment },
    );
    const imported = git(
        repositoryPath,
        ["rev-parse", `refs/heal/verified/pr-${candidate.number}^{commit}`],
        { env: environment },
    );
    assert(
        imported === candidate.candidateSha,
        `Candidate bundle for PR #${candidate.number} imported the wrong commit`,
    );
}

export function verifyCandidateArtifact({
    artifactDirectory,
    liveMetadata,
    expectedRunId,
    repositoryUrl,
    pnpmCommand,
    planPath,
    baseEnvironment = process.env,
    workDirectory,
}) {
    const live = validateMetadata(liveMetadata);
    const summary = validateCandidateSummary(
        readJson(join(artifactDirectory, "summary.json"), "summary.json"),
        expectedRunId,
    );
    if (
        summary.repository !== live.repository ||
        summary.defaultBranch !== live.defaultBranch ||
        summary.trustedSha !== live.trustedSha
    ) {
        fatalRepository(
            "Artifact trusted repository revision is no longer current",
        );
    }
    validateArtifactFiles(artifactDirectory, summary);

    const liveByNumber = new Map(
        live.pullRequests.map((pr) => [pr.number, pr]),
    );
    const temporaryRoot =
        workDirectory ?? mkdtempSync(join(tmpdir(), "typeagent-heal-verify-"));
    const environment = createIsolatedEnvironment(
        baseEnvironment,
        join(temporaryRoot, "home"),
    );
    const repositoryPath = join(temporaryRoot, "push.git");
    try {
        initRepository({
            directory: repositoryPath,
            repositoryUrl,
            metadata: live,
            environment,
        });
        const verifiedCandidates = [];
        const skipped = [];
        for (const candidate of summary.candidates) {
            try {
                const current = liveByNumber.get(candidate.number);
                if (!current) {
                    retryCandidate(`PR #${candidate.number} is no longer open`);
                }
                validateMatchingPullRequest(candidate, current);
                fetchPullRequest(repositoryPath, current, environment);
                assert(
                    candidate.conflicts.length > 0 &&
                        candidate.conflicts.every(isResolvableConflict),
                    `Candidate conflicts for PR #${candidate.number} are invalid`,
                );
                importCandidateBundle({
                    repositoryPath,
                    artifactDirectory,
                    candidate,
                    environment,
                });
                verifyCommit({
                    repositoryPath,
                    candidate,
                    trustedSha: summary.trustedSha,
                    environment,
                });
                const expected = buildCandidateTree({
                    repositoryPath,
                    pr: current,
                    trustedSha: summary.trustedSha,
                    pnpmCommand,
                    environment,
                    temporaryDirectory: join(
                        temporaryRoot,
                        `expected-pr-${candidate.number}`,
                    ),
                });
                if (expected.status !== "candidate") {
                    retryCandidate(
                        `PR #${candidate.number} no longer produces a healing candidate: ${expected.reason}`,
                    );
                }
                if (!deepEqual(expected.conflicts, candidate.conflicts)) {
                    retryCandidate(
                        `Candidate conflict set for PR #${candidate.number} changed`,
                    );
                }
                if (expected.treeSha !== candidate.treeSha) {
                    retryCandidate(
                        `Candidate tree for PR #${candidate.number} does not match trusted reconstruction`,
                    );
                }
                verifiedCandidates.push(candidate);
            } catch (error) {
                skipped.push(candidateOutcome(candidate.number, error));
            }
        }
        git(repositoryPath, ["fsck", "--strict"], { env: environment });
        const plan = {
            version: ARTIFACT_VERSION,
            repository: live.repository,
            defaultBranch: live.defaultBranch,
            trustedSha: live.trustedSha,
            repositoryUrl,
            repositoryPath,
            candidates: verifiedCandidates.map((candidate) => ({
                number: candidate.number,
                headRefName: candidate.headRefName,
                headSha: candidate.headSha,
                baseRefName: candidate.baseRefName,
                baseSha: candidate.baseSha,
                headRepository: candidate.headRepository,
                baseRepository: candidate.baseRepository,
                isCrossRepository: candidate.isCrossRepository,
                state: candidate.state,
                candidateSha: candidate.candidateSha,
                treeSha: candidate.treeSha,
            })),
            skipped,
        };
        writeJson(planPath, plan);
        return plan;
    } catch (error) {
        if (workDirectory === undefined) {
            rmSync(temporaryRoot, { recursive: true, force: true });
        }
        throw error;
    }
}

function validatePushPlan(plan) {
    assert(plan?.version === ARTIFACT_VERSION, "Unknown push plan version");
    const repository = normalizeRepository(plan.repository);
    const defaultBranch = normalizeRef(plan.defaultBranch, "Default branch");
    const trustedSha = normalizeSha(plan.trustedSha, "Trusted SHA");
    assert(
        typeof plan.repositoryPath === "string" &&
            lstatSync(plan.repositoryPath).isDirectory(),
        "Verified bare repository is missing",
    );
    assert(Array.isArray(plan.candidates), "Push plan candidates are invalid");
    assert(
        plan.skipped === undefined || Array.isArray(plan.skipped),
        "Push plan skipped outcomes are invalid",
    );
    return {
        ...plan,
        repository,
        defaultBranch,
        trustedSha,
        skipped: plan.skipped ?? [],
        candidates: plan.candidates.map((candidate) => ({
            ...validatePullRequest(
                candidate,
                repository,
                defaultBranch,
                trustedSha,
            ),
            candidateSha: normalizeSha(candidate.candidateSha, "Candidate SHA"),
            treeSha: normalizeSha(candidate.treeSha, "Candidate tree SHA"),
        })),
    };
}

function createAskPass(directory) {
    const path = join(directory, "git-askpass.sh");
    writeFileSync(
        path,
        [
            "#!/bin/sh",
            'case "$1" in',
            '  *Username*) printf "%s\\n" "x-access-token" ;;',
            '  *) printf "%s\\n" "$HEAL_PUSH_TOKEN" ;;',
            "esac",
            "",
        ].join("\n"),
    );
    chmodSync(path, 0o700);
    return path;
}

export function createGitHubApi({
    repository,
    token,
    apiUrl = "https://api.github.com",
    fetchImpl = fetch,
}) {
    normalizeRepository(repository);
    assert(
        typeof token === "string" && token.length > 0,
        "App token is missing",
    );
    async function request(path) {
        const response = await fetchImpl(`${apiUrl}${path}`, {
            headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${token}`,
                "X-GitHub-Api-Version": "2022-11-28",
            },
        });
        if (!response.ok) {
            fail(`GitHub API ${path} failed with HTTP ${response.status}`);
        }
        return response.json();
    }
    return {
        async getRepository() {
            const data = await request(`/repos/${repository}`);
            const defaultBranch = normalizeRef(
                data.default_branch,
                "Repository default branch",
            );
            const branch = await request(
                `/repos/${repository}/branches/${encodeURIComponent(defaultBranch)}`,
            );
            return {
                repository,
                defaultBranch,
                trustedSha: normalizeSha(
                    branch.commit.sha,
                    "Live default-branch SHA",
                ),
            };
        },
        async getPullRequest(number) {
            const data = await request(`/repos/${repository}/pulls/${number}`);
            return {
                number: data.number,
                state: data.state,
                isCrossRepository:
                    data.head.repo?.full_name !== data.base.repo?.full_name,
                headRepository: data.head.repo?.full_name,
                baseRepository: data.base.repo?.full_name,
                headRefName: data.head.ref,
                headSha: data.head.sha,
                baseRefName: data.base.ref,
                baseSha: data.base.sha,
            };
        },
    };
}

export async function pushVerifiedPlan({
    plan,
    api,
    token,
    baseEnvironment = process.env,
    push = null,
}) {
    const validated = validatePushPlan(plan);
    const liveRepository = await api.getRepository();
    if (
        liveRepository.repository !== validated.repository ||
        liveRepository.defaultBranch !== validated.defaultBranch ||
        liveRepository.trustedSha !== validated.trustedSha
    ) {
        fatalRepository(
            "Repository default branch changed after final verification",
        );
    }

    const pushHome = mkdtempSync(join(tmpdir(), "typeagent-heal-push-"));
    const environment = createIsolatedEnvironment(baseEnvironment, pushHome);
    const askPass = push ? null : createAskPass(pushHome);
    const pushed = [];
    const skipped = [...validated.skipped];
    try {
        if (!push && validated.candidates.length > 0) {
            if (typeof token !== "string" || token.length === 0) {
                fatalRepository("App token is missing");
            }
            git(
                validated.repositoryPath,
                ["remote", "set-url", "origin", validated.repositoryUrl],
                { env: environment },
            );
        }
        for (const candidate of validated.candidates) {
            try {
                const livePr = validatePullRequest(
                    await api.getPullRequest(candidate.number),
                    validated.repository,
                    validated.defaultBranch,
                    validated.trustedSha,
                );
                validateMatchingPullRequest(candidate, livePr);
                verifyCommit({
                    repositoryPath: validated.repositoryPath,
                    candidate: {
                        ...candidate,
                        preparedAt: git(
                            validated.repositoryPath,
                            [
                                "show",
                                "-s",
                                "--format=%aI",
                                candidate.candidateSha,
                            ],
                            { env: environment },
                        ),
                    },
                    trustedSha: validated.trustedSha,
                    environment,
                });
                const pushArgs = [
                    "--porcelain",
                    "--no-verify",
                    `--force-with-lease=refs/heads/${candidate.headRefName}:${candidate.headSha}`,
                    "origin",
                    `${candidate.candidateSha}:refs/heads/${candidate.headRefName}`,
                ];
                if (push) {
                    await push({
                        repositoryPath: validated.repositoryPath,
                        candidate,
                        args: pushArgs,
                        environment,
                    });
                } else {
                    const pushResult = tryGit(
                        validated.repositoryPath,
                        ["push", ...pushArgs],
                        {
                            env: {
                                ...environment,
                                GIT_ASKPASS: askPass,
                                HEAL_PUSH_TOKEN: token,
                            },
                        },
                    );
                    if (!pushResult.ok) {
                        if (
                            /authentication failed|could not read username|permission denied|http 40[13]/i.test(
                                pushResult.output,
                            )
                        ) {
                            fatalRepository(
                                `App-authenticated push failed: ${pushResult.output.trim()}`,
                            );
                        }
                        retryCandidate(
                            `Push for PR #${candidate.number} failed: ${pushResult.output.trim()}`,
                        );
                    }
                }
                pushed.push(candidate.number);
            } catch (error) {
                skipped.push(candidateOutcome(candidate.number, error));
            }
        }
        return { pushed, skipped };
    } finally {
        rmSync(pushHome, { recursive: true, force: true });
    }
}

export function loadJsonFile(path) {
    return readJson(path);
}
