// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { cp, lstat, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
    SkillAcquisitionProvider,
    SkillProviderContext,
    StagedSkill,
} from "./acquisitionTypes.js";
import type { SkillAcquisitionSource } from "./types.js";
import { decodeOutput } from "./processRunner.js";
import { extractArchive, extractArchiveData } from "./safeArchive.js";
import {
    validateAcquisitionPath,
    validateExecutable,
} from "./packageValidation.js";

type DirectorySource = Extract<SkillAcquisitionSource, { type: "directory" }>;
type GitSource = Extract<SkillAcquisitionSource, { type: "git" }>;
type ArchiveSource = Extract<SkillAcquisitionSource, { type: "archive" }>;

export class LocalDirectorySkillProvider
    implements SkillAcquisitionProvider<DirectorySource>
{
    public readonly type = "directory" as const;

    public async stage(
        source: DirectorySource,
        context: SkillProviderContext,
    ): Promise<StagedSkill> {
        const sourceStat = await lstat(source.path);
        if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
            throw new Error(
                "The explicit skill source must be a real directory.",
            );
        }
        const root = path.join(context.stagingDirectory, "content");
        await cp(source.path, root, {
            recursive: true,
            dereference: false,
            errorOnExist: true,
            force: false,
            verbatimSymlinks: true,
        });
        return {
            root,
            sourceFingerprint: "",
            sourceDescription: path.resolve(source.path),
        };
    }
}

export class ArchiveSkillProvider
    implements SkillAcquisitionProvider<ArchiveSource>
{
    public readonly type = "archive" as const;

    public async stage(
        source: ArchiveSource,
        context: SkillProviderContext,
    ): Promise<StagedSkill> {
        const sourceStat = await lstat(source.path);
        if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
            throw new Error("The skill archive must be a regular local file.");
        }
        if (sourceStat.size > context.limits.maxArchiveBytes) {
            throw new Error(
                `Archive exceeds ${context.limits.maxArchiveBytes} bytes.`,
            );
        }
        const root = path.join(context.stagingDirectory, "content");
        await mkdir(root);
        const fingerprint = await extractArchive(
            source.path,
            source.format,
            root,
            context.limits,
        );
        return {
            root,
            sourceFingerprint: fingerprint,
            sourceDescription: path.resolve(source.path),
        };
    }
}

export class GitSkillProvider implements SkillAcquisitionProvider<GitSource> {
    public readonly type = "git" as const;

    public async stage(
        source: GitSource,
        context: SkillProviderContext,
    ): Promise<StagedSkill> {
        if (
            source.repository.trim().length === 0 ||
            source.ref.trim().length === 0
        ) {
            throw new Error("Git repository and ref must be explicit.");
        }
        validateGitRepository(source.repository);
        const repositoryRoot = path.join(
            context.stagingDirectory,
            "repository",
        );
        await mkdir(repositoryRoot);
        await this.git(["init"], context, repositoryRoot);
        await this.git(
            [
                "fetch",
                "--depth=1",
                "--no-tags",
                "--filter=blob:none",
                "--",
                source.repository,
                source.ref,
            ],
            context,
            repositoryRoot,
        );
        const commit = decodeOutput(
            (
                await this.git(
                    ["rev-parse", "--verify", "FETCH_HEAD^{commit}"],
                    context,
                    repositoryRoot,
                )
            ).stdout,
        ).trim();
        if (!/^[a-f0-9]{40,64}$/i.test(commit)) {
            throw new Error("Git returned an invalid commit fingerprint.");
        }
        if (source.subdirectory !== undefined) {
            validateAcquisitionPath(
                source.subdirectory,
                context.limits,
                new Map(),
            );
        }
        const treeish =
            source.subdirectory === undefined
                ? commit
                : `${commit}:${source.subdirectory}`;
        const treeOutput = (
            await this.git(
                ["ls-tree", "-rz", "--full-tree", treeish],
                context,
                repositoryRoot,
            )
        ).stdout;
        validateGitTree(treeOutput, context);
        const archive = (
            await this.git(
                ["archive", "--format=tar", treeish],
                context,
                repositoryRoot,
                Math.min(
                    context.limits.maxProcessOutputBytes,
                    context.limits.maxTotalBytes +
                        context.limits.maxEntries * 1024,
                ),
            )
        ).stdout;
        const root = path.join(context.stagingDirectory, "content");
        await mkdir(root);
        await extractArchiveData(archive, "tar", root, context.limits);
        const rootStat = await stat(root);
        if (!rootStat.isDirectory()) {
            throw new Error("Git skill subdirectory is not a directory.");
        }
        return {
            root,
            sourceFingerprint: commit.toLowerCase(),
            sourceDescription: `${sanitizeRepository(source.repository)}#${source.ref}${
                source.subdirectory === undefined
                    ? ""
                    : `:${source.subdirectory}`
            }`,
        };
    }

    private git(
        args: readonly string[],
        context: SkillProviderContext,
        cwd?: string,
        maxOutputBytes = context.limits.maxProcessOutputBytes,
    ) {
        return context.processRunner.run("git", args, {
            ...(cwd === undefined ? {} : { cwd }),
            timeoutMs: context.limits.processTimeoutMs,
            maxOutputBytes,
        });
    }
}

function validateGitTree(
    output: Uint8Array,
    context: SkillProviderContext,
): void {
    const entries = decodeOutput(output).split("\0").filter(Boolean);
    const paths = new Map<string, string>();
    if (entries.length > context.limits.maxFiles) {
        throw new Error("Git tree exceeds the package entry limit.");
    }
    for (const entry of entries) {
        const separator = entry.indexOf("\t");
        if (separator < 0) {
            throw new Error("Git returned malformed tree data.");
        }
        const metadata = entry.slice(0, separator).split(" ");
        const relativePath = entry.slice(separator + 1);
        if (metadata.length !== 3) {
            throw new Error("Git returned malformed tree metadata.");
        }
        const [mode, type] = metadata;
        validateAcquisitionPath(relativePath, context.limits, paths);
        if (type !== "blob" || !/^100(?:644|664)$/.test(mode)) {
            throw new Error(
                `Git links, submodules, and executable files are forbidden: ${relativePath}`,
            );
        }
        validateExecutable(relativePath, Number.parseInt(mode, 8));
    }
}

function sanitizeRepository(repository: string): string {
    try {
        const url = new URL(repository);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
    } catch {
        return path.resolve(repository);
    }
}

function validateGitRepository(repository: string): void {
    if (
        repository.startsWith("-") ||
        /[\r\n\0]/.test(repository) ||
        /^ext::/i.test(repository) ||
        /^[A-Za-z][A-Za-z0-9+.-]*::/.test(repository) ||
        (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(repository) &&
            !/^(?:https|ssh|git|file):\/\//i.test(repository))
    ) {
        throw new Error("Unsafe Git repository locator.");
    }
}
