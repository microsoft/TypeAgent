// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CopilotClient,
    type CopilotClientOptions,
    type CopilotSession,
    type SessionConfig,
} from "@github/copilot-sdk";
import type {
    AgentServerConnection,
    CatalogEntry,
    SkillIdentity,
} from "@typeagent/agent-server-client";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    connectToAgentServer,
    TYPEAGENT_URL,
} from "../shared/typeagent-client.js";
import {
    skillResourceUri,
    validateSkillResourcePath,
} from "../shared/skill-resource.js";

export interface SkillSelection {
    identity: SkillIdentity;
    /**
     * An omitted revision selects the catalog's active revision. An explicit
     * revision may be active or approved, but never draft, disabled, or archived.
     */
    revision?: string;
}

export interface CopilotClientLike {
    createSession(config: SessionConfig): Promise<CopilotSession>;
    stop(): Promise<Error[]>;
}

export interface ApprovedSkillSessionDependencies {
    connect: () => Promise<AgentServerConnection>;
    createClient: (options: CopilotClientOptions) => CopilotClientLike;
    serverIdentity: string;
    temporaryRoot: string;
}

export type SkillMaterializationDependencies = Pick<
    ApprovedSkillSessionDependencies,
    "connect" | "serverIdentity" | "temporaryRoot"
>;

export interface ApprovedSkillMaterialization {
    readonly rootDirectory: string;
    readonly skillDirectories: readonly string[];
    close(): Promise<void>;
    closeSync(): void;
    [Symbol.asyncDispose](): Promise<void>;
}

export interface ApprovedSkillSessionOptions {
    skills: readonly SkillSelection[];
    client?: Omit<CopilotClientOptions, "baseDirectory" | "mode">;
    session?: Omit<
        SessionConfig,
        | "disabledSkills"
        | "enableConfigDiscovery"
        | "enableFileHooks"
        | "enableSessionStore"
        | "enableSkills"
        | "includedBuiltinSkills"
        | "instructionDirectories"
        | "pluginDirectories"
        | "remoteSession"
        | "skillDirectories"
    >;
}

export interface ApprovedSkillSession {
    readonly session: CopilotSession;
    readonly skillDirectories: readonly string[];
    close(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
}

const defaultDependencies: ApprovedSkillSessionDependencies = {
    connect: connectToAgentServer,
    createClient: (options) => new CopilotClient(options),
    serverIdentity: TYPEAGENT_URL,
    temporaryRoot: tmpdir(),
};

const defaultMaterializationDependencies: SkillMaterializationDependencies =
    defaultDependencies;

/**
 * Materializes selected immutable revisions without executing package content.
 * The returned lease owns the files and must live as long as the SDK session.
 */
export async function materializeApprovedSkills(
    selections: readonly SkillSelection[],
    dependencies: SkillMaterializationDependencies = defaultMaterializationDependencies,
): Promise<ApprovedSkillMaterialization> {
    if (selections.length === 0) {
        throw new Error("At least one approved skill must be selected.");
    }
    if (dependencies.serverIdentity.trim().length === 0) {
        throw new Error("The agent-server identity must not be empty.");
    }
    const rootDirectory = await mkdtemp(
        path.join(dependencies.temporaryRoot, "typeagent-skill-session-"),
    );
    try {
        const skillDirectories = await materializeApprovedSkillFiles(
            selections,
            dependencies,
            rootDirectory,
        );
        let closePromise: Promise<void> | undefined;
        const close = (): Promise<void> => {
            closePromise ??= rm(rootDirectory, {
                recursive: true,
                force: true,
            });
            return closePromise;
        };
        return {
            rootDirectory,
            skillDirectories,
            close,
            closeSync() {
                rmSync(rootDirectory, { recursive: true, force: true });
            },
            [Symbol.asyncDispose]: close,
        };
    } catch (error) {
        await rm(rootDirectory, { recursive: true, force: true });
        throw error;
    }
}

export function isolatedSkillSessionConfig(
    skillDirectories: readonly string[],
): Pick<
    SessionConfig,
    | "availableTools"
    | "enableConfigDiscovery"
    | "enableFileHooks"
    | "enableSessionStore"
    | "enableSkills"
    | "includedBuiltinSkills"
    | "instructionDirectories"
    | "pluginDirectories"
    | "remoteSession"
    | "skillDirectories"
> {
    return {
        availableTools: [],
        ...selectedSkillSessionConfig(skillDirectories),
    };
}

export function selectedSkillSessionConfig(
    skillDirectories: readonly string[],
): Omit<ReturnType<typeof isolatedSkillSessionConfig>, "availableTools"> {
    return {
        enableConfigDiscovery: false,
        enableFileHooks: false,
        enableSessionStore: false,
        enableSkills: true,
        includedBuiltinSkills: [],
        instructionDirectories: [],
        pluginDirectories: [],
        remoteSession: "off",
        skillDirectories: [...skillDirectories],
    };
}

/**
 * Creates a private SDK runtime whose only skill source is the selected,
 * catalog-approved immutable revisions.
 */
export async function createApprovedSkillSession(
    options: ApprovedSkillSessionOptions,
    dependencies: ApprovedSkillSessionDependencies = defaultDependencies,
): Promise<ApprovedSkillSession> {
    let materialization: ApprovedSkillMaterialization | undefined;
    let client: CopilotClientLike | undefined;
    let sdkSession: CopilotSession | undefined;
    try {
        materialization = await materializeApprovedSkills(
            options.skills,
            dependencies,
        );
        const { rootDirectory: sessionRoot, skillDirectories } =
            materialization;
        const baseDirectory = path.join(sessionRoot, "copilot-home");
        await mkdir(baseDirectory, { recursive: true });
        client = dependencies.createClient({
            ...options.client,
            mode: "empty",
            baseDirectory,
        });
        sdkSession = await client.createSession({
            ...options.session,
            ...isolatedSkillSessionConfig(skillDirectories),
            availableTools: options.session?.availableTools ?? [],
        });
        return manageSession(sdkSession, client, materialization);
    } catch (error) {
        if (sdkSession !== undefined) {
            await sdkSession.disconnect().catch(() => {});
        }
        if (client !== undefined) {
            await client.stop().catch(() => []);
        }
        await materialization?.close();
        throw error;
    }
}

async function materializeApprovedSkillFiles(
    selections: readonly SkillSelection[],
    dependencies: SkillMaterializationDependencies,
    sessionRoot: string,
): Promise<string[]> {
    const connection = await dependencies.connect();
    try {
        requireCatalogApi(connection);
        const seen = new Set<string>();
        const directories: string[] = [];
        const selectedEntries: CatalogEntry[] = [];
        for (const selection of selections) {
            const entry = await connection.getSkill({
                identity: selection.identity,
                ...(selection.revision === undefined
                    ? {}
                    : { revision: selection.revision }),
            });
            validateSelectedEntry(selection, entry);
            const key = skillResourceUri(
                entry.revision.identity,
                entry.revision.revision,
                "SKILL.md",
            );
            if (seen.has(key)) {
                throw new Error(
                    `Skill revision selected more than once: ${key}`,
                );
            }
            seen.add(key);
            selectedEntries.push(entry);
            directories.push(
                await materializeSkill(
                    connection,
                    entry,
                    dependencies.serverIdentity,
                    sessionRoot,
                    key,
                ),
            );
        }

        // Approval is mutable. Recheck it after all network reads and immediately
        // before handing the files to the SDK.
        for (let index = 0; index < selections.length; index++) {
            const selection = selections[index];
            const entry = await connection.getSkill({
                identity: selection.identity,
                ...(selection.revision === undefined
                    ? {}
                    : { revision: selection.revision }),
            });
            validateSelectedEntry(selection, entry);
            if (
                entry.revision.revision !==
                selectedEntries[index].revision.revision
            ) {
                throw new Error(
                    "The active skill revision changed during materialization.",
                );
            }
        }
        return directories;
    } finally {
        await connection.close();
    }
}

async function materializeSkill(
    connection: AgentServerConnection,
    entry: CatalogEntry,
    serverIdentity: string,
    sessionRoot: string,
    skillUri: string,
): Promise<string> {
    const revision = entry.revision.revision;
    requireDigest(revision, "skill revision");
    const skillDirectory = path.join(
        sessionRoot,
        `server-${digestName(serverIdentity)}`,
        `skill-${digestName(skillUri)}`,
        revision,
    );
    const paths = new Set<string>();
    let hasRootSkillFile = false;
    for (const file of entry.revision.manifest) {
        validateSkillResourcePath(file.path);
        if (file.path === "SKILL.md") hasRootSkillFile = true;
        const collisionKey =
            process.platform === "win32" ? file.path.toLowerCase() : file.path;
        if (paths.has(collisionKey)) {
            throw new Error(`Duplicate skill manifest path: ${file.path}`);
        }
        paths.add(collisionKey);
        requireDigest(file.sha256, `digest for ${file.path}`);
        if (!Number.isSafeInteger(file.size) || file.size < 0) {
            throw new Error(`Invalid size for skill file ${file.path}`);
        }
        if (connection.readSkillFile === undefined) {
            throw unsupportedSkillsApi();
        }
        const response = await connection.readSkillFile({
            identity: entry.revision.identity,
            revision,
            path: file.path,
        });
        const bytes = decodeBase64(response.content, file.path);
        if (bytes.byteLength !== file.size) {
            throw new Error(
                `Size mismatch for skill file ${file.path}: expected ${file.size}, received ${bytes.byteLength}`,
            );
        }
        const digest = createHash("sha256").update(bytes).digest("hex");
        if (digest !== file.sha256.toLowerCase()) {
            throw new Error(`Digest mismatch for skill file ${file.path}`);
        }
        const destination = path.join(skillDirectory, ...file.path.split("/"));
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, bytes, { flag: "wx" });
    }
    if (!hasRootSkillFile) {
        throw new Error(
            `${entry.revision.qualifiedName} does not contain a root SKILL.md.`,
        );
    }
    return skillDirectory;
}

function validateSelectedEntry(
    selection: SkillSelection,
    entry: CatalogEntry | undefined,
): asserts entry is CatalogEntry {
    if (entry === undefined) {
        throw new Error(`Unknown skill: ${JSON.stringify(selection.identity)}`);
    }
    if (!sameIdentity(entry.revision.identity, selection.identity)) {
        throw new Error("The catalog returned a different skill identity.");
    }
    if (
        selection.revision !== undefined &&
        entry.revision.revision !== selection.revision
    ) {
        throw new Error("The catalog returned a different skill revision.");
    }
    if (entry.state !== "active" && entry.state !== "approved") {
        throw new Error(
            `Skill revision ${entry.revision.revision} is ${entry.state}; only active or approved revisions may be materialized.`,
        );
    }
    if (selection.revision === undefined && !entry.active) {
        throw new Error("The catalog did not return an active skill revision.");
    }
    if ((entry.state === "active") !== entry.active) {
        throw new Error(
            "The catalog returned inconsistent active skill state.",
        );
    }
}

function manageSession(
    session: CopilotSession,
    client: CopilotClientLike,
    materialization: ApprovedSkillMaterialization,
): ApprovedSkillSession {
    let closePromise: Promise<void> | undefined;
    const close = (disconnect = true): Promise<void> => {
        closePromise ??= (async () => {
            let disconnectError: unknown;
            if (disconnect) {
                try {
                    await session.disconnect();
                } catch (error) {
                    disconnectError = error;
                }
            }
            const stopErrors = await client
                .stop()
                .catch((error: unknown) => [
                    error instanceof Error ? error : new Error(String(error)),
                ]);
            await materialization.close();
            if (disconnectError !== undefined) throw disconnectError;
            if (stopErrors.length > 0) {
                throw new AggregateError(
                    stopErrors,
                    "Copilot client cleanup failed.",
                );
            }
        })();
        return closePromise;
    };
    session.on("session.shutdown", () => {
        void close(false).catch(() => {});
    });
    const managedSession = new Proxy(session, {
        get(target, property) {
            if (property === "disconnect" || property === Symbol.asyncDispose) {
                return () => close();
            }
            const value = Reflect.get(target, property, target) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    return {
        session: managedSession,
        skillDirectories: materialization.skillDirectories,
        close: () => close(),
        [Symbol.asyncDispose]: () => close(),
    };
}

function requireCatalogApi(
    connection: AgentServerConnection,
): asserts connection is AgentServerConnection &
    Required<Pick<AgentServerConnection, "getSkill" | "readSkillFile">> {
    if (
        connection.getSkill === undefined ||
        connection.readSkillFile === undefined
    ) {
        throw unsupportedSkillsApi();
    }
}

function unsupportedSkillsApi(): Error {
    return new Error(
        "The connected TypeAgent server does not support the skills catalog API.",
    );
}

function sameIdentity(left: SkillIdentity, right: SkillIdentity): boolean {
    return (
        left.scope === right.scope &&
        left.origin === right.origin &&
        left.name === right.name
    );
}

function requireDigest(value: string, label: string): void {
    if (!/^[a-fA-F0-9]{64}$/.test(value)) {
        throw new Error(`Invalid SHA-256 ${label}: ${value}`);
    }
}

function decodeBase64(value: string, filePath: string): Buffer {
    if (
        value.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            value,
        )
    ) {
        throw new Error(`Invalid base64 content for skill file ${filePath}`);
    }
    return Buffer.from(value, "base64");
}

function digestName(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}
