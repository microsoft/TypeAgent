// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Provisions the Azure AI Search objects needed for the browser-less internet
// lookup prototype: a "web" knowledge source and a knowledge base that
// references it. Both PUTs are idempotent (create-or-update), so this is safe
// to re-run.
//
// Run after building the browser agent:
//   node dist/agent/lookup/aiSearchSetup.mjs
// or via the package script:
//   pnpm --filter browser-typeagent setup:aisearch
//
// Required env (see aiSearchLookup.mts for the query-time settings):
//   AZURE_AI_SEARCH_ENDPOINT            https://<service>.search.windows.net
//   AZURE_AI_SEARCH_KNOWLEDGE_BASE      knowledge base name to create
//   (auth: identity / DefaultAzureCredential by default; set
//    AZURE_AI_SEARCH_API_KEY or AZURE_AI_SEARCH_BEARER_TOKEN to override)
//   AZURE_AI_SEARCH_AOAI_ENDPOINT       https://<aoai>.openai.azure.com
//   AZURE_AI_SEARCH_AOAI_DEPLOYMENT     deployment id (e.g. gpt-4.1-mini)
//   AZURE_AI_SEARCH_AOAI_MODEL          model name (e.g. gpt-4.1-mini)
//   AZURE_AI_SEARCH_AOAI_API_KEY        (optional) Azure OpenAI key; omit to use
//                                       the search service's managed identity
// Optional:
//   AZURE_AI_SEARCH_WEB_KS_NAME         web knowledge source name (default <kb>-web-ks)
//   AZURE_AI_SEARCH_WEB_KS_DOMAINS      comma-separated allowed domains
//   AZURE_AI_SEARCH_API_VERSION         default 2026-05-01-preview

import registerDebug from "debug";
import { createDefaultCredential } from "@typeagent/aiclient";

const debug = registerDebug("typeagent:browser:aisearch:setup");

const DEFAULT_API_VERSION = "2026-05-01-preview";
const AZURE_SEARCH_SCOPE = "https://search.azure.com/.default";

function env(name: string): string | undefined {
    const v = process.env[name];
    return v !== undefined && v.trim().length > 0 ? v.trim() : undefined;
}

function requireEnv(name: string): string {
    const v = env(name);
    if (v === undefined) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return v;
}

function baseUrl(endpoint: string): string {
    return endpoint.replace(/\/+$/, "");
}

// Identity (DefaultAzureCredential) by default; an explicit bearer token or
// admin/query key overrides it.
async function authHeaders(): Promise<Record<string, string>> {
    const bearer = env("AZURE_AI_SEARCH_BEARER_TOKEN");
    if (bearer) {
        return { Authorization: `Bearer ${bearer}` };
    }
    const apiKey = env("AZURE_AI_SEARCH_API_KEY");
    if (apiKey) {
        return { "api-key": apiKey };
    }
    const token = await createDefaultCredential().getToken(AZURE_SEARCH_SCOPE);
    if (!token) {
        throw new Error(
            "Failed to acquire an Azure Search token via DefaultAzureCredential",
        );
    }
    return { Authorization: `Bearer ${token.token}` };
}

type SetupOptions = {
    endpoint: string;
    knowledgeBase: string;
    webKnowledgeSource: string;
    apiVersion: string;
    allowedDomains: string[];
    aoai: {
        endpoint: string;
        deployment: string;
        model: string;
        apiKey?: string | undefined;
    };
};

function setupOptionsFromEnv(): SetupOptions {
    const domains = env("AZURE_AI_SEARCH_WEB_KS_DOMAINS");
    const knowledgeBase = requireEnv("AZURE_AI_SEARCH_KNOWLEDGE_BASE");
    return {
        endpoint: requireEnv("AZURE_AI_SEARCH_ENDPOINT"),
        knowledgeBase,
        webKnowledgeSource:
            env("AZURE_AI_SEARCH_WEB_KS_NAME") ?? `${knowledgeBase}-web-ks`,
        apiVersion: env("AZURE_AI_SEARCH_API_VERSION") ?? DEFAULT_API_VERSION,
        allowedDomains: domains
            ? domains
                  .split(",")
                  .map((d) => d.trim())
                  .filter((d) => d.length > 0)
            : [],
        aoai: {
            endpoint: requireEnv("AZURE_AI_SEARCH_AOAI_ENDPOINT"),
            deployment: requireEnv("AZURE_AI_SEARCH_AOAI_DEPLOYMENT"),
            model: requireEnv("AZURE_AI_SEARCH_AOAI_MODEL"),
            apiKey: env("AZURE_AI_SEARCH_AOAI_API_KEY"),
        },
    };
}

async function putJson(url: string, body: unknown): Promise<void> {
    const response = await fetch(url, {
        method: "PUT",
        headers: {
            ...(await authHeaders()),
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
            `PUT ${url} failed: ${response.status} ${response.statusText} - ${text}`,
        );
    }
}

/**
 * Creates or updates the web knowledge source and the knowledge base that
 * references it. Idempotent.
 */
export async function ensureWebKnowledgeBase(
    options: SetupOptions,
): Promise<void> {
    const root = baseUrl(options.endpoint);

    // A web knowledge source requires an LLM on the knowledge base for
    // summarization, so build the model reference up front.
    const webParameters =
        options.allowedDomains.length > 0
            ? {
                  domains: {
                      allowedDomains: options.allowedDomains.map((address) => ({
                          address,
                          includeSubpages: true,
                      })),
                  },
              }
            : { domains: null };

    const ksUrl =
        `${root}/knowledgesources/${encodeURIComponent(options.webKnowledgeSource)}` +
        `?api-version=${encodeURIComponent(options.apiVersion)}`;
    debug("PUT web knowledge source %s", ksUrl);
    await putJson(ksUrl, {
        name: options.webKnowledgeSource,
        kind: "web",
        description: "Web knowledge source for browser-less internet lookup.",
        webParameters,
    });

    const kbUrl =
        `${root}/knowledgebases/${encodeURIComponent(options.knowledgeBase)}` +
        `?api-version=${encodeURIComponent(options.apiVersion)}`;
    debug("PUT knowledge base %s", kbUrl);
    await putJson(kbUrl, {
        name: options.knowledgeBase,
        description: "Browser-less internet lookup knowledge base.",
        knowledgeSources: [{ name: options.webKnowledgeSource }],
        models: [
            {
                kind: "azureOpenAI",
                azureOpenAIParameters: {
                    resourceUri: options.aoai.endpoint,
                    deploymentId: options.aoai.deployment,
                    modelName: options.aoai.model,
                    ...(options.aoai.apiKey
                        ? { apiKey: options.aoai.apiKey }
                        : {}),
                },
            },
        ],
        outputMode: "answerSynthesis",
        retrievalReasoningEffort: { kind: "low" },
    });
}

async function main(): Promise<void> {
    const options = setupOptionsFromEnv();
    // eslint-disable-next-line no-console
    console.log(
        `Provisioning web knowledge source '${options.webKnowledgeSource}' and knowledge base '${options.knowledgeBase}' on ${options.endpoint} ...`,
    );
    await ensureWebKnowledgeBase(options);
    // eslint-disable-next-line no-console
    console.log(
        "Done. You can now set AZURE_AI_SEARCH_LOOKUP_MODE=api or mcp.",
    );
}

// Run as a script (node dist/agent/lookup/aiSearchSetup.mjs).
main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
