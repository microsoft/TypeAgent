// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import type { SessionContext } from "@typeagent/agent-sdk";
import type {
    ScriptRecipe,
    ScriptExecutionProvenance,
} from "../types/scriptRecipe.js";

type ApprovalDefinition = Pick<
    ScriptRecipe,
    | "actionName"
    | "displayName"
    | "description"
    | "parameters"
    | "grammarPatterns"
    | "requiredModules"
>;

type ApprovalSession = Pick<
    SessionContext,
    "requestSecurityApproval" | "currentConnectionId" | "sessionContextId"
>;

export interface ScriptApprovalContext {
    sessionContext: ApprovalSession;
    definition: ApprovalDefinition;
    allowSessionReuse?: boolean;
}

interface ApprovalRequest {
    script: string;
    parameters: Record<string, unknown>;
    workingDirectory?: string | undefined;
    maxExecutionTime: number;
    provenance?: ScriptExecutionProvenance | undefined;
    requiredModules?: string[] | undefined;
    revisionStatus?: "verified" | "unverified" | "changed" | undefined;
}

export interface ApprovedScriptSnapshot extends ApprovalRequest {
    workingDirectory: string;
}

interface ApprovalRecord {
    versionHash: string;
    invocationHash: string;
    script: string;
}

interface ApprovalState {
    generation: number;
    records: Map<string, ApprovalRecord>;
}

// Only trusted UI responses update this session-local authority. It is not
// serialized into flow storage or exposed through model-authored metadata.
const approvals = new Map<string, ApprovalState>();
const permits = new WeakMap<
    ApprovedScriptSnapshot,
    {
        state: ApprovalState;
        generation: number;
        key: string;
        sessionId: string;
        fingerprint: string;
    }
>();

function fingerprint(value: unknown): string {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function issuePermit(
    snapshot: ApprovedScriptSnapshot,
    context: ScriptApprovalContext,
    state: ApprovalState,
    key: string,
): ApprovedScriptSnapshot {
    permits.set(snapshot, {
        state,
        generation: state.generation,
        key,
        sessionId: context.sessionContext.sessionContextId,
        fingerprint: fingerprint(snapshot),
    });
    return snapshot;
}

export function consumeScriptApproval(
    snapshot: ApprovedScriptSnapshot,
    context: ScriptApprovalContext,
): boolean {
    const permit = permits.get(snapshot);
    permits.delete(snapshot);
    return (
        permit !== undefined &&
        permit.state.generation === permit.generation &&
        permit.sessionId === context.sessionContext.sessionContextId &&
        permit.key === approvalKey(context) &&
        permit.fingerprint === fingerprint(snapshot)
    );
}

function visibleReview(value: string): string {
    return Array.from(value, (character) => {
        const code = character.charCodeAt(0);
        const control =
            (code < 32 && code !== 9 && code !== 10) ||
            (code >= 0x7f && code <= 0x9f) ||
            (code >= 0x202a && code <= 0x202e) ||
            (code >= 0x2066 && code <= 0x2069);
        return control ? `\\u${code.toString(16).padStart(4, "0")}` : character;
    }).join("");
}

function stateFor(context: ApprovalSession): ApprovalState {
    let state = approvals.get(context.sessionContextId);
    if (!state) {
        state = { generation: 0, records: new Map() };
        approvals.set(context.sessionContextId, state);
    }
    return state;
}

function approvalKey(context: ScriptApprovalContext): string {
    return JSON.stringify([
        context.sessionContext.currentConnectionId,
        context.definition.actionName,
    ]);
}

function canonicalJson(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
            ? Object.fromEntries(
                  Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
              )
            : item,
    );
}

function versionHash(script: string, definition: ApprovalDefinition): string {
    const {
        actionName,
        displayName,
        description,
        parameters,
        grammarPatterns,
        requiredModules,
    } = definition;
    return createHash("sha256")
        .update(
            canonicalJson({
                contract: "approved-local-v1",
                script,
                actionName,
                displayName,
                description,
                parameters,
                grammarPatterns,
                requiredModules,
            }),
        )
        .digest("hex");
}

function compactReview(value: string): string {
    const line = visibleReview(value)
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t");
    const maximumLength = 200;
    const suffix = "... [truncated; review details]";
    return line.length <= maximumLength
        ? line
        : line.slice(0, maximumLength - suffix.length) + suffix;
}

function approvalSummary(
    snapshot: ApprovedScriptSnapshot,
    definition: ApprovalDefinition,
    changedVersion: boolean,
): string {
    return [
        `Run PowerShell flow ${compactReview(JSON.stringify(definition.actionName))}?`,
        `Folder: ${compactReview(snapshot.workingDirectory)}`,
        `Arguments: ${compactReview(JSON.stringify(snapshot.parameters))}`,
        ...(changedVersion
            ? ["Script or definition changed since approval."]
            : []),
        ...(snapshot.revisionStatus === "unverified"
            ? [
                  "Older saved flow: no recorded fingerprint. Review before establishing this version.",
              ]
            : snapshot.revisionStatus === "changed"
              ? [
                    "Stored script or definition differs from its recorded fingerprint. Review this changed version.",
                ]
              : []),
        "",
        "Uses TypeAgent's user privileges (including elevation). NOT a sandbox: can modify files, access credentials/network, and start programs.",
        "",
        "Review unfamiliar or changed code before approving.",
    ].join("\n");
}

function approvalDetails(
    snapshot: ApprovedScriptSnapshot,
    definition: ApprovalDefinition,
    version: string,
    previous: ApprovalRecord | undefined,
    allowSessionReuse: boolean,
): string {
    return visibleReview(
        [
            "Authorize local PowerShell execution",
            "This is NOT a sandbox. This code can read/change files, use credentials and the network, and start programs with TypeAgent's current user privileges, including elevation if TypeAgent is elevated.",
            `Account: ${userInfo().username}`,
            `Flow: ${JSON.stringify(definition.actionName)}`,
            `Source: ${snapshot.provenance ?? "unknown"}`,
            `Version SHA-256: ${version}`,
            `Runtime: Windows PowerShell, no profile; subject to OS policy`,
            `Working directory: ${snapshot.workingDirectory}`,
            `Timeout: ${snapshot.maxExecutionTime} seconds`,
            "Owned child processes are stopped when this execution ends.",
            `Arguments (JSON):\n${JSON.stringify(snapshot.parameters, null, 2)}`,
            `Modules loaded before the script:\n${JSON.stringify(snapshot.requiredModules ?? [], null, 2)}`,
            `Definition (JSON):\n${JSON.stringify(definition, null, 2)}`,
            ...(previous && previous.versionHash !== version
                ? [`Previously approved script:\n${previous.script}`]
                : []),
            `Exact script to execute (nonprinting/bidi controls escaped for review):\n${snapshot.script}`,
            allowSessionReuse
                ? "Remembered approval covers only this exact script, definition, arguments and working directory in this session. Restarting asks again. Loaded files/modules are not integrity-pinned. Cancel is the default."
                : "Drafts, tests, repairs, reasoning-loop and background invocations require fresh approval. Loaded files/modules are not integrity-pinned. Cancel is the default.",
        ].join("\n\n"),
    );
}

async function askForApproval(
    context: ApprovalSession,
    summary: string,
    details: () => string,
    allowSessionReuse: boolean,
    signal?: AbortSignal,
): Promise<number> {
    signal?.throwIfAborted();
    const requestApproval = context.requestSecurityApproval;
    if (!requestApproval)
        throw new Error(
            "Trusted security approval is unavailable. Model answers cannot authorize execution.",
        );
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () =>
            reject(signal?.reason ?? new Error("Approval cancelled."));
        signal?.addEventListener("abort", onAbort, { once: true });
    });
    try {
        let reviewingDetails = false;
        const choices = allowSessionReuse
            ? [
                  "Run once",
                  "Allow this exact invocation for this session",
                  "Cancel",
              ]
            : ["Run once", "Cancel"];
        while (true) {
            signal?.throwIfAborted();
            const choice = await Promise.race([
                requestApproval({
                    message: reviewingDetails ? details() : summary,
                    choices: [
                        ...choices,
                        reviewingDetails
                            ? "Back to summary"
                            : "Review script and details",
                    ],
                    defaultId: choices.length - 1,
                }),
                cancelled,
            ]);
            if (choice !== choices.length) return choice;
            reviewingDetails = !reviewingDetails;
        }
    } finally {
        if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
}

export async function authorizeLocalScript(
    request: ApprovalRequest,
    context: ScriptApprovalContext,
    signal?: AbortSignal,
): Promise<ApprovedScriptSnapshot | undefined> {
    signal?.throwIfAborted();
    if (
        !context.sessionContext.sessionContextId ||
        !context.sessionContext.requestSecurityApproval
    ) {
        throw new Error(
            "A trusted session and security approval channel are required.",
        );
    }
    const snapshot: ApprovedScriptSnapshot = JSON.parse(
        JSON.stringify({
            script: request.script,
            parameters: request.parameters,
            workingDirectory: resolve(
                request.workingDirectory ?? process.cwd(),
            ),
            maxExecutionTime: request.maxExecutionTime,
            provenance: request.provenance,
            requiredModules: request.requiredModules ?? [],
            revisionStatus: request.revisionStatus,
        }),
    );
    const {
        actionName,
        displayName,
        description,
        parameters,
        grammarPatterns,
        requiredModules,
    } = context.definition;
    const definition = JSON.parse(
        JSON.stringify({
            actionName,
            displayName,
            description,
            parameters,
            grammarPatterns,
            requiredModules,
        }),
    ) as ApprovalDefinition;
    const version = versionHash(snapshot.script, definition);
    const invocation = createHash("sha256")
        .update(
            canonicalJson({
                version,
                parameters: snapshot.parameters,
                workingDirectory: snapshot.workingDirectory,
                maxExecutionTime: snapshot.maxExecutionTime,
                requiredModules: snapshot.requiredModules,
            }),
        )
        .digest("hex");
    const state = stateFor(context.sessionContext);
    const key = approvalKey(context);
    const previous = state.records.get(key);
    const allowSessionReuse = context.allowSessionReuse === true;
    if (allowSessionReuse && previous?.invocationHash === invocation)
        return issuePermit(snapshot, context, state, key);
    const generation = state.generation;
    const choice = await askForApproval(
        context.sessionContext,
        approvalSummary(
            snapshot,
            definition,
            previous !== undefined && previous.versionHash !== version,
        ),
        () =>
            approvalDetails(
                snapshot,
                definition,
                version,
                previous,
                allowSessionReuse,
            ),
        allowSessionReuse,
        signal,
    );
    signal?.throwIfAborted();
    if (state.generation !== generation || approvalKey(context) !== key) {
        throw new Error(
            "The approval scope changed while confirmation was pending.",
        );
    }
    if (choice !== 0 && !(allowSessionReuse && choice === 1)) return undefined;
    if (allowSessionReuse && choice === 1) {
        state.records.set(key, {
            versionHash: version,
            invocationHash: invocation,
            script: snapshot.script,
        });
    }
    return issuePermit(snapshot, context, state, key);
}

export function revokeScriptApprovals(context: ApprovalSession): void {
    const state = stateFor(context);
    state.generation++;
    state.records.clear();
}

export function closeScriptApprovals(context: ApprovalSession): void {
    revokeScriptApprovals(context);
    approvals.delete(context.sessionContextId);
}

export function scriptApprovalStatus(
    context: ScriptApprovalContext,
    script: string,
): string {
    const record = stateFor(context.sessionContext).records.get(
        approvalKey(context),
    );
    if (!record) return "Not approved in this session (confirmation required)";
    return record.versionHash === versionHash(script, context.definition)
        ? "Version approved for one exact invocation in this session; arguments/context are checked on every run"
        : "Changed since approval (new confirmation required)";
}
