// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
    verifyRecipeAuthoringContext,
    type RecipeAuthoringContextStore,
    type SealedRecipeAuthoringContext,
} from "./recipeAuthoring.js";
import {
    recipeDigest,
    validateRuntimeJsonSchema,
    type RecipeScope,
} from "./recipeCore.js";

function object(
    value: unknown,
    required: string[],
    optional: string[] = [],
): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new Error("Malformed authoring context object.");
    const record = value as Record<string, unknown>;
    if (
        required.some(
            (key) => !Object.prototype.hasOwnProperty.call(record, key),
        ) ||
        Object.keys(record).some(
            (key) => !required.includes(key) && !optional.includes(key),
        )
    )
        throw new Error("Unsupported or missing authoring context fields.");
    return record;
}

function strings(value: unknown): asserts value is string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
        throw new Error("Malformed authoring context strings.");
}

function oneOf(value: unknown, allowed: string[]): boolean {
    return typeof value === "string" && allowed.includes(value);
}

function text(record: Record<string, unknown>, keys: string[]): void {
    strings(keys.map((key) => record[key]));
}

function items(value: unknown): unknown[] {
    if (!Array.isArray(value))
        throw new Error("Malformed authoring context array.");
    return value;
}

function identity(value: unknown): asserts value is string {
    if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > 4096 ||
        value.includes("\0") ||
        /(^|[\\/])\.\.?($|[\\/])/.test(value)
    )
        throw new Error("Invalid authoring context scope or capture identity.");
}

function scope(value: unknown): asserts value is RecipeScope {
    const record = object(value, ["workspaceId", "profileId"]);
    identity(record.workspaceId);
    identity(record.profileId);
}

function privateArtifacts(value: unknown): void {
    for (const item of items(value)) {
        const artifact = object(item, ["reference", "scope", "taskId"]);
        scope(artifact.scope);
        text(artifact, ["taskId"]);
        const reference = object(artifact.reference, [
            "schemaVersion",
            "capability",
            "owner",
            "ownerId",
            "toolCallId",
            "source",
            "id",
            "encoding",
            "sha256",
            "sizeBytes",
            "sensitive",
            "view",
            "omittedPaths",
            "blobs",
        ]);
        text(reference, ["ownerId", "toolCallId", "id", "sha256"]);
        if (
            reference.schemaVersion !== 1 ||
            reference.capability !== "private-result-evidence-v1" ||
            !oneOf(reference.owner, ["trace", "run"]) ||
            !oneOf(reference.source, ["result", "modelResult"]) ||
            reference.encoding !== "json-utf8" ||
            reference.sensitive !== true ||
            !Number.isSafeInteger(reference.sizeBytes) ||
            (reference.sizeBytes as number) < 0
        )
            throw new Error("Unsupported private artifact reference.");
        items(reference.omittedPaths).forEach(strings);
        for (const value of items(reference.blobs)) {
            const blob = object(value, [
                "path",
                "encoding",
                "sha256",
                "sizeBytes",
            ]);
            strings(blob.path);
            text(blob, ["sha256"]);
            if (
                blob.encoding !== "base64" ||
                !Number.isSafeInteger(blob.sizeBytes) ||
                (blob.sizeBytes as number) < 0
            )
                throw new Error("Unsupported private artifact blob reference.");
        }
    }
}

function capture(value: unknown): void {
    const record = object(value, [
        "captureId",
        "tokenId",
        "sessionId",
        "taskId",
        "boundary",
        "origin",
        "outcome",
        "scope",
        "mode",
        "request",
        "decisionSummary",
        "contextArtifacts",
        "omissions",
        "outputEvidenceIds",
        "calls",
    ]);
    text(record, [
        "captureId",
        "tokenId",
        "sessionId",
        "taskId",
        "request",
        "decisionSummary",
    ]);
    identity(record.captureId);
    scope(record.scope);
    text(object(record.boundary, ["firstEventId", "lastEventId"]), [
        "firstEventId",
        "lastEventId",
    ]);
    if (
        record.origin !== "task" ||
        record.outcome !== "succeeded" ||
        !oneOf(record.mode, ["off", "prepare", "read-only", "all"])
    )
        throw new Error(
            "Unsupported capture origin, outcome, or learning mode.",
        );
    privateArtifacts(record.contextArtifacts);
    strings(record.omissions);
    strings(record.outputEvidenceIds);
    for (const value of items(record.calls)) {
        const call = object(
            value,
            ["callId", "executionOwner"],
            ["parentCallId"],
        );
        text(call, [
            "callId",
            ...(call.parentCallId === undefined ? [] : ["parentCallId"]),
        ]);
        if (!oneOf(call.executionOwner, ["program", "host"]))
            throw new Error("Unsupported recorded call owner.");
    }
}

function completion(value: unknown): void {
    const record = object(value, [
        "token",
        "taskId",
        "selectedTaskId",
        "sessionId",
        "origin",
        "outcome",
        "successEventId",
        "now",
    ]);
    text(record, [
        "taskId",
        "selectedTaskId",
        "sessionId",
        "successEventId",
        "now",
    ]);
    if (record.origin !== "task" || record.outcome !== "succeeded")
        throw new Error("Only successful original tasks can be retained.");
    const token = object(
        record.token,
        ["id", "sessionId", "status", "expiresAt"],
        ["cwd", "promptHash", "learning"],
    );
    text(token, [
        "id",
        "sessionId",
        "expiresAt",
        ...["cwd", "promptHash"].filter((key) => token[key] !== undefined),
    ]);
    if (
        token.status !== "claimed" ||
        (token.learning !== undefined && typeof token.learning !== "boolean")
    )
        throw new Error("Unsupported recording token.");
}

function context(value: unknown): void {
    const record = object(value, [
        "capture",
        "constraints",
        "messages",
        "workingCode",
        "capabilities",
        "outputs",
        "omissions",
    ]);
    capture(record.capture);
    strings(record.constraints);
    for (const value of items(record.messages)) {
        const message = object(
            value,
            ["eventId", "role", "content"],
            ["callId"],
        );
        text(message, [
            "eventId",
            ...(message.callId === undefined ? [] : ["callId"]),
        ]);
        if (!oneOf(message.role, ["user", "assistant", "tool"]))
            throw new Error("Unsupported context message role.");
    }
    for (const value of items(record.workingCode))
        text(object(value, ["id", "language", "text", "version"]), [
            "id",
            "language",
            "text",
            "version",
        ]);
    for (const value of items(record.capabilities)) {
        const capability = object(
            value,
            [
                "id",
                "transport",
                "providerId",
                "operation",
                "contractVersion",
                "inputSchema",
                "schemaDigest",
                "compatibility",
                "effect",
            ],
            ["outputSchema"],
        );
        text(capability, [
            "id",
            "providerId",
            "operation",
            "contractVersion",
            "schemaDigest",
        ]);
        if (
            !oneOf(capability.transport, ["native", "mcp"]) ||
            capability.compatibility !== "exact" ||
            !oneOf(capability.effect, ["read", "write", "unknown"]) ||
            validateRuntimeJsonSchema(capability.inputSchema).length ||
            (capability.outputSchema !== undefined &&
                validateRuntimeJsonSchema(capability.outputSchema).length)
        )
            throw new Error("Unsupported captured capability schema.");
    }
    for (const value of items(record.outputs)) {
        const output = object(value, ["id", "eventId", "evidence"]);
        text(output, ["id", "eventId"]);
        const evidence = object(
            output.evidence,
            [],
            ["raw", "modelVisible", "privateArtifacts"],
        );
        if (evidence.privateArtifacts !== undefined)
            privateArtifacts(evidence.privateArtifacts);
    }
    for (const value of items(record.omissions)) {
        const omission = object(value, ["material", "reason", "required"]);
        text(omission, ["material", "reason"]);
        if (typeof omission.required !== "boolean")
            throw new Error("Malformed omission metadata.");
    }
}

function supportedData(value: unknown, depth = 0): void {
    if (depth > 64) throw new Error("Authoring context nesting exceeds 64.");
    if (!["object", "string", "number", "boolean"].includes(typeof value))
        throw new Error("Only supported JSON context can be retained.");
    if (typeof value === "number" && !Number.isFinite(value))
        throw new Error("Authoring context requires finite JSON numbers.");
    if (
        typeof value === "string" &&
        /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----|\bBearer\s+[A-Za-z0-9._~+/-]+=*/i.test(
            value,
        )
    )
        throw new Error(
            "Credential material cannot be retained in authoring context.",
        );
    if (value === null || typeof value !== "object") return;
    if (
        !Array.isArray(value) &&
        Object.prototype.toString.call(value) !== "[object Object]"
    )
        throw new Error("Only plain JSON objects can be retained.");
    for (const [key, child] of Object.entries(value)) {
        if (
            /^(?:password|passwd|secret|credentials?|api[_-]?(?:key|token)|access[_-]?token|refresh[_-]?token|authorization|cookie|client[_-]?secret|private[_-]?key)$/i.test(
                key,
            )
        )
            throw new Error(
                "Credential fields cannot be retained in authoring context.",
            );
        supportedData(child, depth + 1);
    }
}

export function parseRecipeAuthoringEnvelope(
    text: string,
): SealedRecipeAuthoringContext {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new Error("Corrupted authoring context JSON.");
    }
    supportedData(value);
    const envelope = object(value, ["digest", "context", "completion"]);
    textField(envelope.digest);
    context(envelope.context);
    completion(envelope.completion);
    const result = value as SealedRecipeAuthoringContext;
    verifyRecipeAuthoringContext(result, result.context.capture.captureId);
    return result;
}

function textField(value: unknown): asserts value is string {
    if (typeof value !== "string")
        throw new Error("Malformed context content identity.");
}

function errorCode(error: unknown): string | undefined {
    return error !== null && typeof error === "object" && "code" in error
        ? String(error.code)
        : undefined;
}

// The caller passes the plugin user-data directory, not the workspace.
// Staged files are never read as envelopes. Hard-link publication cannot replace
// another process's winner; unsupported filesystems fail rather than downgrade.
export class DurableRecipeAuthoringContextStore
    implements RecipeAuthoringContextStore
{
    private readonly directory: string;

    constructor(userDataDirectory: string) {
        if (!isAbsolute(userDataDirectory))
            throw new Error("Plugin user-data directory must be absolute.");
        this.directory = resolve(userDataDirectory, "recipe-authoring-context");
    }

    private path(scopeValue: RecipeScope, captureId: string): string {
        scope(scopeValue);
        identity(captureId);
        return join(
            this.directory,
            `${recipeDigest(JSON.stringify([scopeValue.workspaceId, scopeValue.profileId, captureId]))}.json`,
        );
    }

    private async checkDirectory(): Promise<void> {
        const status = await lstat(this.directory);
        if (!status.isDirectory() || status.isSymbolicLink())
            throw new Error(
                "Authoring context directory must not be a symbolic link.",
            );
    }

    async get(
        scopeValue: RecipeScope,
        captureId: string,
    ): Promise<SealedRecipeAuthoringContext | undefined> {
        const path = this.path(scopeValue, captureId);
        try {
            await this.checkDirectory();
            const status = await lstat(path);
            if (!status.isFile() || status.isSymbolicLink())
                throw new Error(
                    "Authoring context envelope must be a regular file.",
                );
            const stored: unknown = JSON.parse(await readFile(path, "utf8"));
            const file = object(stored, ["schemaVersion", "envelope"]);
            if (file.schemaVersion !== 1)
                throw new Error(
                    "Unsupported stored authoring envelope version.",
                );
            const envelope = parseRecipeAuthoringEnvelope(
                JSON.stringify(file.envelope),
            );
            if (
                envelope.context.capture.captureId !== captureId ||
                envelope.context.capture.scope.workspaceId !==
                    scopeValue.workspaceId ||
                envelope.context.capture.scope.profileId !==
                    scopeValue.profileId
            )
                throw new Error(
                    "Stored authoring context scope or capture mismatch.",
                );
            return envelope;
        } catch (error) {
            if (errorCode(error) === "ENOENT") return undefined;
            if (error instanceof SyntaxError)
                throw new Error(
                    "Cannot read retained authoring context: corrupted JSON.",
                );
            throw new Error(
                `Cannot read retained authoring context: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async put(value: SealedRecipeAuthoringContext): Promise<void> {
        supportedData(value);
        const envelope = parseRecipeAuthoringEnvelope(JSON.stringify(value));
        const { captureId, scope: scopeValue } = envelope.context.capture;
        const destination = this.path(scopeValue, captureId);
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await this.checkDirectory();
        const staging = join(this.directory, `.pending-${randomUUID()}`);
        const handle = await open(staging, "wx", 0o600);
        try {
            try {
                await handle.writeFile(
                    JSON.stringify({ schemaVersion: 1, envelope }),
                    "utf8",
                );
                await handle.sync();
            } finally {
                await handle.close();
            }
            try {
                await link(staging, destination);
            } catch (error) {
                if (errorCode(error) !== "EEXIST") throw error;
                const existing = await this.get(scopeValue, captureId);
                if (!existing || existing.digest !== envelope.digest)
                    throw new Error("Immutable authoring context conflict.");
            }
        } finally {
            await unlink(staging);
        }
    }
}
