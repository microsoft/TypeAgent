// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CopilotClient,
    RuntimeConnection,
    approveAll,
    type SessionConfig,
} from "@github/copilot-sdk";
import { execSync } from "node:child_process";
import registerDebug from "debug";
import { ChatModelWithStreaming, CompletionSettings } from "./models.js";
import {
    CopilotApiSettings,
    copilotApiSettingsFromConfig,
    COPILOT_FALLBACK_MODEL,
} from "./copilotSettings.js";
import {
    CopilotEndpoint,
    CopilotEndpointProvider,
    CopilotEndpointUnavailableError,
    createCopilotDirectChatModel,
} from "./copilotDirectTransport.js";

const debug = registerDebug("typeagent:aiclient:copilot");
// Per-phase latency breakdown (client start / session create / send / total)
// and real model time vs. SDK/session overhead. Enable with
// DEBUG=typeagent:aiclient:copilot:timing.
const debugTiming = registerDebug("typeagent:aiclient:copilot:timing");

type CopilotSdkLogLevel =
    | "none"
    | "error"
    | "warning"
    | "info"
    | "debug"
    | "all";

// Optional passthrough to the SDK's own stderr timing logs. Set
// TYPEAGENT_COPILOT_SDK_LOG_LEVEL=debug (or all) to surface CLI-side timing.
function sdkLogLevel(): CopilotSdkLogLevel | undefined {
    const v = process.env.TYPEAGENT_COPILOT_SDK_LOG_LEVEL?.trim().toLowerCase();
    const valid = ["none", "error", "warning", "info", "debug", "all"];
    return v && valid.includes(v) ? (v as CopilotSdkLogLevel) : undefined;
}

// Replaces the Copilot CLI's default "terminal coding assistant" system
// prompt. In "append" mode the runtime still ships its full base persona
// (identity, environment context, code-change rules, tool guidelines) ahead
// of the caller's content; "replace" returns only this string, so the model
// is framed as a translation backend driven entirely by the user turn (which
// already carries TypeChat's schema and instructions).
const TRANSLATION_SYSTEM_PROMPT =
    "You are a translation engine. Follow the instructions in the user message exactly and respond only with the requested output. Do not add commentary, explanations, or formatting beyond what is asked.";

let cachedClient: CopilotClient | undefined;
let startPromise: Promise<CopilotClient> | undefined;
let cachedCliPath: string | undefined;
let cachedCliUrl: string | undefined;
let exitHandlerInstalled = false;

export interface CopilotClientOptions {
    /** Path to the copilot CLI binary. Ignored when `cliUrl` is set. */
    cliPath?: string | undefined;
    /**
     * URL of an already-running Copilot CLI server ("host:port"). When set,
     * the SDK connects over TCP instead of spawning a CLI child, avoiding
     * process startup latency. Mutually exclusive with `cliPath`.
     */
    cliUrl?: string | undefined;
}

function findCopilotPath(): string {
    try {
        const isWindows = process.platform === "win32";
        const command = isWindows ? "where copilot" : "which copilot";
        const result = execSync(command, { encoding: "utf8" }).trim();
        const first = result.split("\n")[0].trim();
        debug(`Found copilot CLI at: ${first}`);
        return first;
    } catch {
        debug("Could not find copilot CLI in PATH, falling back to 'copilot'");
        return "copilot";
    }
}

async function getClient(
    options?: CopilotClientOptions,
): Promise<CopilotClient> {
    if (cachedClient) return cachedClient;
    if (startPromise) return startPromise;

    const cliUrl = options?.cliUrl ?? cachedCliUrl;
    cachedCliUrl = cliUrl;
    // When connecting to an external CLI server, cliPath is ignored (the two
    // are mutually exclusive in the SDK).
    const cliPath = cliUrl
        ? undefined
        : (options?.cliPath ?? cachedCliPath ?? findCopilotPath());
    cachedCliPath = cliPath;

    startPromise = (async () => {
        const target = cliUrl ? `server ${cliUrl}` : `CLI ${cliPath}`;
        debug(`Starting CopilotClient (${target})`);
        const tStart = Date.now();
        const level = sdkLogLevel();
        const client = new CopilotClient({
            connection: cliUrl
                ? RuntimeConnection.forUri(cliUrl)
                : RuntimeConnection.forStdio(cliPath ? { path: cliPath } : {}),
            ...(level ? { logLevel: level } : {}),
        });
        try {
            await client.start();
        } catch (err) {
            startPromise = undefined;
            throw new Error(
                `Failed to start GitHub Copilot CLI client (${target}). ` +
                    (cliUrl
                        ? `Ensure a Copilot CLI server is running and reachable at '${cliUrl}'.\n`
                        : `Ensure 'copilot' is installed and authenticated (try 'copilot auth login').\n`) +
                    `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        debugTiming(`client.start ${Date.now() - tStart}ms`);
        cachedClient = client;
        if (!exitHandlerInstalled) {
            exitHandlerInstalled = true;
            process.on("exit", () => {
                cachedClient?.stop().catch(() => {});
            });
        }
        return client;
    })();
    return startPromise;
}

/**
 * Public accessor for callers that want to talk to the Copilot CLI
 * directly (auth status, model listing, reasoning loop). Shares the
 * same process-wide singleton used by the chat adapter so we don't
 * spawn two CLI children.
 */
export async function getCopilotClient(
    options?: CopilotClientOptions | string,
): Promise<CopilotClient> {
    return getClient(
        typeof options === "string" ? { cliPath: options } : options,
    );
}

/**
 * Eagerly start (or connect to) the Copilot CLI so the first user-visible
 * request doesn't pay the one-time spawn/startup cost (measured at several
 * seconds cold). Safe to call multiple times — it reuses the singleton and
 * swallows errors (a failed pre-warm just means the first real request will
 * retry and surface the error normally).
 */
export async function warmupCopilotClient(
    options?: CopilotClientOptions,
    sessionConfig?: SessionConfig,
): Promise<void> {
    let client: CopilotClient;
    try {
        client = await getClient(options);
        debug("Copilot client pre-warmed");
    } catch (err) {
        debug(
            `Copilot client pre-warm failed (will retry on first request): ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
        return;
    }
    // Warm the CLI-side session subsystem with a throwaway session so the
    // first real request doesn't pay the cold createSession cost (~1s+ on the
    // first session of a process). Best-effort: session creation is auth-free
    // (only sendAndWait needs auth), so this succeeds even when unauthenticated
    // or pointed at an external server.
    if (sessionConfig) {
        try {
            const t = Date.now();
            const session = await client.createSession(sessionConfig);
            await session.disconnect().catch(() => {});
            debugTiming(`warm session ${Date.now() - t}ms`);
            debug("Copilot session subsystem pre-warmed");
        } catch (err) {
            debug(
                `Copilot session pre-warm skipped: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }
    }
}

/**
 * Pre-warm the Copilot client and session subsystem using the values from the
 * active runtime config. Called at host startup (from runtimeConfig) when the
 * provider is Copilot so the first user request avoids both the CLI spawn and
 * the cold session-creation cost.
 */
export async function warmupCopilotFromConfig(): Promise<void> {
    const settings = copilotApiSettingsFromConfig();
    await warmupCopilotClient(
        { cliPath: settings.cliPath, cliUrl: settings.cliUrl },
        buildSessionConfig(settings, {}, false),
    );
    // Prime the model-capability cache so the first real request doesn't pay
    // the one-time listModels cost on the hot path.
    try {
        const client = await getClient({
            cliPath: settings.cliPath,
            cliUrl: settings.cliUrl,
        });
        await ensureModelList(client);
    } catch {}
    // Pre-mint the direct-CAPI endpoint here (same place we warm the
    // CLI/session) so the first real request skips the getEndpoint round-trip.
    // Best-effort: on failure the request path mints it on demand.
    try {
        const t = Date.now();
        await createCopilotEndpointProvider(settings).getEndpoint();
        debugTiming(`warm endpoint ${Date.now() - t}ms`);
        debug("Copilot direct endpoint pre-warmed");
    } catch (err) {
        debug(
            `Copilot endpoint pre-warm skipped: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
    }
}

// Cached per-model capability info, populated from client.listModels() once per
// process. Used to (a) fall back to an available model when the configured one
// isn't offered by the tenant, and (b) decide reasoningEffort (invalid for
// non-reasoning models; forced to minimal for reasoning models on translation).
const reasoningSupportCache = new Map<string, boolean>();
let modelListPromise: Promise<void> | undefined;

async function ensureModelList(client: CopilotClient): Promise<void> {
    if (modelListPromise === undefined) {
        modelListPromise = (async () => {
            try {
                const models = await client.listModels();
                for (const m of models) {
                    reasoningSupportCache.set(
                        m.id,
                        m.capabilities?.supports?.reasoningEffort === true,
                    );
                }
            } catch (err) {
                debug(
                    `listModels failed; model capabilities unknown: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        })();
    }
    await modelListPromise;
}

// Resolve the model to actually use for a session, falling back to
// COPILOT_FALLBACK_MODEL when the requested model isn't offered by the tenant,
// and reporting whether that model supports reasoning effort. When the model
// list is unavailable (e.g. listModels failed), the requested model is used
// as-is and reasoning support is left unknown.
async function resolveModel(
    client: CopilotClient,
    requested: string,
): Promise<{ model: string; reasoningSupported: boolean | undefined }> {
    await ensureModelList(client);
    if (reasoningSupportCache.size === 0) {
        return { model: requested, reasoningSupported: undefined };
    }
    if (reasoningSupportCache.has(requested)) {
        return {
            model: requested,
            reasoningSupported: reasoningSupportCache.get(requested),
        };
    }
    debug(
        `model "${requested}" not available in this tenant; ` +
            `falling back to "${COPILOT_FALLBACK_MODEL}"`,
    );
    return {
        model: COPILOT_FALLBACK_MODEL,
        reasoningSupported:
            reasoningSupportCache.get(COPILOT_FALLBACK_MODEL) ?? false,
    };
}

function buildSessionConfig(
    settings: CopilotApiSettings,
    completionSettings: CompletionSettings,
    streaming: boolean,
    resolved?: { model: string; reasoningSupported: boolean | undefined },
): SessionConfig {
    const modelName = resolved?.model ?? settings.modelName;
    const reasoningSupported = resolved?.reasoningSupported;
    const explicitEffort =
        (completionSettings.reasoning_effort as
            | "low"
            | "medium"
            | "high"
            | "xhigh"
            | undefined) ?? settings.reasoningEffort;
    // Simple translation calls don't benefit from model-side "thinking" and it
    // adds significant latency, so we disable it wherever possible:
    //  - Non-reasoning models (e.g. claude-haiku-4.5): never send reasoningEffort.
    //    The SDK/CLI rejects it for models where capabilities.supports.reasoningEffort
    //    is false, and these models don't think anyway.
    //  - Reasoning-capable models with no explicit override: force the lowest
    //    effort ("low") to minimize thinking latency for translation.
    //  - Explicit per-call/config override always wins for reasoning models.
    let reasoningEffort: "low" | "medium" | "high" | "xhigh" | undefined;
    if (reasoningSupported === false) {
        reasoningEffort = undefined;
    } else if (explicitEffort !== undefined) {
        reasoningEffort = explicitEffort;
    } else if (reasoningSupported === true) {
        reasoningEffort = "low";
    } else {
        // Capability unknown (e.g. during warmup): fall back to explicit only.
        reasoningEffort = explicitEffort;
    }
    const config: SessionConfig = {
        clientName: "TypeAgent",
        model: modelName,
        streaming,
        tools: [],
        availableTools: [],
        systemMessage: { mode: "replace", content: TRANSLATION_SYSTEM_PROMPT },
        onPermissionRequest: approveAll,
        ...(settings.disableInfiniteSessions
            ? { infiniteSessions: { enabled: false } }
            : {}),
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    };
    return config;
}

// Structural subset of the SDK's `ProviderEndpoint` (not exported from the
// package root) — only the fields the direct transport consumes.
type SdkProviderEndpoint = {
    baseUrl: string;
    apiKey?: string | undefined;
    headers?: { [k: string]: string | undefined } | undefined;
    sessionToken?:
        | { token: string; header: string; expiresAt?: string | undefined }
        | undefined;
};

// Refresh a little before the real expiry to avoid racing a 401.
const ENDPOINT_EXPIRY_SKEW_MS = 60_000;

// Process-wide endpoint cache + in-flight coalescing, keyed by requested model
// so the warmup path and the request path share a single acquisition.
const endpointCache = new Map<string, CopilotEndpoint>();
const endpointInflight = new Map<string, Promise<CopilotEndpoint>>();

function endpointExpired(ep: CopilotEndpoint): boolean {
    return (
        ep.expiresAt !== undefined &&
        Date.now() >= ep.expiresAt - ENDPOINT_EXPIRY_SKEW_MS
    );
}

function mapEndpoint(ep: SdkProviderEndpoint, model: string): CopilotEndpoint {
    const base = ep.baseUrl.replace(/\/+$/, "");
    const url = `${base}/chat/completions`;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(ep.headers ?? {})) {
        if (v !== undefined) headers[k] = v;
    }
    if (
        ep.apiKey &&
        headers.Authorization === undefined &&
        headers.authorization === undefined
    ) {
        headers.Authorization = ["Bearer", ep.apiKey].join(" ");
    }
    let expiresAt: number | undefined;
    if (ep.sessionToken) {
        headers[ep.sessionToken.header] = ep.sessionToken.token;
        if (ep.sessionToken.expiresAt) {
            const ms = Date.parse(ep.sessionToken.expiresAt);
            if (!Number.isNaN(ms)) expiresAt = ms;
        }
    }
    return { url, model, headers, expiresAt };
}

// Acquire a fresh endpoint snapshot through a short-lived SDK session. Passing a
// concrete `modelId` binds the endpoint to that model; when the requested model
// isn't offered by the tenant (resolveModel falls back to "auto"), we throw
// `CopilotEndpointUnavailableError` rather than dealing with an auto-bound
// session token.
async function acquireEndpoint(
    settings: CopilotApiSettings,
): Promise<CopilotEndpoint> {
    // Defensive: the gate is normally set in copilotApiSettingsFromConfig, but
    // set it here too in case this settings object came from elsewhere. Note it
    // only takes effect if set before the CLI child is spawned.
    if (!process.env.COPILOT_ALLOW_GET_PROVIDER_ENDPOINT) {
        process.env.COPILOT_ALLOW_GET_PROVIDER_ENDPOINT = "true";
    }
    const client = await getClient({
        cliPath: settings.cliPath,
        cliUrl: settings.cliUrl,
    });
    const resolved = await resolveModel(client, settings.modelName);
    if (resolved.model === COPILOT_FALLBACK_MODEL) {
        throw new CopilotEndpointUnavailableError(
            `Model "${settings.modelName}" is not available in this tenant; ` +
                `direct transport requires a concrete model.`,
        );
    }
    const tCreate = Date.now();
    const session = await client.createSession(
        buildSessionConfig(settings, {}, false, resolved),
    );
    try {
        const tGet = Date.now();
        const ep = (await session.rpc.provider.getEndpoint({
            modelId: resolved.model,
        })) as SdkProviderEndpoint;
        debugTiming(
            `getEndpoint session ${tGet - tCreate}ms get ${Date.now() - tGet}ms`,
        );
        return mapEndpoint(ep, resolved.model);
    } finally {
        session.disconnect().catch(() => {});
    }
}

/**
 * Create an endpoint provider for the direct-CAPI transport. Backed by a
 * process-wide cache keyed by model, so repeated models (and warmup) reuse one
 * acquisition. Refreshes are coalesced.
 */
export function createCopilotEndpointProvider(
    settings: CopilotApiSettings,
): CopilotEndpointProvider {
    const key = settings.modelName;
    return {
        async getEndpoint(force = false): Promise<CopilotEndpoint> {
            if (force) {
                endpointCache.delete(key);
            } else {
                const cached = endpointCache.get(key);
                if (cached && !endpointExpired(cached)) {
                    return cached;
                }
            }
            let inflight = endpointInflight.get(key);
            if (inflight === undefined) {
                inflight = acquireEndpoint(settings)
                    .then((ep) => {
                        endpointCache.set(key, ep);
                        return ep;
                    })
                    .finally(() => {
                        endpointInflight.delete(key);
                    });
                endpointInflight.set(key, inflight);
            }
            return inflight;
        },
    };
}

export function createCopilotChatModel(
    settings: CopilotApiSettings,
    completionSettings?: CompletionSettings,
    completionCallback?: (request: any, response: any) => void,
    tags?: string[],
): ChatModelWithStreaming {
    // The Copilot provider uses the direct-CAPI transport exclusively: the SDK
    // is used only to mint a provider endpoint, then translation requests are
    // issued as plain HTTP chat/completions calls.
    const endpointProvider = createCopilotEndpointProvider(settings);
    return createCopilotDirectChatModel(
        settings,
        completionSettings,
        completionCallback,
        tags,
        endpointProvider,
    );
}
