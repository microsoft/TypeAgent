// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Generated-agent translator for TypeAgent Studio's "Try it" affordance (t4 —
 * prove the generated agent answers an utterance).
 *
 * After a generated agent is scaffolded, built, and installed (t3), the wizard
 * lets the user try one of the example phrases produced at PhraseGen. This
 * module stands up a dispatcher that loads ONLY the generated agent (by its
 * on-disk path) and TRANSLATES an utterance WITHOUT executing it — resolving
 * the phrase to one of the agent's typed actions is sufficient proof the agent
 * "answers" it, and translate-only avoids a real API call / side effect.
 *
 * It lives in `default-agent-provider` for the same reason as
 * {@link ./onboardingDispatcher}: this package already depends on
 * `agent-dispatcher` and `dispatcher-node-providers`, and the Studio service
 * reaches it through the same lazy external dynamic import, so no new
 * dependency or build cycle is introduced.
 *
 * ## How the resolved action is captured
 * There is no structured "translate-only" dispatcher API that returns the
 * resolved action; the built-in `@dispatcher translate <utterance>` command
 * translates without executing but only *displays* the result (see
 * `TranslateCommandHandler`), emitting `…\n\nJSON:\n<actions>` where `<actions>`
 * is `JSON.stringify(requestAction.actions)` — an `ExecutableAction[]`, each
 * shaped `{ action: { schemaName, actionName, parameters? } }`. So we install a
 * capturing `ClientIO` (overriding `setDisplay`/`appendDisplay`), run the
 * command, and parse the `JSON:` block. Safety is enforced structurally:
 * `agents: { actions: false, commands: ["dispatcher"] }` guarantees no agent's
 * `executeAction` runs — exactly the translate-only posture used by the sibling
 * collision translation runner.
 */

import { awaitCommand, createDispatcher } from "agent-dispatcher";
import type { Dispatcher } from "agent-dispatcher";
import { createNpmAppAgentProvider } from "dispatcher-node-providers";
import { silentClientIO } from "./collisions/silentClientIO.js";
import { ensureServiceKeysLoaded } from "./serviceKeys.js";

/** One action the translator resolved an utterance to (no execution). */
export interface GeneratedAgentResolvedAction {
    schemaName?: string;
    actionName?: string;
}

/** Plain-data outcome of translating one utterance. */
export interface GeneratedAgentTranslateResult {
    /** Actions the translator resolved the utterance to (may be empty). */
    actions: GeneratedAgentResolvedAction[];
    /** Set when translation produced no action or the command errored. */
    error?: string;
}

export interface GeneratedAgentTranslatorHandle {
    /**
     * Translate a natural-language utterance against the generated agent,
     * returning the resolved typed action(s) WITHOUT executing them.
     */
    translateUtterance(text: string): Promise<GeneratedAgentTranslateResult>;
    /** Tear down the underlying dispatcher. */
    close(): Promise<void>;
}

export interface GeneratedAgentTranslatorOptions {
    /** The generated agent's name; also the dispatcher schema name. */
    agentName: string;
    /**
     * Absolute path to the generated agent's package directory (the scaffolded
     * dir, containing its `package.json` + built manifest/schema). The agent
     * must be built by "Try it" time — the install flow builds it.
     */
    agentDir: string;
    /** Host name for the dispatcher (telemetry/logging only). */
    hostName?: string;
}

/**
 * The dispatcher's display callbacks receive either a bare string or a
 * `{ content }` envelope whose `content` is a string or string[]. Extract the
 * visible text from either shape.
 */
function extractDisplayText(msg: unknown): string {
    if (typeof msg === "string") {
        return msg;
    }
    if (msg === null || typeof msg !== "object") {
        return "";
    }
    const content = (msg as { content?: unknown }).content;
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map((c) => (typeof c === "string" ? c : ""))
            .filter(Boolean)
            .join("\n");
    }
    return "";
}

/**
 * Parse the `JSON:\n<actions>` block emitted by `@dispatcher translate`. Each
 * element is an `ExecutableAction` (`{ action: { schemaName, actionName } }`);
 * we tolerate a bare `{ schemaName, actionName }` shape too, in case the
 * display format changes. Returns an empty array when no JSON block is present.
 */
function parseTranslatedActions(
    displayText: string,
): GeneratedAgentResolvedAction[] {
    const marker = "JSON:\n";
    const idx = displayText.lastIndexOf(marker);
    if (idx < 0) {
        return [];
    }
    const jsonPart = displayText.slice(idx + marker.length).trim();
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonPart);
    } catch {
        return [];
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const out: GeneratedAgentResolvedAction[] = [];
    for (const element of arr) {
        const container = element as { action?: unknown };
        const action = (
            container?.action !== undefined ? container.action : element
        ) as { schemaName?: unknown; actionName?: unknown };
        const resolved: GeneratedAgentResolvedAction = {};
        if (typeof action?.schemaName === "string") {
            resolved.schemaName = action.schemaName;
        }
        if (typeof action?.actionName === "string") {
            resolved.actionName = action.actionName;
        }
        out.push(resolved);
    }
    return out;
}

/**
 * Build a translate-only dispatcher loaded with a single generated agent and
 * return a plain-data handle over it. Translation is enabled; action execution,
 * cache, and explanation are all off, so a translated utterance never runs.
 */
export async function createGeneratedAgentTranslator(
    options: GeneratedAgentTranslatorOptions,
): Promise<GeneratedAgentTranslatorHandle> {
    // Ensure LLM keys are in process.env before the dispatcher builds any LLM
    // client (the translator needs them).
    ensureServiceKeysLoaded();

    const provider = createNpmAppAgentProvider(
        {
            [options.agentName]: {
                name: options.agentName,
                path: options.agentDir,
                execMode: "dispatcher",
            },
        },
        import.meta.url,
    );

    // Accumulates everything the dispatcher displays for the current command;
    // reset before each translate call.
    let captured = "";
    const capture = (msg: unknown) => {
        const text = extractDisplayText(msg);
        if (text) {
            captured += `${text}\n`;
        }
    };

    const dispatcher: Dispatcher = await createDispatcher(
        options.hostName ?? "studio-tryit",
        {
            appAgentProviders: [provider],
            // Translate-only posture: no agent's executeAction runs, but the
            // built-in `dispatcher` commands (incl. `translate`) stay available.
            agents: { actions: false, commands: ["dispatcher"] },
            persistSession: false,
            translation: { enabled: true },
            explainer: { enabled: false },
            cache: { enabled: false },
            clientIO: silentClientIO({
                setDisplay: capture,
                appendDisplay: capture,
            }),
            metrics: false,
        },
    );

    return {
        async translateUtterance(text) {
            captured = "";
            let commandError: string | undefined;
            try {
                // `request` uses implicitQuotes, so the rest of the line is the
                // utterance verbatim — no quoting needed.
                const result = await awaitCommand(
                    dispatcher,
                    `@dispatcher translate ${text}`,
                );
                if (result?.lastError !== undefined) {
                    commandError = result.lastError;
                }
            } catch (e) {
                commandError = (e as Error).message;
            }
            const actions = parseTranslatedActions(captured);
            if (actions.length === 0) {
                return {
                    actions: [],
                    error:
                        commandError ??
                        "No action was resolved for the utterance.",
                };
            }
            return {
                actions,
                ...(commandError !== undefined ? { error: commandError } : {}),
            };
        },
        async close() {
            await dispatcher.close();
        },
    };
}
