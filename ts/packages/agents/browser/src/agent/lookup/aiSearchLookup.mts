// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Browser-less internet lookup backed by an Azure AI Search (Foundry IQ)
// knowledge base that references a "web" knowledge source. The knowledge
// base does the search + fetch + LLM summarization server-side, so this
// path works in connect-mode clients (vscode-shell, CLI) that have no
// browser to drive. Two backends are provided so we can compare them:
//   - "api": the REST `retrieve` action on the knowledge base.
//   - "mcp": the knowledge base's MCP endpoint (`knowledge_base_retrieve`).
//
// Setup (web knowledge source + knowledge base) is handled by
// aiSearchSetup.mts / ensureWebKnowledgeBase().

import registerDebug from "debug";
import { createDefaultCredential } from "@typeagent/aiclient";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const debug = registerDebug("typeagent:browser:aisearch");
const debugError = registerDebug("typeagent:browser:aisearch:error");

export type AiSearchLookupMode = "off" | "api" | "mcp";
export type AiSearchOutputMode = "answerSynthesis" | "extractedData";
export type AiSearchReasoningEffort = "minimal" | "low" | "medium";

export type AiSearchConfig = {
    // https://<service>.search.windows.net
    endpoint: string;
    // Name of the knowledge base that references a web knowledge source.
    knowledgeBase: string;
    apiVersion: string;
    // Auth: defaults to identity (DefaultAzureCredential). An explicit bearer
    // token or admin/query key overrides it.
    apiKey?: string | undefined;
    bearerToken?: string | undefined;
    mode: AiSearchLookupMode;
    outputMode: AiSearchOutputMode;
    reasoningEffort: AiSearchReasoningEffort;
};

export type AiSearchReference = {
    // Reference id the synthesized answer cites as [ref_id:<id>].
    id?: string | undefined;
    title?: string | undefined;
    url?: string | undefined;
};

export type AiSearchLookupResult = {
    backend: "api" | "mcp";
    answer: string;
    references: AiSearchReference[];
    elapsedMs: number;
    // Raw activity/query-plan payload (API backend only), useful for debugging.
    activity?: unknown;
};

const DEFAULT_API_VERSION = "2026-05-01-preview";

// The KB does the retrieval; these instructions steer the synthesized answer.
const SYSTEM_INSTRUCTIONS =
    "You are a research assistant. Use the web knowledge source to answer the " +
    "user's question as accurately and concisely as possible, citing sources. " +
    "If you cannot find an answer, respond with 'No answer found.'";

function env(name: string): string | undefined {
    const v = process.env[name];
    return v !== undefined && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * The configured lookup mode from env / config (azureAISearch.mode). Defaults
 * to "off" (browser) when unset.
 */
export function getConfiguredLookupMode(): AiSearchLookupMode {
    return (env("AZURE_AI_SEARCH_LOOKUP_MODE") ?? "off") as AiSearchLookupMode;
}

/**
 * Reads Azure AI Search lookup config from the environment. `modeOverride`
 * (from `@browser lookup ...`) takes precedence over the configured mode.
 * Returns undefined when the effective mode is not api/mcp or required
 * settings are missing, so callers fall back to the browser-driven lookup.
 */
export function getAiSearchConfigFromEnv(
    modeOverride?: AiSearchLookupMode,
): AiSearchConfig | undefined {
    const mode = modeOverride ?? getConfiguredLookupMode();
    if (mode !== "api" && mode !== "mcp") {
        return undefined;
    }

    const endpoint = env("AZURE_AI_SEARCH_ENDPOINT");
    const knowledgeBase = env("AZURE_AI_SEARCH_KNOWLEDGE_BASE");
    const apiKey = env("AZURE_AI_SEARCH_API_KEY");
    const bearerToken = env("AZURE_AI_SEARCH_BEARER_TOKEN");

    if (!endpoint || !knowledgeBase) {
        debug(
            "Azure AI Search lookup mode is '%s' but config is incomplete (need endpoint and knowledge base) - falling back to browser",
            mode,
        );
        return undefined;
    }

    const outputMode = (env("AZURE_AI_SEARCH_OUTPUT_MODE") ??
        "answerSynthesis") as AiSearchOutputMode;
    const reasoningEffort = (env("AZURE_AI_SEARCH_REASONING_EFFORT") ??
        "low") as AiSearchReasoningEffort;

    return {
        endpoint,
        knowledgeBase,
        apiVersion: env("AZURE_AI_SEARCH_API_VERSION") ?? DEFAULT_API_VERSION,
        apiKey,
        bearerToken,
        mode,
        outputMode,
        reasoningEffort,
    };
}

function baseUrl(endpoint: string): string {
    return endpoint.replace(/\/+$/, "");
}

// Azure Search data-plane scope for Entra ID (identity) auth.
const AZURE_SEARCH_SCOPE = "https://search.azure.com/.default";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

let searchCredential: ReturnType<typeof createDefaultCredential> | undefined;
let cachedToken: { token: string; expiresOnTimestamp: number } | undefined;

// Acquire (and cache) an Entra ID token for the Azure Search data plane via
// DefaultAzureCredential - the same identity path the rest of TypeAgent uses
// (createDefaultCredential). Refreshed a few minutes before expiry.
async function getIdentityToken(): Promise<string> {
    if (
        cachedToken &&
        cachedToken.expiresOnTimestamp - TOKEN_REFRESH_BUFFER_MS > Date.now()
    ) {
        return cachedToken.token;
    }
    searchCredential ??= createDefaultCredential();
    const token = await searchCredential.getToken(AZURE_SEARCH_SCOPE);
    if (!token) {
        throw new Error(
            "Failed to acquire an Azure Search token via DefaultAzureCredential",
        );
    }
    cachedToken = {
        token: token.token,
        expiresOnTimestamp: token.expiresOnTimestamp,
    };
    return token.token;
}

// Auth header for the retrieve/MCP call. Identity (DefaultAzureCredential) is
// the default; an explicit bearer token or admin/query key can override it.
async function authHeaders(
    config: AiSearchConfig,
): Promise<Record<string, string>> {
    if (config.bearerToken) {
        return { Authorization: `Bearer ${config.bearerToken}` };
    }
    if (config.apiKey) {
        return { "api-key": config.apiKey };
    }
    return { Authorization: `Bearer ${await getIdentityToken()}` };
}

/**
 * Runs a lookup against the configured knowledge base using the selected
 * backend (REST retrieve action or MCP endpoint).
 */
export async function lookupViaAiSearch(
    config: AiSearchConfig,
    query: string,
): Promise<AiSearchLookupResult> {
    return config.mode === "mcp"
        ? retrieveViaMcp(config, query)
        : retrieveViaApi(config, query);
}

// ---------------------------------------------------------------------------
// REST retrieve action backend
// ---------------------------------------------------------------------------

type RetrieveApiResponse = {
    response?: unknown;
    references?: unknown;
    activity?: unknown;
};

type ApiRef = {
    id?: unknown;
    url?: string;
    title?: string;
    sourceData?: {
        url?: string;
        Url?: string;
        title?: string;
        Title?: string;
    };
};

async function retrieveViaApi(
    config: AiSearchConfig,
    query: string,
): Promise<AiSearchLookupResult> {
    const url =
        `${baseUrl(config.endpoint)}/knowledgebases/` +
        `${encodeURIComponent(config.knowledgeBase)}/retrieve` +
        `?api-version=${encodeURIComponent(config.apiVersion)}`;

    const body = {
        messages: [
            {
                role: "assistant",
                content: [{ type: "text", text: SYSTEM_INSTRUCTIONS }],
            },
            {
                role: "user",
                content: [{ type: "text", text: query }],
            },
        ],
        outputMode: config.outputMode,
        retrievalReasoningEffort: { kind: config.reasoningEffort },
    };

    debug("retrieve (api) %s kb=%s", url, config.knowledgeBase);
    const start = Date.now();
    const response = await fetch(url, {
        method: "POST",
        headers: {
            ...(await authHeaders(config)),
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    // 206 Partial Content means some sources failed but we still got results.
    if (!response.ok && response.status !== 206) {
        const text = await response.text().catch(() => "");
        throw new Error(
            `Azure AI Search retrieve failed: ${response.status} ${response.statusText} - ${text}`,
        );
    }

    const data = (await response.json()) as RetrieveApiResponse;
    const elapsedMs = Date.now() - start;
    const { answer, references } = parseRetrievePayload(
        extractResponseText(data?.response),
        data?.references,
    );
    return {
        backend: "api",
        answer,
        references,
        elapsedMs,
        activity: data?.activity,
    };
}

function extractResponseText(response: unknown): string {
    if (!Array.isArray(response)) {
        return "";
    }
    const parts: string[] = [];
    for (const message of response) {
        const content = (message as { content?: unknown })?.content;
        if (Array.isArray(content)) {
            for (const item of content) {
                if (typeof (item as { text?: unknown })?.text === "string") {
                    parts.push((item as { text: string }).text);
                }
            }
        }
    }
    return parts.join("\n").trim();
}

// ---------------------------------------------------------------------------
// MCP endpoint backend
// ---------------------------------------------------------------------------

async function retrieveViaMcp(
    config: AiSearchConfig,
    query: string,
): Promise<AiSearchLookupResult> {
    const url = new URL(
        `${baseUrl(config.endpoint)}/knowledgebases/` +
            `${encodeURIComponent(config.knowledgeBase)}/mcp` +
            `?api-version=${encodeURIComponent(config.apiVersion)}`,
    );

    const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: await authHeaders(config) },
    });
    const client = new Client({
        name: "typeagent-browser-aisearch",
        version: "1.0.0",
    });

    debug("retrieve (mcp) %s kb=%s", url.toString(), config.knowledgeBase);
    const start = Date.now();
    try {
        // The SDK transport type doesn't satisfy exactOptionalPropertyTypes;
        // cast matches the pattern used by mcpAgentProvider.ts.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await client.connect(transport as any);

        const { tools } = await client.listTools();
        const tool = tools.find((t) => t.name === "knowledge_base_retrieve");
        if (tool === undefined) {
            throw new Error(
                "MCP endpoint does not expose the 'knowledge_base_retrieve' tool",
            );
        }
        debug("mcp tool input schema: %o", tool.inputSchema);

        const result = (await client.callTool({
            name: "knowledge_base_retrieve",
            arguments: buildMcpArguments(tool.inputSchema, query),
        })) as { isError?: boolean; content?: unknown[] };
        const elapsedMs = Date.now() - start;

        if (result?.isError) {
            throw new Error(
                `MCP knowledge_base_retrieve returned an error: ${extractMcpText(result)}`,
            );
        }

        const { answer, references } = parseRetrievePayload(
            extractMcpText(result),
            undefined,
        );
        return { backend: "mcp", answer, references, elapsedMs };
    } finally {
        await client
            .close()
            .catch((e) => debugError("mcp close failed: %o", e));
    }
}

// The MCP tool mirrors the REST retrieve request, but the exact input schema
// can vary by API version. Inspect the advertised schema and pick the shape
// it accepts rather than guessing.
function buildMcpArguments(
    inputSchema:
        | {
              properties?: Record<string, unknown> | undefined;
          }
        | undefined,
    query: string,
): Record<string, unknown> {
    const props = inputSchema?.properties ?? {};
    // Azure AI Search's knowledge_base_retrieve expects a `queries` array of
    // natural-language questions (currently min and max 1).
    if ("queries" in props) {
        return { queries: [query] };
    }
    if ("messages" in props) {
        return {
            messages: [
                { role: "user", content: [{ type: "text", text: query }] },
            ],
        };
    }
    if ("intents" in props) {
        return { intents: [{ type: "semantic", search: query }] };
    }
    if ("query" in props) {
        return { query };
    }
    if ("search" in props) {
        return { search: query };
    }
    // Default to the messages shape used by the retrieve action.
    return {
        messages: [{ role: "user", content: [{ type: "text", text: query }] }],
    };
}

function extractMcpText(
    result: { isError?: boolean; content?: unknown[] } | null | undefined,
): string {
    const content = result?.content;
    if (!Array.isArray(content)) {
        return "";
    }
    const parts: string[] = [];
    for (const item of content) {
        if (typeof (item as { text?: unknown })?.text === "string") {
            parts.push((item as { text: string }).text);
        }
    }
    return parts.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Shared response parsing
// ---------------------------------------------------------------------------

// The retrieve/MCP text is either a synthesized answer (answerSynthesis mode)
// or a JSON-encoded array of grounding chunks (extractedData mode). Detect the
// latter and turn it into a readable answer plus citations.
function parseRetrievePayload(
    text: string,
    references: unknown,
): { answer: string; references: AiSearchReference[] } {
    const refs = extractReferences(references);
    const grounding = tryParseGroundingJson(text);
    if (grounding) {
        const answer = grounding
            .map((chunk) => chunk.content)
            .filter((c): c is string => typeof c === "string" && c.length > 0)
            .join("\n\n");
        for (const chunk of grounding) {
            const url = chunk.url ?? chunk.sourceUrl;
            const title = chunk.title;
            if (url || title) {
                refs.push({ title, url });
            }
        }
        return { answer: answer.trim(), references: dedupeReferences(refs) };
    }
    return { answer: text.trim(), references: dedupeReferences(refs) };
}

type GroundingChunk = {
    content?: string;
    title?: string;
    url?: string;
    sourceUrl?: string;
};

function tryParseGroundingJson(text: string): GroundingChunk[] | undefined {
    const trimmed = text.trim();
    if (!trimmed.startsWith("[")) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(trimmed);
        if (
            Array.isArray(parsed) &&
            parsed.every((item) => typeof item === "object" && item !== null)
        ) {
            return parsed as GroundingChunk[];
        }
    } catch {
        // Not grounding JSON; treat as a synthesized answer.
    }
    return undefined;
}

function extractReferences(references: unknown): AiSearchReference[] {
    if (!Array.isArray(references)) {
        return [];
    }
    const out: AiSearchReference[] = [];
    for (const ref of references) {
        const rawRef = ref as ApiRef;
        const sourceData: NonNullable<ApiRef["sourceData"]> =
            rawRef?.sourceData ?? {};
        const id = rawRef?.id !== undefined ? String(rawRef.id) : undefined;
        const url =
            sourceData.url ?? sourceData.Url ?? rawRef?.url ?? undefined;
        const title =
            sourceData.title ?? sourceData.Title ?? rawRef?.title ?? undefined;
        if (url || title) {
            out.push({ id, title, url });
        }
    }
    return out;
}

function dedupeReferences(refs: AiSearchReference[]): AiSearchReference[] {
    const seen = new Set<string>();
    const out: AiSearchReference[] = [];
    for (const ref of refs) {
        const key = `${ref.url ?? ""}|${ref.title ?? ""}`;
        if (key !== "|" && !seen.has(key)) {
            seen.add(key);
            out.push(ref);
        }
    }
    return out;
}

// Formats the synthesized answer for display: turns the model's inline
// [ref_id:N] citation markers into numbered links to the source URLs and
// appends a Sources list of the cited references. Returns markdown for the
// display plus a clean plain-text version (markers stripped) for history.
export function formatAiSearchAnswer(result: AiSearchLookupResult): {
    markdown: string;
    text: string;
} {
    const byId = new Map<string, AiSearchReference>();
    for (const ref of result.references) {
        if (ref.id !== undefined && ref.url) {
            byId.set(ref.id, ref);
        }
    }

    const citedOrder: string[] = [];
    const seen = new Set<string>();
    const linked = result.answer.replace(
        /\[ref_id:(\d+)\]/g,
        (_match, id: string) => {
            const ref = byId.get(id);
            if (ref === undefined) {
                // No URL for this reference - drop the (unlinkable) marker.
                return "";
            }
            if (!seen.has(id)) {
                seen.add(id);
                citedOrder.push(id);
            }
            return `[[${id}]](${ref.url})`;
        },
    );

    const sources = citedOrder.map((id) => {
        const ref = byId.get(id)!;
        return `- [${id}] [${ref.title ?? ref.url}](${ref.url})`;
    });

    const markdown =
        sources.length > 0
            ? `${linked.trim()}\n\n**Sources**\n\n${sources.join("\n")}`
            : linked.trim();

    // Clean text for conversation history / speech (no citation markers).
    const text = result.answer.replace(/\s*\[ref_id:\d+\]/g, "").trim();
    return { markdown, text };
}
