// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CatalogEntry,
    SkillAcquisitionMetadata,
    SkillAcquisitionSource,
    SkillFileInput,
    SkillFileManifest,
    SkillIdentity,
} from "./types.js";

export interface SkillAcquisitionLimits {
    readonly maxEntries: number;
    readonly maxFiles: number;
    readonly maxFileBytes: number;
    readonly maxTotalBytes: number;
    readonly maxArchiveBytes: number;
    readonly maxPathLength: number;
    readonly maxFrontmatterBytes: number;
    readonly processTimeoutMs: number;
    readonly maxProcessOutputBytes: number;
}

export interface SkillAcquisitionRequest {
    readonly identity: SkillIdentity;
    readonly schemaFingerprint: string;
    readonly source: SkillAcquisitionSource;
    readonly displayName?: string;
    readonly description?: string;
}

export interface StagedSkill {
    readonly root: string;
    readonly sourceFingerprint: string;
    readonly sourceDescription: string;
}

export interface SkillProviderContext {
    readonly stagingDirectory: string;
    readonly limits: SkillAcquisitionLimits;
    readonly processRunner: ProcessRunner;
}

export interface SkillAcquisitionProvider<T extends SkillAcquisitionSource> {
    readonly type: T["type"];
    stage(source: T, context: SkillProviderContext): Promise<StagedSkill>;
}

export interface ProcessRunOptions {
    readonly cwd?: string;
    readonly timeoutMs: number;
    readonly maxOutputBytes: number;
}

export interface ProcessResult {
    readonly stdout: Uint8Array;
    readonly stderr: Uint8Array;
}

export interface ProcessRunner {
    run(
        command: string,
        args: readonly string[],
        options: ProcessRunOptions,
    ): Promise<ProcessResult>;
}

export interface PreparedSkillAcquisition {
    readonly files: readonly SkillFileInput[];
    readonly metadata: SkillAcquisitionMetadata;
    readonly displayName: string;
    readonly description: string;
}

export interface SkillAcquisitionPreview {
    readonly displayName: string;
    readonly description: string;
    readonly sourceFingerprint: string;
    readonly manifestDigest: string;
    readonly manifest: readonly SkillFileManifest[];
}

export interface SkillAcquisitionResult {
    readonly entry: CatalogEntry;
    readonly updated: boolean;
}

export interface SkillUpdateCheck {
    readonly updateAvailable: boolean;
    readonly sourceChanged: boolean;
    readonly contentChanged: boolean;
    readonly metadataChanged: boolean;
    readonly currentRevision?: string;
    readonly sourceFingerprint: string;
    readonly manifestDigest: string;
}
