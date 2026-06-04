// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Copilot SDK client host (decision 0010).
 *
 * Owns the `@github/copilot-sdk` `CopilotClient` lifecycle and provides
 * the schema-guided turn driver that `copilot.invoke` builds on.
 *
 * Design notes:
 *   - SDK *types* are imported statically via `import type` so we
 *     never duplicate the SDK's surface to avoid drift. `import type`
 *     is erased at emit and does not trigger module loading.
 *   - SDK *runtime* values (`defineTool`, `approveAll`, `CopilotClient`)
 *     are loaded via dynamic `import("@github/copilot-sdk")` so
 *     consumers who never invoke any `copilot.*` task don't pay the
 *     Copilot CLI runtime install cost.
 *   - The SDK client is a lazy module-singleton: started on first call,
 *     disposed on engine shutdown.
 *   - `invokeCopilotAgent(...)` implements the §4 turn loop from
 *     decision 0010: register `submit_response` whose parameters are
 *     the node's declared `outputSchema`, run the agent in an
 *     ephemeral session, capture the validated arguments, and repair on
 *     failure within a bounded budget.
 *   - For tests, `setCopilotClientFactory` swaps in a mock client.
 */

import AjvModule from "ajv";
import Debug from "debug";
import type { JSONSchema } from "workflow-model";
import type {
    CopilotClient,
    CopilotSession,
    CustomAgentConfig,
    MessageOptions,
    SessionConfig,
} from "@github/copilot-sdk";

const debug = Debug("typeagent:workflow:copilot");

/** Maximum length, in characters, that we log via debug(). */
const DEBUG_TRUNCATE_LEN = 800;

function truncateForDebug(s: string): string {
    if (s.length <= DEBUG_TRUNCATE_LEN) return s;
    return `${s.slice(0, DEBUG_TRUNCATE_LEN)}…[truncated ${s.length - DEBUG_TRUNCATE_LEN} chars]`;
}

/**
 * Extract assistant text for debug logging.
 *
 * Today the SDK type for `sendAndWait` is `AssistantMessageEvent |
 * undefined`, and `AssistantMessageEvent.data.content` is a string.
 * We still keep a narrow runtime guard because this path is diagnostics
 * only: if the SDK/event payload drifts at runtime, we prefer to log a
 * coarse marker instead of throwing from debug plumbing.
 */
function extractAssistantText(reply: unknown): string | undefined {
    if (reply === undefined || reply === null) return undefined;
    const data = (reply as { data?: unknown }).data;
    if (typeof data !== "object" || data === null) {
        return "[assistant message: unexpected data payload]";
    }
    const content = (data as { content?: unknown }).content;
    if (typeof content === "string") return content;
    if (content === undefined || content === null) return undefined;
    return "[assistant message: non-string content]";
}

const AjvConstructor = (AjvModule as any).default ?? AjvModule;

// ---- Public types: structural views over the SDK types ----
//
// These are derived from the SDK classes via `Pick` so the SDK is the
// single source of truth for method signatures. The narrow surface
// (only the members we actually call) keeps the test mock surface
// small while still failing the build if the SDK changes a signature
// out from under us.

export type MinimalCopilotSession = Pick<
    CopilotSession,
    "sessionId" | "sendAndWait" | "disconnect"
>;

export interface MinimalCopilotClient {
    start: CopilotClient["start"];
    stop: CopilotClient["stop"];
    createSession(config: SessionConfig): Promise<MinimalCopilotSession>;
}

/**
 * Factory returning a started client. The default implementation
 * dynamically imports `@github/copilot-sdk`. Tests inject a mock via
 * `setCopilotClientFactory`.
 */
export type CopilotClientFactory = () => Promise<MinimalCopilotClient>;

// ---- Lazy singleton + factory swap ----

let factory: CopilotClientFactory = defaultFactory;
let clientPromise: Promise<MinimalCopilotClient> | undefined;

async function defaultFactory(): Promise<MinimalCopilotClient> {
    // Dynamic import keeps the Copilot CLI runtime bundle out of the
    // workflow-engine critical path until any copilot.* task actually runs.
    const sdk = (await import("@github/copilot-sdk")) as any;
    const client = new sdk.CopilotClient();
    await client.start();
    return client as MinimalCopilotClient;
}

/**
 * Swap the SDK client factory. Intended for tests; production code
 * should leave the default in place.
 */
export function setCopilotClientFactory(fn: CopilotClientFactory): void {
    factory = fn;
    clientPromise = undefined;
}

/** Reset the singleton (tests). */
export function resetCopilotClientFactory(): void {
    factory = defaultFactory;
    clientPromise = undefined;
}

/** Lazily start the singleton client. */
export async function getCopilotClient(): Promise<MinimalCopilotClient> {
    if (!clientPromise) {
        clientPromise = factory();
    }
    return clientPromise;
}

/**
 * Stop the lazy singleton SDK client, if started. Idempotent.
 */
export async function shutdownCopilotHost(): Promise<void> {
    if (!clientPromise) return;
    const client = await clientPromise.catch(() => undefined);
    clientPromise = undefined;
    if (!client) return;
    try {
        await client.stop();
    } catch (err) {
        debug("Error stopping Copilot client: %O", err);
    }
}

// ---- Schema-guided turn driver (decision 0010 §4) ----

const ajv = new AjvConstructor({ strict: false });

/** Result of an ephemeral copilot agent invocation (decision 0010 §4). */
export type InvokeCopilotAgentResult =
    | { kind: "ok"; output: unknown }
    | {
          kind: "fail";
          error: { message: string; data?: Record<string, unknown> };
      };

export interface InvokeCopilotAgentOptions {
    /** User-turn prompt. */
    prompt: string;
    /** The node's IR-declared outputSchema. */
    outputSchema: JSONSchema;
    /** Optional model name. */
    model?: string;
    /** Author-supplied addition to the SDK system prompt (mode "append"). */
    systemMessageAppend?: string;
    /** Custom sub-agent definitions. */
    customAgents?: CustomAgentConfig[];
    /** Allow-list of Copilot CLI runtime built-in tool names. */
    availableTools?: string[];
    /** File attachments (already path-validated by caller). */
    attachments?: Array<{ path: string }>;
    /**
     * Hard cap on session run time. Forwarded as the `timeout` second
     * positional argument to `CopilotSession.sendAndWait`.
     */
    timeoutMs?: number;
    /**
     * For models that support reasoning effort. Typed via the SDK so a
     * change in supported levels is a compile error here, not a silent
     * runtime mismatch. The IR-declared input schema for `copilot.invoke`
     * narrows this to a fixed enum (decision 0010 §5).
     */
    reasoningEffort?: SessionConfig["reasoningEffort"];
    /** Schema-repair attempts (default 3, range 1-10). */
    repairBudget?: number;
    /** Engine cooperative-cancellation signal. */
    signal: AbortSignal;
}

/** System-prompt scaffolding for the submit_response convention. */
function buildSystemMessageContent(
    submitParamsSchema: Record<string, unknown>,
    authorAppend?: string,
): string {
    const schemaText = JSON.stringify(submitParamsSchema, null, 2);
    const base = [
        "You are an AI agent driven by an automated workflow engine. Only your `submit_response` tool call is read; assistant text is ignored by the engine but allowed for reasoning.",
        "",
        "Call `submit_response` exactly once when done. Its `arguments` MUST match this JSON Schema:",
        "",
        "```json",
        schemaText,
        "```",
        "",
        "If rejected, the next user message contains the validator errors — fix the arguments and call `submit_response` again. Repair attempts are bounded.",
        "",
        "You may call other available tools before submitting.",
    ].join("\n");
    return authorAppend ? `${base}\n\n${authorAppend}` : base;
}

/**
 * Implementation of the `copilot.invoke` builtin task: runs one or
 * more agent turns against a fresh session, using a `submit_response`
 * custom tool whose parameters JSON Schema is the IR node's
 * `outputSchema`. Repairs (re-prompts) on validation failure or
 * no-call-on-idle, up to `repairBudget` total attempts.
 *
 * The session is created and disposed inside this call (ephemeral).
 */
export async function invokeCopilotAgent(
    options: InvokeCopilotAgentOptions,
): Promise<InvokeCopilotAgentResult> {
    options.signal.throwIfAborted();

    // Validate budget bounds.
    const budget = options.repairBudget ?? 3;
    if (!Number.isInteger(budget) || budget < 1 || budget > 10) {
        return {
            kind: "fail",
            error: {
                message: `repairBudget must be an integer in [1, 10]; got ${budget}`,
            },
        };
    }

    // LLM tool-calls MUST be a JSON-Schema object (not a bare string, etc.)
    // Adapt scalar schemas like `{type: "string"}` by wrapping them in
    // `{type:"object", properties: {value: <userSchema>}, required:["value"]}`.
    // The captured value is unwrapped to the bare scalar before returning.
    const userSchema = options.outputSchema as Record<string, unknown>;
    const userType = userSchema.type;
    const isObjectShape =
        userType === undefined ||
        userType === "object" ||
        (Array.isArray(userType) && (userType as unknown[]).includes("object"));
    const submitSchema: Record<string, unknown> = isObjectShape
        ? userSchema
        : {
              type: "object",
              properties: { value: userSchema },
              required: ["value"],
              additionalProperties: false,
          };

    // Compile the validator for the (possibly wrapped) submit_response
    // parameters schema.
    let validate;
    try {
        validate = ajv.compile(submitSchema);
    } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        return {
            kind: "fail",
            error: { message: `Invalid outputSchema: ${m}` },
        };
    }

    // Mutable capture cell shared with the submit_response handler. `value`
    // holds the unwrapped node-output value (an object when the node's
    // outputSchema is object-shaped, or the bare scalar otherwise).
    const captured: {
        value?: unknown;
        hasValue?: boolean;
        lastErrors?: string;
    } = {};

    const sdk = (await import("@github/copilot-sdk")) as any;
    const client = await getCopilotClient();

    // Build the synthetic submit_response tool. The SDK accepts a raw JSON
    // Schema object as `parameters`. We also Ajv-validate inside the handler so
    // we never accept malformed args even if SDK-side validation is permissive.
    const submitTool = sdk.defineTool("submit_response", {
        description:
            "Submit your final answer. Call this exactly once when you have your final answer.",
        parameters: submitSchema,
        skipPermission: true,
        handler: async (args: unknown) => {
            if (
                typeof args !== "object" ||
                args === null ||
                Array.isArray(args) ||
                !validate(args)
            ) {
                const errs = validate?.errors
                    ? ajv.errorsText(validate.errors)
                    : "arguments must be a JSON object matching the schema";
                captured.lastErrors = errs;
                return `\`submit_response\` rejected: ${errs}. Please call \`submit_response\` again with corrected arguments.`;
            }
            captured.value = isObjectShape
                ? (args as Record<string, unknown>)
                : (args as Record<string, unknown>).value;
            captured.hasValue = true;
            delete captured.lastErrors;
            return "Response recorded.";
        },
    });

    const sessionConfig: SessionConfig = {
        onPermissionRequest: sdk.approveAll,
        tools: [submitTool],
        systemMessage: {
            mode: "append",
            content: buildSystemMessageContent(
                submitSchema,
                options.systemMessageAppend,
            ),
        },
    };
    if (options.model !== undefined) sessionConfig.model = options.model;
    if (options.reasoningEffort !== undefined)
        sessionConfig.reasoningEffort = options.reasoningEffort;
    if (options.customAgents !== undefined)
        sessionConfig.customAgents = options.customAgents;
    if (options.availableTools !== undefined) {
        // Always add our synthetic `submit_response` tool to the user's
        // allow-list so the model can complete the turn contract.
        const merged = new Set(options.availableTools);
        merged.add("submit_response");
        sessionConfig.availableTools = [...merged];
    }

    let session: MinimalCopilotSession | undefined;
    const onAbort = () => {
        // Best-effort: disconnect immediately on cancellation.
        session?.disconnect().catch(() => undefined);
    };
    options.signal.addEventListener("abort", onAbort, { once: true });

    try {
        session = await client.createSession(sessionConfig);

        const attachments: MessageOptions["attachments"] | undefined =
            options.attachments?.map((a) => ({
                type: "file" as const,
                path: a.path,
            }));

        let attempt = 0;
        let prompt = options.prompt;
        let lastAssistantText: string | undefined;
        while (attempt < budget) {
            attempt++;
            options.signal.throwIfAborted();
            debug(
                "copilot.invoke attempt %d/%d (sessionId=%s) prompt=%s",
                attempt,
                budget,
                session.sessionId,
                truncateForDebug(prompt),
            );

            const sendOpts: MessageOptions = { prompt };
            if (attachments) sendOpts.attachments = attachments;
            // `timeout` is the second positional arg to sendAndWait, NOT a
            // field on MessageOptions.
            const reply = await session.sendAndWait(
                sendOpts,
                options.timeoutMs,
            );
            lastAssistantText = extractAssistantText(reply);
            if (lastAssistantText !== undefined) {
                debug(
                    "copilot.invoke attempt %d assistant text: %s",
                    attempt,
                    truncateForDebug(lastAssistantText),
                );
            }

            if (captured.hasValue) {
                return { kind: "ok", output: captured.value };
            }

            // No successful capture this turn. Build a repair prompt for the
            // next attempt (if budget allows).
            const reason = captured.lastErrors
                ? `Your previous \`submit_response\` call was rejected: ${captured.lastErrors}.`
                : `You did not call \`submit_response\`. You MUST call \`submit_response\` with arguments matching the required schema.`;
            debug(
                "copilot.invoke attempt %d rejected: %s",
                attempt,
                captured.lastErrors ?? "no submit_response call",
            );
            prompt = `${reason} Please call \`submit_response\` now with corrected arguments matching the required schema.`;
        }

        return {
            kind: "fail",
            error: {
                message: `copilot.invoke exhausted repair budget (${budget}) without a valid submit_response call.`,
                data: {
                    attempts: attempt,
                    lastErrors: captured.lastErrors ?? null,
                    lastAssistantText: lastAssistantText ?? null,
                },
            },
        };
    } catch (err) {
        if (options.signal.aborted || (err as Error)?.name === "AbortError") {
            return {
                kind: "fail",
                error: { message: "copilot.invoke aborted" },
            };
        }
        const m = err instanceof Error ? err.message : String(err);
        return {
            kind: "fail",
            error: { message: `copilot.invoke error: ${m}` },
        };
    } finally {
        options.signal.removeEventListener("abort", onAbort);
        if (session) {
            try {
                await session.disconnect();
            } catch (e) {
                debug("session.disconnect() failed: %O", e);
            }
        }
    }
}
