// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import { getMacroActionName } from "./macroAgentProvider.js";
import { isDeepStrictEqual } from "node:util";
import type {
    MacroBuildResponseContext,
    MacroGrammarContext,
    MacroGrammarEvidence,
    MacroLearningRuntimeOptions,
} from "./macroLearningRuntime.js";

export const syntheticMacroBuildResponsePolicyKind =
    "native-synthetic-build-response-policy-v1";
export const nativeSyntheticBuildResponseDiagnosticContract =
    syntheticMacroBuildResponsePolicyKind;
export const nativeSyntheticGrammarDiagnosticContract =
    "native-synthetic-grammar-policy-v1";
const grammarFlag = "TYPEAGENT_MACRO_GRAMMAR_DIAGNOSTIC_POLICY";
const flag = "TYPEAGENT_MACRO_BUILD_RESPONSE_DIAGNOSTIC_POLICY";
const cap = 262144;
const tools = [
    "macro-eval-docs-lookup_document",
    "macro-eval-docs-fetch_document",
];
const fields = [
    "schemaVersion",
    "kind",
    "owner",
    "ownedRoot",
    "dataRoot",
    "instanceName",
    "configPath",
    "expectedSessionId",
    "expectedPrompt",
    "expectedToolCalls",
    "maxResponseBytes",
    "maxResponses",
];
type DiagnosticPolicy = {
    schemaVersion: 1;
    kind: typeof syntheticMacroBuildResponsePolicyKind;
    owner: string;
    ownedRoot: string;
    dataRoot: string;
    instanceName: string;
    configPath: string;
    expectedSessionId: string;
    expectedPrompt: string;
    expectedToolCalls: {
        name: string;
        mcpServerName: string;
        arguments: Record<string, string>;
    }[];
    maxResponseBytes: number;
    maxResponses: number;
};
type GrammarPolicy = Omit<
    DiagnosticPolicy,
    "kind" | "maxResponseBytes" | "maxResponses"
> & {
    kind: typeof nativeSyntheticGrammarDiagnosticContract;
    maxArtifactBytes: number;
    maxArtifacts: number;
};
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireDiagnostic(
    condition: unknown,
    code: string,
): asserts condition {
    if (!condition)
        throw new Error(
            `Synthetic build response diagnostics rejected: ${code}.`,
        );
}
function hash(value: string | Buffer) {
    return createHash("sha256").update(value).digest("hex");
}
function samePath(a: unknown, b: unknown) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    const normalize = (value: string) =>
        process.platform === "win32"
            ? path.resolve(value).toLowerCase()
            : path.resolve(value);
    return normalize(a) === normalize(b);
}
function inside(root: string, target: string) {
    const relative = path.relative(root, target);
    return (
        !path.isAbsolute(relative) &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`)
    );
}
async function safePath(root: string, target: string) {
    requireDiagnostic(inside(root, target), "foreign-path");
    let current = path.resolve(root);
    const components = path
        .relative(root, target)
        .split(path.sep)
        .filter(Boolean);
    for (const component of ["", ...components]) {
        current = component ? path.join(current, component) : current;
        const info = await lstat(current);
        requireDiagnostic(
            !info.isSymbolicLink() &&
                samePath(await realpath(current), current),
            "unsafe-path",
        );
    }
}
async function readOwned(root: string, filename: string, maximum: number) {
    await safePath(root, filename);
    const before = await lstat(filename);
    requireDiagnostic(
        before.isFile() && before.nlink === 1 && before.size <= maximum,
        "unsafe-file",
    );
    const handle = await open(filename, "r");
    let bytes: Buffer;
    try {
        const opened = await handle.stat();
        requireDiagnostic(
            opened.ino === before.ino &&
                opened.dev === before.dev &&
                opened.size === before.size &&
                opened.nlink === 1,
            "file-changed",
        );
        bytes = Buffer.alloc(before.size);
        let count = 0;
        while (count < bytes.length) {
            const read = await handle.read(
                bytes,
                count,
                bytes.length - count,
                count,
            );
            requireDiagnostic(read.bytesRead > 0, "incomplete-file");
            count += read.bytesRead;
        }
        const after = await handle.stat();
        requireDiagnostic(
            after.size === opened.size &&
                after.mtimeMs === opened.mtimeMs &&
                after.ctimeMs === opened.ctimeMs &&
                after.nlink === 1,
            "file-changed",
        );
    } finally {
        await handle.close();
    }
    const after = await lstat(filename);
    requireDiagnostic(
        after.ino === before.ino &&
            after.dev === before.dev &&
            after.size === before.size &&
            after.mtimeMs === before.mtimeMs,
        "file-changed",
    );
    await safePath(root, filename);
    const text = bytes.toString("utf8");
    requireDiagnostic(Buffer.from(text).equals(bytes), "invalid-encoding");
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new Error(
            "Synthetic build response diagnostics rejected: invalid-json.",
        );
    }
    return { value, sha256: hash(bytes), modifiedAt: before.mtimeMs };
}
function validatePolicy(
    value: unknown,
    root: string,
    dataRoot: string,
    instanceDir: string,
): asserts value is DiagnosticPolicy {
    requireDiagnostic(
        isRecord(value) &&
            Object.keys(value).length === fields.length &&
            Object.keys(value).every((key) => fields.includes(key)),
        "policy-shape",
    );
    requireDiagnostic(
        value.schemaVersion === 1 &&
            value.kind === syntheticMacroBuildResponsePolicyKind &&
            typeof value.owner === "string" &&
            /^[a-zA-Z0-9_-]{1,80}$/.test(value.owner) &&
            value.instanceName === `macro-eval-${value.owner.slice(0, 8)}` &&
            samePath(value.ownedRoot, root) &&
            samePath(value.dataRoot, dataRoot) &&
            samePath(
                instanceDir,
                path.join(dataRoot, "profiles", value.instanceName),
            ) &&
            value.instanceName === process.env.INSTANCE_NAME &&
            samePath(dataRoot, process.env.TYPEAGENT_USER_DATA_DIR) &&
            typeof value.configPath === "string" &&
            path.isAbsolute(value.configPath) &&
            typeof value.expectedSessionId === "string" &&
            value.expectedSessionId.length > 0 &&
            typeof value.expectedPrompt === "string" &&
            value.expectedPrompt.length > 0 &&
            value.maxResponseBytes === cap &&
            value.maxResponses === 2,
        "policy-scope",
    );
    requireDiagnostic(
        Array.isArray(value.expectedToolCalls) &&
            value.expectedToolCalls.length === 2,
        "policy-tools",
    );
    value.expectedToolCalls.forEach((tool: unknown, index: number) => {
        requireDiagnostic(
            isRecord(tool) &&
                Object.keys(tool).length === 3 &&
                Object.keys(tool).every((key) =>
                    ["name", "mcpServerName", "arguments"].includes(key),
                ) &&
                tool.name === tools[index] &&
                tool.mcpServerName === "macro-eval-docs" &&
                isRecord(tool.arguments) &&
                Object.keys(tool.arguments).length === 1 &&
                typeof tool.arguments[index === 0 ? "title" : "id"] ===
                    "string",
            "policy-tools",
        );
    });
}
function validateSource(
    context: MacroBuildResponseContext,
    trace: unknown,
    policy: DiagnosticPolicy,
    modifiedAt: number,
) {
    requireDiagnostic(
        context.phase === "initial" || context.phase === "grounding-correction",
        "phase",
    );
    validateTrace(context.baseline, context.traceId, trace, policy, modifiedAt);
    requireDiagnostic(
        isRecord(trace) &&
            isDeepStrictEqual(
                JSON.parse(JSON.stringify(context.trace)),
                trace,
            ) &&
            context.recipe.traceId === context.traceId &&
            context.recipe.request === trace.prompt &&
            context.recipe.uncertainties.length === 0 &&
            Array.isArray(trace.toolCalls) &&
            isDeepStrictEqual(
                context.recipe.toolCallIds,
                trace.toolCalls.map((call: unknown) =>
                    isRecord(call) ? call.toolCallId : undefined,
                ),
            ),
        "source-provenance",
    );
}

function validateTrace(
    macro: MacroBuildResponseContext["baseline"],
    traceId: string,
    trace: unknown,
    policy: Pick<
        DiagnosticPolicy,
        | "expectedSessionId"
        | "expectedPrompt"
        | "ownedRoot"
        | "expectedToolCalls"
    >,
    modifiedAt: number,
) {
    requireDiagnostic(
        isRecord(trace) &&
            trace.schemaVersion === 1 &&
            trace.capabilities === undefined &&
            trace.sessionId === policy.expectedSessionId &&
            trace.prompt === policy.expectedPrompt &&
            samePath(trace.cwd, path.join(policy.ownedRoot, "workspace")) &&
            typeof trace.response === "string" &&
            trace.response.trim().length > 0 &&
            typeof trace.startedAt === "string" &&
            typeof trace.completedAt === "string" &&
            Number.isFinite(Date.parse(trace.startedAt)) &&
            Date.parse(trace.startedAt) >= modifiedAt &&
            Date.parse(trace.completedAt) >= Date.parse(trace.startedAt) &&
            Date.parse(trace.completedAt) <= Date.now() + 1000 &&
            modifiedAt <= Date.now() + 1000 &&
            Date.now() - modifiedAt <= 300000,
        "source-scope",
    );
    requireDiagnostic(
        Array.isArray(trace.toolCalls) && trace.toolCalls.length === 2,
        "source-provenance",
    );
    trace.toolCalls.forEach((call: unknown, index: number) => {
        const expected = policy.expectedToolCalls[index];
        requireDiagnostic(
            isRecord(call) &&
                call.name === expected.name &&
                call.mcpServerName === expected.mcpServerName &&
                call.status === "completed" &&
                call.result !== undefined &&
                !call.resultArtifact &&
                !call.modelResultArtifact &&
                isDeepStrictEqual(call.arguments, expected.arguments) &&
                macro.steps[index]?.sourceToolCallId === call.toolCallId,
            "source-tools",
        );
    });
    requireDiagnostic(
        macro.steps.length === 2 && macro.sourceTraceId === traceId,
        "baseline-provenance",
    );
}

function createSyntheticMacroBuildDiagnostics(
    instanceDir: string,
): MacroLearningRuntimeOptions | undefined {
    const policyFile = process.env[flag];
    if (policyFile === undefined) return undefined;
    const dataRoot = path.dirname(path.dirname(path.resolve(instanceDir)));
    const ownedRoot = path.dirname(dataRoot);
    const phases = new Map<
        string,
        { state: "reserved" | "retained"; requestSha256: string }
    >();
    let boundTrace: string | undefined,
        policySha: string | undefined,
        traceSha: string | undefined;
    async function verify(
        context: MacroBuildResponseContext,
        signal: AbortSignal,
    ) {
        signal.throwIfAborted();
        requireDiagnostic(
            process.env[flag] === policyFile &&
                path.isAbsolute(policyFile!) &&
                samePath(
                    policyFile!,
                    path.join(dataRoot, "native-build-response-policy.json"),
                ),
            "policy-location",
        );
        const policy = await readOwned(ownedRoot, policyFile!, 32768);
        validatePolicy(policy.value, ownedRoot, dataRoot, instanceDir);
        const admission = await readOwned(
            ownedRoot,
            path.join(dataRoot, "native-control-admission.json"),
            65536,
        );
        requireDiagnostic(
            isRecord(admission.value) &&
                admission.value.owner === policy.value.owner &&
                samePath(admission.value.ownedRoot, ownedRoot) &&
                admission.value.configPath === policy.value.configPath &&
                admission.value.nativeSyntheticOriginals === true,
            "owner-admission",
        );
        requireDiagnostic(
            /^[a-zA-Z0-9_-]{1,80}$/.test(context.traceId) &&
                /^[a-f0-9]{64}$/.test(context.requestSha256),
            "trace-id",
        );
        const source = await readOwned(
            ownedRoot,
            path.join(
                instanceDir,
                "copilot-macros",
                "traces",
                `${context.traceId}.json`,
            ),
            1048576,
        );
        validateSource(context, source.value, policy.value, policy.modifiedAt);
        requireDiagnostic(
            (boundTrace === undefined || boundTrace === context.traceId) &&
                (policySha === undefined || policySha === policy.sha256) &&
                (traceSha === undefined || traceSha === source.sha256),
            "scope-drift",
        );
        signal.throwIfAborted();
        return { policy: { ...policy, value: policy.value }, source };
    }
    return {
        buildResponseEvidence: {
            async assertSource(context, signal) {
                const { policy, source } = await verify(context, signal);
                requireDiagnostic(
                    !phases.has(context.phase) &&
                        phases.size < 2 &&
                        (context.phase === "initial" ||
                            phases.get("initial")?.state === "retained"),
                    "response-budget",
                );
                boundTrace = context.traceId;
                policySha = policy.sha256;
                traceSha = source.sha256;
                phases.set(context.phase, {
                    state: "reserved",
                    requestSha256: context.requestSha256,
                });
            },
            async retainResponse(context, response, signal) {
                const { policy, source } = await verify(context, signal);
                requireDiagnostic(
                    phases.get(context.phase)?.state === "reserved" &&
                        phases.get(context.phase)?.requestSha256 ===
                            context.requestSha256 &&
                        typeof response === "string" &&
                        Buffer.byteLength(response, "utf8") <= cap,
                    "response-budget",
                );
                const record = {
                    schemaVersion: 1,
                    kind: "native-synthetic-build-response-evidence-v1",
                    admission: false,
                    sensitive: true,
                    owner: policy.value.owner,
                    traceId: context.traceId,
                    sessionId: policy.value.expectedSessionId,
                    phase: context.phase,
                    macroId: context.baseline.macroId,
                    sourceTraceSha256: source.sha256,
                    policySha256: policy.sha256,
                    requestSha256: context.requestSha256,
                    responseSha256: hash(response),
                    responseSizeBytes: Buffer.byteLength(response, "utf8"),
                    capturedAt: new Date().toISOString(),
                    modelIdentity: "not supplied by query; unknown",
                    originalResponse: response,
                };
                signal.throwIfAborted();
                await writePrivateEvidence(
                    ownedRoot,
                    dataRoot,
                    [
                        "native-build-response-evidence",
                        policy.value.owner,
                        context.traceId,
                    ],
                    `${context.phase}.json`,
                    JSON.stringify(record),
                    signal,
                );
                phases.set(context.phase, {
                    state: "retained",
                    requestSha256: context.requestSha256,
                });
            },
        },
    };
}

async function writePrivateEvidence(
    ownedRoot: string,
    dataRoot: string,
    parts: string[],
    name: string,
    text: string,
    signal: AbortSignal,
) {
    let directory = dataRoot;
    for (const part of parts) {
        await safePath(ownedRoot, directory);
        directory = path.join(directory, part);
        await mkdir(directory, { mode: 0o700 }).catch(
            (error: NodeJS.ErrnoException) => {
                if (error.code !== "EEXIST") throw error;
            },
        );
        await safePath(ownedRoot, directory);
        requireDiagnostic(
            (await lstat(directory)).isDirectory(),
            "output-directory",
        );
    }
    signal.throwIfAborted();
    const file = await open(path.join(directory, name), "wx", 0o600);
    try {
        await file.writeFile(text, "utf8");
        await file.sync();
    } finally {
        await file.close();
    }
}

function validateGrammarPolicy(
    value: unknown,
    root: string,
    dataRoot: string,
    instanceDir: string,
): asserts value is GrammarPolicy {
    const grammarFields = fields
        .filter(
            (field) => !["maxResponseBytes", "maxResponses"].includes(field),
        )
        .concat("maxArtifactBytes", "maxArtifacts");
    requireDiagnostic(
        isRecord(value) &&
            Object.keys(value).length === grammarFields.length &&
            Object.keys(value).every((field) =>
                grammarFields.includes(field),
            ) &&
            value.kind === nativeSyntheticGrammarDiagnosticContract &&
            value.maxArtifactBytes === cap &&
            value.maxArtifacts === 1,
        "grammar-policy-shape",
    );
    const {
        maxArtifactBytes: _bytes,
        maxArtifacts: _artifacts,
        ...scope
    } = value;
    validatePolicy(
        {
            ...scope,
            kind: syntheticMacroBuildResponsePolicyKind,
            maxResponseBytes: cap,
            maxResponses: 2,
        },
        root,
        dataRoot,
        instanceDir,
    );
}

function createSyntheticMacroGrammarDiagnostics(
    instanceDir: string,
): MacroLearningRuntimeOptions | undefined {
    const policyFile = process.env[grammarFlag];
    if (policyFile === undefined) return undefined;
    const dataRoot = path.dirname(path.dirname(path.resolve(instanceDir)));
    const ownedRoot = path.dirname(dataRoot);
    let reserved:
        | { contextSha256: string; policySha256: string; sourceSha256: string }
        | undefined;
    let retained = false;
    async function verify(context: MacroGrammarContext, signal: AbortSignal) {
        signal.throwIfAborted();
        requireDiagnostic(
            process.env[grammarFlag] === policyFile &&
                path.isAbsolute(policyFile!) &&
                samePath(
                    policyFile!,
                    path.join(dataRoot, "native-grammar-policy.json"),
                ),
            "grammar-policy-location",
        );
        const policy = await readOwned(ownedRoot, policyFile!, 32768);
        validateGrammarPolicy(policy.value, ownedRoot, dataRoot, instanceDir);
        const admission = await readOwned(
            ownedRoot,
            path.join(dataRoot, "native-control-admission.json"),
            65536,
        );
        requireDiagnostic(
            isRecord(admission.value) &&
                admission.value.owner === policy.value.owner &&
                samePath(admission.value.ownedRoot, ownedRoot) &&
                admission.value.configPath === policy.value.configPath &&
                admission.value.nativeSyntheticOriginals === true,
            "owner-admission",
        );
        requireDiagnostic(
            /^[a-zA-Z0-9_-]{1,80}$/.test(context.macro.sourceTraceId) &&
                context.requests.length >= 1 &&
                context.requests.length <= 6 &&
                context.requests.includes(policy.value.expectedPrompt) &&
                context.actionName === getMacroActionName(context.macro) &&
                context.macro.state === "approved" &&
                !context.macro.inputs.some((input) => input.secret),
            "grammar-context",
        );
        const source = await readOwned(
            ownedRoot,
            path.join(
                instanceDir,
                "copilot-macros",
                "traces",
                `${context.macro.sourceTraceId}.json`,
            ),
            1048576,
        );
        validateTrace(
            context.macro,
            context.macro.sourceTraceId,
            source.value,
            policy.value,
            policy.modifiedAt,
        );
        signal.throwIfAborted();
        return {
            policy: { ...policy, value: policy.value },
            source,
            contextSha256: hash(JSON.stringify(context)),
        };
    }
    return {
        grammarEvidence: {
            async assertSource(context, signal) {
                const verified = await verify(context, signal);
                requireDiagnostic(
                    !reserved && !retained,
                    "grammar-artifact-budget",
                );
                reserved = {
                    contextSha256: verified.contextSha256,
                    policySha256: verified.policy.sha256,
                    sourceSha256: verified.source.sha256,
                };
            },
            async retainResult(
                context,
                evidence: MacroGrammarEvidence,
                signal,
            ) {
                const verified = await verify(context, signal);
                requireDiagnostic(
                    reserved &&
                        !retained &&
                        reserved.contextSha256 === verified.contextSha256 &&
                        reserved.policySha256 === verified.policy.sha256 &&
                        reserved.sourceSha256 === verified.source.sha256 &&
                        isDeepStrictEqual(
                            evidence.tuple.requests,
                            context.requests,
                        ) &&
                        isDeepStrictEqual(
                            evidence.tuple.exampleInputs,
                            context.exampleInputs,
                        ) &&
                        evidence.tuple.actionName === context.actionName,
                    "grammar-artifact-budget",
                );
                const record = {
                    schemaVersion: 1,
                    kind: "native-synthetic-grammar-evidence-v1",
                    admission: false,
                    sensitive: true,
                    owner: verified.policy.value.owner,
                    traceId: context.macro.sourceTraceId,
                    sessionId: verified.policy.value.expectedSessionId,
                    macroId: context.macro.macroId,
                    version: context.macro.version,
                    sourceTraceSha256: verified.source.sha256,
                    policySha256: verified.policy.sha256,
                    contextSha256: verified.contextSha256,
                    capturedAt: new Date().toISOString(),
                    stage: "macro-grammar-validation",
                    catalogValidation: "not included",
                    modelIdentity: "not supplied by query; unknown",
                    ...evidence,
                    observations: evidence.observations.map((observation) => {
                        const nonJsonValues: {
                            path: (string | number)[];
                            type: string;
                        }[] = [];
                        return {
                            ...observation,
                            matches: observation.matches.map((match, index) =>
                                encodeGrammarMatch(
                                    match,
                                    [index],
                                    nonJsonValues,
                                    new Set(),
                                ),
                            ),
                            nonJsonValues,
                        };
                    }),
                };
                const text = grammarEvidenceJson(record);
                requireDiagnostic(
                    Buffer.byteLength(text, "utf8") <= cap,
                    "grammar-artifact-size",
                );
                await writePrivateEvidence(
                    ownedRoot,
                    dataRoot,
                    [
                        "native-grammar-evidence",
                        verified.policy.value.owner,
                        context.macro.sourceTraceId,
                    ],
                    "grammar.json",
                    text,
                    signal,
                );
                retained = true;
            },
        },
    };
}

export function createSyntheticMacroLearningDiagnostics(
    instanceDir: string,
): MacroLearningRuntimeOptions | undefined {
    const build = createSyntheticMacroBuildDiagnostics(instanceDir);
    const grammar = createSyntheticMacroGrammarDiagnostics(instanceDir);
    return build || grammar ? { ...build, ...grammar } : undefined;
}

function grammarEvidenceJson(value: unknown): string {
    try {
        return JSON.stringify(value, (_key, entry: unknown) => {
            requireDiagnostic(
                entry !== undefined &&
                    !["function", "symbol", "bigint"].includes(typeof entry) &&
                    !(typeof entry === "number" && !Number.isFinite(entry)),
                "grammar-artifact-encoding",
            );
            return entry;
        });
    } catch {
        throw new Error(
            "Synthetic grammar diagnostics rejected: grammar-artifact-encoding.",
        );
    }
}

function encodeGrammarMatch(
    value: unknown,
    location: (string | number)[],
    nonJsonValues: { path: (string | number)[]; type: string }[],
    ancestors: Set<object>,
): unknown {
    if (
        value === undefined ||
        (typeof value === "number" && !Number.isFinite(value))
    ) {
        nonJsonValues.push({
            path: location,
            type: value === undefined ? "undefined" : String(value),
        });
        return null;
    }
    if (typeof value !== "object" || value === null) return value;
    requireDiagnostic(
        Array.isArray(value) ||
            Object.getPrototypeOf(value) === Object.prototype ||
            Object.getPrototypeOf(value) === null,
        "grammar-match-object",
    );
    requireDiagnostic(!ancestors.has(value), "grammar-artifact-cycle");
    ancestors.add(value);
    try {
        return Array.isArray(value)
            ? value.map((entry: unknown, index) =>
                  encodeGrammarMatch(
                      entry,
                      [...location, index],
                      nonJsonValues,
                      ancestors,
                  ),
              )
            : Object.fromEntries(
                  Object.entries(value).map(([key, entry]) => [
                      key,
                      encodeGrammarMatch(
                          entry,
                          [...location, key],
                          nonJsonValues,
                          ancestors,
                      ),
                  ]),
              );
    } finally {
        ancestors.delete(value);
    }
}
