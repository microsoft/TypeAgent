// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
    PreparedSkillAcquisition,
    ProcessRunner,
    SkillAcquisitionPreview,
    SkillAcquisitionLimits,
    SkillAcquisitionProvider,
    SkillAcquisitionRequest,
    SkillAcquisitionResult,
    SkillUpdateCheck,
    StagedSkill,
} from "./acquisitionTypes.js";
import type { SkillCatalog } from "./catalog.js";
import { collectPackage, prepareAcquisition } from "./packageValidation.js";
import { BoundedProcessRunner } from "./processRunner.js";
import {
    ArchiveSkillProvider,
    GitSkillProvider,
    LocalDirectorySkillProvider,
} from "./providers.js";
import type {
    CatalogEntry,
    SkillAcquisitionMetadata,
    SkillAcquisitionSource,
} from "./types.js";
import { qualifySkill, sha256 } from "./util.js";

export const defaultSkillAcquisitionLimits: SkillAcquisitionLimits =
    Object.freeze({
        maxEntries: 512,
        maxFiles: 256,
        maxFileBytes: 4 * 1024 * 1024,
        maxTotalBytes: 32 * 1024 * 1024,
        maxArchiveBytes: 64 * 1024 * 1024,
        maxPathLength: 240,
        maxFrontmatterBytes: 64 * 1024,
        processTimeoutMs: 30_000,
        maxProcessOutputBytes: 2 * 1024 * 1024,
    });

export interface SkillAcquirerOptions {
    readonly stagingRoot: string;
    readonly limits?: Partial<SkillAcquisitionLimits>;
    readonly processRunner?: ProcessRunner;
    readonly providers?: readonly SkillAcquisitionProvider<SkillAcquisitionSource>[];
}

export interface SkillAcquisitionCatalog {
    get(
        identity: SkillAcquisitionRequest["identity"],
        revision?: string,
    ): Promise<CatalogEntry | undefined>;
    publish(
        input: Parameters<SkillCatalog["publish"]>[0],
    ): Promise<CatalogEntry>;
}

export class SkillAcquirer {
    private readonly limits: SkillAcquisitionLimits;
    private readonly processRunner: ProcessRunner;
    private readonly providers = new Map<
        SkillAcquisitionSource["type"],
        SkillAcquisitionProvider<SkillAcquisitionSource>
    >();

    public constructor(
        private readonly catalog: SkillAcquisitionCatalog,
        private readonly options: SkillAcquirerOptions,
    ) {
        if (!path.isAbsolute(options.stagingRoot)) {
            throw new Error("Skill acquisition stagingRoot must be absolute.");
        }

        this.limits = validateLimits({
            ...defaultSkillAcquisitionLimits,
            ...options.limits,
        });
        this.processRunner =
            options.processRunner ?? new BoundedProcessRunner();
        for (const provider of options.providers ?? [
            new LocalDirectorySkillProvider(),
            new GitSkillProvider(),
            new ArchiveSkillProvider(),
        ]) {
            if (this.providers.has(provider.type)) {
                throw new Error(`Duplicate skill provider: ${provider.type}`);
            }
            this.providers.set(provider.type, provider);
        }
    }

    public preview(
        request: SkillAcquisitionRequest,
    ): Promise<SkillAcquisitionPreview> {
        return this.withPrepared(request, (prepared) => ({
            displayName: prepared.displayName,
            description: prepared.description,
            sourceFingerprint: prepared.metadata.sourceFingerprint,
            manifestDigest: prepared.metadata.manifestDigest,
            manifest: prepared.files
                .map((file) => {
                    const content =
                        typeof file.content === "string"
                            ? new TextEncoder().encode(file.content)
                            : file.content;
                    return {
                        path: file.path,
                        sha256: sha256(content),
                        size: content.byteLength,
                    };
                })
                .sort((left, right) => left.path.localeCompare(right.path)),
        }));
    }

    public async acquireAndPublish(
        request: SkillAcquisitionRequest,
    ): Promise<SkillAcquisitionResult> {
        const current = await this.catalog.get(request.identity);
        return this.withPrepared(request, async (prepared) => {
            const entry = await this.catalog.publish({
                identity: request.identity,
                schemaFingerprint: request.schemaFingerprint,
                displayName: request.displayName ?? prepared.displayName,
                description: request.description ?? prepared.description,
                files: prepared.files,
                acquisition: prepared.metadata,
            });
            return {
                entry,
                updated:
                    current === undefined ||
                    current.revision.revision !== entry.revision.revision,
            };
        });
    }

    public async checkForUpdate(
        request: SkillAcquisitionRequest,
    ): Promise<SkillUpdateCheck> {
        const current = await this.catalog.get(request.identity);
        return this.withPrepared(request, (prepared) =>
            compareUpdate(current, prepared, request.schemaFingerprint),
        );
    }

    public async update(
        request: SkillAcquisitionRequest,
    ): Promise<SkillAcquisitionResult> {
        const current = await this.catalog.get(request.identity);
        return this.withPrepared(request, async (prepared) => {
            const update = compareUpdate(
                current,
                prepared,
                request.schemaFingerprint,
            );
            if (!update.updateAvailable && current !== undefined) {
                return { entry: current, updated: false };
            }
            const entry = await this.catalog.publish({
                identity: request.identity,
                schemaFingerprint: request.schemaFingerprint,
                displayName: request.displayName ?? prepared.displayName,
                description: request.description ?? prepared.description,
                files: prepared.files,
                acquisition: prepared.metadata,
            });
            return { entry, updated: true };
        });
    }

    private async withPrepared<T>(
        request: SkillAcquisitionRequest,
        operation: (prepared: PreparedSkillAcquisition) => Promise<T> | T,
    ): Promise<T> {
        validateRequest(request);
        const provider = this.providers.get(request.source.type);
        if (provider === undefined) {
            throw new Error(`No skill provider for ${request.source.type}.`);
        }

        await mkdir(this.options.stagingRoot, { recursive: true });
        const stagingRootStat = await lstat(this.options.stagingRoot);
        if (
            !stagingRootStat.isDirectory() ||
            stagingRootStat.isSymbolicLink()
        ) {
            throw new Error(
                "Skill acquisition stagingRoot must be a real directory.",
            );
        }

        const stagingDirectory = path.join(
            this.options.stagingRoot,
            randomUUID(),
        );
        await mkdir(stagingDirectory, { mode: 0o700 });
        try {
            const staged = await provider.stage(request.source, {
                stagingDirectory,
                limits: this.limits,
                processRunner: this.processRunner,
            });
            await assertStagedRoot(stagingDirectory, staged.root);
            return operation(await this.prepare(request, staged));
        } finally {
            await rm(stagingDirectory, { recursive: true, force: true });
        }

        async function assertStagedRoot(
            stagingDirectory: string,
            stagedRoot: string,
        ): Promise<void> {
            const [canonicalStage, canonicalRoot] = await Promise.all([
                realpath(stagingDirectory),
                realpath(stagedRoot),
            ]);
            const relative = path.relative(canonicalStage, canonicalRoot);
            if (
                relative.length === 0 ||
                relative === ".." ||
                relative.startsWith(`..${path.sep}`) ||
                path.isAbsolute(relative)
            ) {
                throw new Error(
                    "A skill provider must return a child of its unique staging directory.",
                );
            }
        }
    }

    private async prepare(
        request: SkillAcquisitionRequest,
        staged: StagedSkill,
    ): Promise<PreparedSkillAcquisition> {
        const collected = await collectPackage(
            staged.root,
            request.identity,
            this.limits,
        );
        const metadata: SkillAcquisitionMetadata = {
            provider: request.source.type,
            source: staged.sourceDescription,
            sourceFingerprint:
                staged.sourceFingerprint || collected.manifestDigest,
            manifestDigest: collected.manifestDigest,
            acquiredAt: new Date().toISOString(),
        };
        return prepareAcquisition(
            collected,
            metadata,
            request.displayName,
            request.description,
        );
    }
}

function validateRequest(request: SkillAcquisitionRequest): void {
    if (
        request === undefined ||
        request === null ||
        typeof request !== "object" ||
        request.identity === undefined ||
        request.source === undefined
    ) {
        throw new Error("Skill acquisition requires an explicit request.");
    }
    requireNonEmptyString(request.identity.scope, "skill scope");
    requireNonEmptyString(request.identity.origin, "skill origin");
    requireNonEmptyString(request.identity.name, "skill name");
    qualifySkill(request.identity);
    requireNonEmptyString(
        request.schemaFingerprint,
        "skill schema fingerprint",
    );
    switch (request.source.type) {
        case "directory":
        case "archive":
            requireNonEmptyString(
                request.source.path,
                `skill ${request.source.type} source path`,
            );
            break;
        case "git":
            requireNonEmptyString(
                request.source.repository,
                "skill Git repository",
            );
            requireNonEmptyString(request.source.ref, "skill Git ref");
            break;
        default:
            throw new Error("Skill acquisition source type must be explicit.");
    }
}

function requireNonEmptyString(value: unknown, field: string): void {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${field} must be explicit.`);
    }
}

function compareUpdate(
    current: CatalogEntry | undefined,
    candidate: PreparedSkillAcquisition,
    schemaFingerprint: string,
): SkillUpdateCheck {
    const previous = current?.revision.acquisition;
    const sourceChanged =
        previous === undefined ||
        previous.provider !== candidate.metadata.provider ||
        previous.source !== candidate.metadata.source ||
        previous.sourceFingerprint !== candidate.metadata.sourceFingerprint;
    const contentChanged =
        previous === undefined ||
        previous.manifestDigest !== candidate.metadata.manifestDigest;
    const metadataChanged =
        current === undefined ||
        current.revision.schemaFingerprint !== schemaFingerprint ||
        current.revision.displayName !== candidate.displayName ||
        current.revision.description !== candidate.description;
    return {
        updateAvailable: sourceChanged || contentChanged || metadataChanged,
        sourceChanged,
        contentChanged,
        metadataChanged,
        ...(current === undefined
            ? {}
            : { currentRevision: current.revision.revision }),
        sourceFingerprint: candidate.metadata.sourceFingerprint,
        manifestDigest: candidate.metadata.manifestDigest,
    };
}

function validateLimits(
    limits: SkillAcquisitionLimits,
): SkillAcquisitionLimits {
    for (const [name, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new Error(
                `Invalid skill acquisition limit ${name}: ${value}`,
            );
        }
    }
    return Object.freeze(limits);
}
