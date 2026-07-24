// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IEmailProvider,
    EmailMessage,
    EmailProviderType,
    EmailSearchQuery,
    createEmailProviderFromConfig,
    claimSilentRestoreAnnouncement,
    evaluateGraphReadiness,
    GoogleEmailClient,
    parseDayRange,
    probeGraphConfig,
} from "graph-utils";
import chalk from "chalk";
import {
    EmailAction,
    FindEmailAction,
    ForwardEmailAction,
    MessageReference,
    ReplyEmailAction,
} from "./emailActionsSchema.js";
import { generateNotes } from "@typeagent/agent-runtime";
import { openai } from "@typeagent/aiclient";
import {
    ActionContext,
    ActionResult,
    ActionTokenUsage,
    AppAgent,
    AppAgentEvent,
    ReadinessReport,
    SessionContext,
    TypeAgentAction,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import {
    ChoiceManager,
    createActionResult,
    createActionResultFromError,
    createActionResultFromHtmlDisplay,
    createActionResultFromTextDisplay,
    createStructuredResult,
    createYesNoChoiceResult,
} from "@typeagent/agent-sdk/helpers/action";
import { ActionResultSuccess, BadgeTone } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayStatus,
    displaySuccess,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { EmailKpIndex, IndexProgressCallback } from "./emailKpIndex.js";
import {
    generateAnswer,
    AnswerResult,
    AnswerContext,
    SearchResult,
    ScoredChunkResult,
    ChunkContent,
} from "kp";
import { emailsToChunks } from "./emailKpBridge.js";

import registerDebug from "debug";
const debug = registerDebug("typeagent:email");

/**
 * Permissive RFC-5321-ish check: a single `@`, at least one char on each
 * side, and a `.` in the domain. Intentionally not a full RFC validator —
 * we just want to identify inputs that are *already* email addresses so
 * we can skip the directory lookup (which needs the `User.ReadBasic.All`
 * Graph scope — user-consentable, no admin consent required). Display-name
 * lookups still go through the provider for inputs that don't look like
 * addresses.
 */
const EMAIL_ADDRESS_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function isLikelyEmailAddress(input: string): boolean {
    return EMAIL_ADDRESS_RE.test(input.trim());
}

/**
 * Split recipient inputs into "already-an-address" (passthrough) and
 * "needs directory lookup" (delegated to the provider's resolveUserEmails).
 * Combined result is a flat list of resolved addresses.
 *
 * Lets users send mail to literal addresses (`robgruen@microsoft.com`) even
 * when the directory lookup permission isn't granted, while preserving the
 * name-resolution path for inputs like `"robert gruen"`.
 */
async function resolveRecipients(
    inputs: string[],
    provider: IEmailProvider,
): Promise<string[]> {
    if (inputs.length === 0) return [];
    const direct: string[] = [];
    const needsLookup: string[] = [];
    for (const input of inputs) {
        const trimmed = input.trim();
        if (isLikelyEmailAddress(trimmed)) {
            direct.push(trimmed);
        } else {
            needsLookup.push(trimmed);
        }
    }
    const resolved =
        needsLookup.length > 0
            ? await provider.resolveUserEmails(needsLookup)
            : [];
    return [...direct, ...resolved];
}

class EmailLoginCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Log into email service";
    public async run(context: ActionContext<EmailActionContext>) {
        const provider = context.sessionContext.agentContext.emailProvider;
        const providerType = context.sessionContext.agentContext.providerType;

        if (provider === undefined) {
            throw new Error("Email provider not initialized");
        }

        if (provider.isAuthenticated()) {
            const user = await provider.getUser();
            const name = user.displayName || "Unknown";
            const email = user.email || "Unknown";
            displayWarn(`Already logged in as ${name}<${email}>`, context);
            // Re-emit the signed-in marker so the avatar (name + photo)
            // resyncs even when the user was already authenticated — e.g.
            // restored silently on launch before the photo had been fetched.
            const photoAttr = user.photoUrl
                ? ` data-photo="${escapeHtml(user.photoUrl)}"`
                : "";
            context.actionIO.appendDisplay({
                type: "html",
                content: `<span class="typeagent-user-signed-in" data-name="${escapeHtml(name)}" data-email="${escapeHtml(email)}"${photoAttr} hidden></span>`,
            });
            return;
        }

        displayStatus(
            `Logging into ${providerType || "email"} service...`,
            context,
        );

        const success = await provider.login((prompt) => {
            if (prompt.kind === "error") {
                displayWarn(prompt.message, context);
            } else {
                // Both deviceCode and browser surface the message as-is; the
                // device-code message contains the URL+code, the browser
                // message says "opening your browser...".
                displayStatus(prompt.message, context);
            }
        });

        if (success) {
            const user = await provider.getUser();
            const name = user.displayName || "Unknown";
            const email = user.email || "Unknown";
            displaySuccess(
                `Successfully logged in as ${name} <${email}>`,
                context,
            );
            // Hidden marker the chat-ui / shell scan for after each agent
            // message. Lifts the signed-in identity into UI state so the
            // user-letter avatar shows the real initial and stops triggering
            // login on click. data-photo carries the base64 profile photo
            // (when the provider has one) so the avatar can render the image.
            const photoAttr = user.photoUrl
                ? ` data-photo="${escapeHtml(user.photoUrl)}"`
                : "";
            context.actionIO.appendDisplay({
                type: "html",
                content: `<span class="typeagent-user-signed-in" data-name="${escapeHtml(name)}" data-email="${escapeHtml(email)}"${photoAttr} hidden></span>`,
            });

            // Kick off async index build/sync after successful login
            const agentCtx = context.sessionContext.agentContext;
            if (!agentCtx.kpIndex.loaded) {
                // First time: build initial index in background
                startBackgroundInitialIndex(agentCtx);
            } else {
                // Index exists: forward sync in background
                startBackgroundSync(agentCtx);
            }
        } else {
            displayWarn(
                "Login failed. If using Google, you can also try '@email google-auth <code>' with a manual authorization code.",
                context,
            );
        }
    }
}

class EmailLogoutCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Log out of email service";
    public async run(context: ActionContext<EmailActionContext>) {
        const provider = context.sessionContext.agentContext.emailProvider;
        if (provider === undefined) {
            throw new Error("Email provider not initialized");
        }
        const wasLoggedIn = provider.logout();
        if (wasLoggedIn) {
            displaySuccess("Successfully logged out", context);
        } else {
            displayWarn("Already logged out", context);
        }
        // Reset the chat UI's user-letter avatar back to "U" / clickable.
        // Emitted regardless of wasLoggedIn so the avatar resyncs even if a
        // prior @calendar logout already cleared the in-memory client.
        context.actionIO.appendDisplay({
            type: "html",
            content: `<span class="typeagent-user-signed-out" hidden></span>`,
        });
    }
}

class GoogleAuthCommandHandler implements CommandHandler {
    public readonly description =
        "Complete Google Gmail OAuth flow with authorization code";
    public readonly parameters = {
        args: {
            code: {
                description: "Authorization code from Google OAuth redirect",
                type: "string",
                optional: false,
            },
        },
    } as const;

    public async run(
        context: ActionContext<EmailActionContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const provider = context.sessionContext.agentContext.emailProvider;
        const providerType = context.sessionContext.agentContext.providerType;

        if (provider === undefined) {
            throw new Error("Email provider not initialized");
        }

        if (providerType !== "google") {
            displayWarn(
                "This command is only for Google Gmail. Use '@email login' for Microsoft Graph.",
                context,
            );
            return;
        }

        const code = params.args.code as string;
        if (!code || code.trim() === "") {
            displayWarn(
                "Please provide the authorization code: @email google-auth <code>",
                context,
            );
            return;
        }

        displayStatus("Completing Google Gmail authorization...", context);

        const googleProvider = provider as GoogleEmailClient;
        const success = await googleProvider.completeAuth(code);

        if (success) {
            const user = await provider.getUser();
            displaySuccess(
                `Successfully logged in to Gmail as ${user.displayName || "Unknown"} <${user.email || "Unknown"}>`,
                context,
            );

            // Kick off async index build/sync after successful auth
            const agentCtx = context.sessionContext.agentContext;
            if (!agentCtx.kpIndex.loaded) {
                startBackgroundInitialIndex(agentCtx);
            } else {
                startBackgroundSync(agentCtx);
            }
        } else {
            displayWarn(
                "Failed to complete authorization. Please try '@email login' again to get a new code.",
                context,
            );
        }
    }
}

class EmailIndexCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Build keyword index from inbox emails for fast search";
    public async run(context: ActionContext<EmailActionContext>) {
        const provider = context.sessionContext.agentContext.emailProvider;
        if (provider === undefined) {
            throw new Error("Email provider not initialized");
        }
        if (!provider.isAuthenticated()) {
            displayWarn("Please log in first with '@email login'", context);
            return;
        }

        const agentCtx = context.sessionContext.agentContext;
        if (agentCtx.indexingInProgress) {
            displayWarn(
                "Index build already in progress. Progress will appear as notifications.",
                context,
            );
            return;
        }

        displayStatus(
            "Starting email keyword index build in background...",
            context,
        );
        startBackgroundInitialIndex(agentCtx);
    }
}

const handlers: CommandHandlerTable = {
    description: "Email commands",
    defaultSubCommand: "login",
    commands: {
        login: new EmailLoginCommandHandler(),
        logout: new EmailLogoutCommandHandler(),
        "google-auth": new GoogleAuthCommandHandler(),
        index: new EmailIndexCommandHandler(),
    },
};

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeEmailContext,
        updateAgentContext: updateEmailContext,
        executeAction: executeEmailAction,
        checkReadiness: checkEmailReadiness,
        setup: setupEmail,
        handleChoice: async (choiceId, response, context) => {
            const ctx = (context as ActionContext<EmailActionContext>)
                .sessionContext.agentContext;
            return ctx.choiceManager.handleChoice(choiceId, response, context);
        },
        ...getCommandInterface(handlers),
    };
}

type EmailActionContext = {
    emailProvider: IEmailProvider | undefined;
    providerType: EmailProviderType | undefined;
    kpIndex: EmailKpIndex;
    /** Stored for background notification via notify() */
    sessionContext?: SessionContext<EmailActionContext>;
    /** Whether a background index operation is currently running */
    indexingInProgress: boolean;
    /**
     * Manages yes/no choice callbacks (currently only the setup-flow card).
     * The AppAgent.handleChoice in instantiate() delegates back to this.
     */
    choiceManager: ChoiceManager;
};

async function initializeEmailContext(): Promise<EmailActionContext> {
    const kpIndex = new EmailKpIndex();
    // Try to load persisted index from disk
    const loaded = kpIndex.load();
    if (loaded) {
        debug("Loaded persisted kp index");
    }
    return {
        emailProvider: undefined,
        providerType: undefined,
        kpIndex,
        indexingInProgress: false,
        choiceManager: new ChoiceManager(),
    };
}

// HH:MM timestamp for setup status updates — same convention as
// calendar / desktop / screencapture.
function emailTs(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Cheap readiness probe: env config + provider.isAuthenticated().
// See graphUtils/readiness.ts for the decision logic — shared with the
// calendar agent since both use the same provider abstraction and env vars.
async function checkEmailReadiness(
    context: SessionContext<EmailActionContext>,
): Promise<ReadinessReport> {
    const config = probeGraphConfig(process.env);
    let provider = context.agentContext?.emailProvider;
    if (!provider && (config.msGraphConfigured || config.googleConfigured)) {
        provider = createEmailProviderFromConfig();
    }
    return evaluateGraphReadiness("email", {
        ...config,
        isAuthenticated: provider?.isAuthenticated() === true,
        providerName: provider?.providerName,
    });
}

// setup hook — drives the device-code / OAuth login flow. Mirrors the
// calendar agent's setup; the only differences are the agent name in
// messaging and which factory we call.
async function setupEmail(
    actionContext: ActionContext<EmailActionContext>,
): Promise<ActionResult> {
    const ctx = actionContext.sessionContext.agentContext;
    const config = probeGraphConfig(process.env);
    if (!config.msGraphConfigured && !config.googleConfigured) {
        return createActionResultFromError(
            "No email provider configured. Set MSGRAPH_APP_CLIENTID + MSGRAPH_APP_TENANTID or GOOGLE_CALENDAR_CLIENT_ID + GOOGLE_CALENDAR_CLIENT_SECRET in `ts/.env`, then run `@config agent refresh email`.",
        );
    }
    if (!ctx.emailProvider) {
        ctx.emailProvider = createEmailProviderFromConfig();
        if (ctx.emailProvider) {
            ctx.providerType = ctx.emailProvider
                .providerName as EmailProviderType;
        }
    }
    const provider = ctx.emailProvider;
    if (!provider) {
        return createActionResultFromError(
            "Email env vars are set but the provider could not be created. Check `ts/.env` and restart the agent server.",
        );
    }
    if (provider.isAuthenticated()) {
        return createActionResultFromTextDisplay("Already signed in to email.");
    }
    const providerLabel =
        ctx.providerType === "google" ? "Gmail" : "Microsoft 365";
    return createYesNoChoiceResult(
        ctx.choiceManager,
        `Sign in to ${providerLabel}? You'll be shown a device code (or browser link) to complete the flow. Sign-in usually takes under a minute — I'll post the result here.`,
        async (confirmed, liveActionContext) => {
            if (!confirmed) {
                return createActionResultFromTextDisplay(
                    "Sign-in skipped. Run `@email login` later to sign in.",
                );
            }
            return runEmailLogin(
                liveActionContext as ActionContext<EmailActionContext>,
            );
        },
    );
}

// Drives provider.login() in the choice callback. Exported for unit tests.
export async function runEmailLogin(
    actionContext: ActionContext<EmailActionContext>,
): Promise<ActionResult> {
    const ctx = actionContext.sessionContext.agentContext;
    const provider = ctx.emailProvider;
    if (!provider) {
        return createActionResultFromError("Email provider not initialized.");
    }
    actionContext.actionIO.appendDisplay(
        {
            type: "text",
            content: `[${emailTs()}] Starting sign-in…`,
            kind: "status",
        },
        "block",
    );
    try {
        const success = await provider.login((prompt) => {
            actionContext.actionIO.appendDisplay(
                {
                    type: "text",
                    content: `[${emailTs()}] ${prompt.message}`,
                    kind: "status",
                },
                "block",
            );
        });
        if (!success) {
            const tip =
                ctx.providerType === "google"
                    ? " You can also try `@email google-auth <code>` with a manual authorization code."
                    : "";
            return createActionResultFromError(
                `[${emailTs()}] Sign-in failed.${tip}`,
            );
        }
        const user = await provider.getUser();
        return createActionResultFromTextDisplay(
            `[${emailTs()}] Signed in as ${user.displayName || user.email || "Unknown"}. Re-run your email command — readiness was re-checked automatically.`,
        );
    } catch (e: any) {
        return createActionResultFromError(
            `[${emailTs()}] Sign-in failed: ${e?.message ?? e}`,
        );
    }
}

async function updateEmailContext(
    enable: boolean,
    context: SessionContext<EmailActionContext>,
): Promise<void> {
    if (enable) {
        // Store session context for background notifications
        context.agentContext.sessionContext = context;

        const provider = createEmailProviderFromConfig();

        if (provider) {
            context.agentContext.emailProvider = provider;
            context.agentContext.providerType =
                provider.providerName as EmailProviderType;
            debug(`Email provider initialized: ${provider.providerName}`);

            // If already authenticated (token loaded from disk), kick off
            // forward sync in background to pick up new emails
            if (
                provider.isAuthenticated() &&
                context.agentContext.kpIndex.loaded
            ) {
                startBackgroundSync(context.agentContext);
            }

            // Restore a prior session from cached credentials so the avatar
            // shows the signed-in user (name + photo) on launch without an
            // explicit login. Fire-and-forget so agent enable isn't blocked
            // on a network round-trip.
            void trySilentEmailSignIn(provider, context);
        } else {
            debug("No email provider configured");
        }
    } else {
        context.agentContext.emailProvider = undefined;
        context.agentContext.providerType = undefined;
        delete context.agentContext.sessionContext;
    }
}

async function executeEmailAction(
    action: TypeAgentAction<EmailAction>,
    context: ActionContext<EmailActionContext>,
) {
    const { emailProvider } = context.sessionContext.agentContext;
    if (emailProvider === undefined) {
        throw new Error("Email provider not initialized");
    }

    if (!emailProvider.isAuthenticated()) {
        await emailProvider.login();
    }

    // Accumulates the LLM token usage consumed while handling this action so
    // it can be reported back to the dispatcher as "Action Tokens".
    const tokenUsage: ActionTokenUsage = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
    };
    const result = await handleEmailAction(action, context, tokenUsage);
    if (result) {
        // If handler already built an ActionResultSuccess, return it directly
        const actionResult =
            typeof result === "object" ? result : createActionResult(result);
        actionResult.tokenUsage = tokenUsage;
        return actionResult;
    }
}

async function handleEmailAction(
    action: EmailAction,
    context: ActionContext<EmailActionContext>,
    tokenUsage: ActionTokenUsage,
): Promise<ActionResultSuccess | string | undefined> {
    const { emailProvider } = context.sessionContext.agentContext;
    if (!emailProvider) {
        return "Email provider not initialized ...";
    }

    let res;
    switch (action.actionName) {
        case "sendEmail":
            let to_addrs: string[] | undefined = [];
            if (action.parameters.to && action.parameters.to.length > 0) {
                const expandedTo = await expandSelfReferences(
                    action.parameters.to,
                    emailProvider,
                );
                to_addrs = await resolveRecipients(expandedTo, emailProvider);
            }

            let cc_addrs: string[] | undefined = [];
            if (action.parameters.cc && action.parameters.cc.length > 0) {
                const expandedCc = await expandSelfReferences(
                    action.parameters.cc,
                    emailProvider,
                );
                cc_addrs = await resolveRecipients(expandedCc, emailProvider);
            }

            let bcc_addrs: string[] | undefined = [];
            if (action.parameters.bcc && action.parameters.bcc.length > 0) {
                const expandedBcc = await expandSelfReferences(
                    action.parameters.bcc,
                    emailProvider,
                );
                bcc_addrs = await resolveRecipients(expandedBcc, emailProvider);
            }

            let genContent: string = "";
            if (action.parameters.genContent.generateBody) {
                const query = action.parameters.genContent.bodySearchQuery;
                if (query) {
                    const chatModel = openai.createChatModel(
                        "GPT_35_TURBO",
                        undefined,
                        undefined,
                        ["emailActionHandler"],
                    );
                    // Accumulate the LLM token usage reported by the model so
                    // the agent can attribute it to this request.
                    chatModel.completionCallback = (_params, data) => {
                        const usage = (data as any)?.usage;
                        if (usage) {
                            tokenUsage.prompt_tokens +=
                                usage.prompt_tokens ?? 0;
                            tokenUsage.completion_tokens +=
                                usage.completion_tokens ?? 0;
                            tokenUsage.total_tokens += usage.total_tokens ?? 0;
                        }
                    };
                    const result = await generateNotes(
                        query,
                        4096,
                        chatModel,
                        undefined,
                    );

                    if (result.success) {
                        result.data.forEach((data) => {
                            genContent += data + "\n";
                        });
                    }
                }
            }

            // Resolve body placeholders like [Your Name]
            let emailBody =
                genContent.length > 0
                    ? genContent
                    : (action.parameters.body ?? "");
            emailBody = await resolveBodyPlaceholders(emailBody, emailProvider);

            debug(chalk.green("Handling sendEmail action ..."));
            // Reject early if recipient resolution dropped everything —
            // empty arrays would otherwise produce an unhelpful Graph 400.
            if (
                (!to_addrs || to_addrs.length === 0) &&
                (!cc_addrs || cc_addrs.length === 0) &&
                (!bcc_addrs || bcc_addrs.length === 0)
            ) {
                const requested = [
                    ...(action.parameters.to ?? []),
                    ...(action.parameters.cc ?? []),
                    ...(action.parameters.bcc ?? []),
                ];
                return `Could not resolve any recipients for: ${requested.map((s) => `"${s}"`).join(", ")}. Pass a full email address (e.g. user@domain.com), or consent to User.ReadBasic.All so name lookups work.`;
            }
            try {
                res = await emailProvider.sendEmail(
                    action.parameters.subject,
                    emailBody,
                    to_addrs,
                    cc_addrs,
                    bcc_addrs,
                );
            } catch (e: any) {
                // Surface the underlying Graph/Gmail error to the user
                // instead of the prior generic "Error encountered when
                // sending email!" — providers throw rather than swallow.
                const detail = e?.message ?? String(e);
                return `Error sending email: ${detail}`;
            }

            if (res) {
                return "Email sent ...";
            } else {
                return "Error encountered when sending email!";
            }
            break;

        case "forwardEmail":
        case "replyEmail":
            return await handleForwardOrReplyAction(action, emailProvider);

        case "findEmail":
            return await handleFindEmailAction(
                action,
                emailProvider,
                context.sessionContext.agentContext.kpIndex,
                context,
            );

        default:
            throw new Error(`Unknown action: ${(action as any).actionName}`);
    }
}

async function handleForwardOrReplyAction(
    action: ForwardEmailAction | ReplyEmailAction,
    emailProvider: IEmailProvider,
) {
    const rawRef = action.parameters.messageRef as MessageReference | string;
    const msgRef: MessageReference =
        typeof rawRef === "string" ? { content: rawRef } : rawRef;
    if (msgRef) {
        // use the message reference to find the email to reply to
        console.log(chalk.green("Handling replyEmail action ..."));

        let senders: string[] | undefined = [];
        if (msgRef.senders && msgRef.senders.length > 0) {
            senders = await resolveRecipients(msgRef.senders, emailProvider);
        }

        if (senders && senders.length > 0) {
            // get the email message to reply to
            const searchQuery: EmailSearchQuery = {
                sender: senders[0],
            };
            if (msgRef.subject) searchQuery.subject = msgRef.subject;
            if (msgRef.content) searchQuery.content = msgRef.content;
            if (msgRef.receivedDateTime?.startTime)
                searchQuery.startDateTime = msgRef.receivedDateTime.startTime;
            if (msgRef.receivedDateTime?.endTime)
                searchQuery.endDateTime = msgRef.receivedDateTime.endTime;
            const msg_id = await emailProvider.findEmail(searchQuery);

            if (msg_id) {
                let cc_addrs: string[] | undefined = [];
                if (action.parameters.cc && action.parameters.cc.length > 0) {
                    cc_addrs = await resolveRecipients(
                        action.parameters.cc,
                        emailProvider,
                    );
                }

                let bcc_addrs: string[] | undefined = [];
                if (action.parameters.bcc && action.parameters.bcc.length > 0) {
                    bcc_addrs = await resolveRecipients(
                        action.parameters.bcc,
                        emailProvider,
                    );
                }

                // reply to the email
                if (action.actionName === "replyEmail") {
                    let res;
                    try {
                        res = await emailProvider.replyToEmail(
                            msg_id,
                            action.parameters.body ?? "",
                            cc_addrs,
                            bcc_addrs,
                        );
                    } catch (e: any) {
                        return `Error replying to email: ${e?.message ?? String(e)}`;
                    }

                    if (res) {
                        return "Email replied ...";
                    } else {
                        return "Error encountered when replying to email!";
                    }
                } else {
                    let to_addrs: string[] | undefined = [];
                    if (
                        action.parameters.to &&
                        action.parameters.to.length > 0
                    ) {
                        to_addrs = await resolveRecipients(
                            action.parameters.to,
                            emailProvider,
                        );
                    }

                    let res;
                    try {
                        res = await emailProvider.forwardEmail(
                            msg_id,
                            action.parameters.additionalMessage ?? "",
                            to_addrs,
                            cc_addrs,
                            bcc_addrs,
                        );
                    } catch (e: any) {
                        return `Error forwarding email: ${e?.message ?? String(e)}`;
                    }

                    if (res) {
                        return "Email forwarded ...";
                    } else {
                        return "Error encountered when forwarding email!";
                    }
                }
            }
        } else {
            console.log(chalk.red("No sender found in message reference"));
        }
    }
}

function formatMessageSummary(msg: EmailMessage): string {
    const from = msg.from ? `${msg.from.name || msg.from.address}` : "Unknown";
    const read = msg.isRead ? "" : " [UNREAD]";
    const date = msg.receivedDateTime
        ? new Date(msg.receivedDateTime).toLocaleDateString()
        : "";
    const preview = msg.bodyPreview
        ? msg.bodyPreview.replace(/\s+/g, " ").trim().slice(0, 80)
        : "";
    return `- ${msg.subject}${read}  |  ${from}  |  ${date}\n  ${preview}`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Attempt a silent, non-interactive sign-in using cached MS Graph
// credentials so a previously signed-in user sees the signed-in avatar
// (name + photo) on app launch without clicking login. Only runs for the
// Microsoft provider and never prompts: provider.login() with no callback
// uses the persisted auth record and fails quietly when there is none or it
// has expired. On success it posts a short "signed in" message carrying the
// hidden user-signed-in marker (via an agent-initiated bubble thread — the
// only display path both chat UIs scan for the marker), so both UIs lift the
// identity into the avatar state. A process-wide guard ensures only the first
// agent (calendar or email) to restore announces it.
async function trySilentEmailSignIn(
    provider: IEmailProvider,
    context: SessionContext<EmailActionContext>,
): Promise<void> {
    try {
        if (provider.providerName !== "microsoft") {
            return;
        }
        if (!provider.isAuthenticated()) {
            const ok = await provider.login();
            if (!ok) {
                return;
            }
        }
        if (!claimSilentRestoreAnnouncement()) {
            // Another agent already restored + announced this session; our
            // client is warmed, nothing more to surface.
            return;
        }
        const user = await provider.getUser();
        const name = user.displayName || "Unknown";
        const email = user.email || "Unknown";
        const photoAttr = user.photoUrl
            ? ` data-photo="${escapeHtml(user.photoUrl)}"`
            : "";
        const thread = context.beginAgentThread("bubble");
        thread.appendDisplay(
            {
                type: "html",
                content:
                    `Signed in as ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;` +
                    `<span class="typeagent-user-signed-in" data-name="${escapeHtml(name)}" data-email="${escapeHtml(email)}"${photoAttr} hidden></span>`,
            },
            "block",
        );
        thread.complete();
    } catch {
        // Silent: no cached creds / expired / offline — leave the avatar in
        // its signed-out state; the user can still click to sign in.
    }
}

function formatEmailListPlain(
    messages: EmailMessage[],
    heading: string,
): string {
    const lines: string[] = [heading + "\n"];
    for (const msg of messages) {
        lines.push(formatMessageSummary(msg));
    }
    return lines.join("\n");
}

// Build a structured email-list result: a heading + a list block (one item
// per message, with the subject as a link, a "From · date" subtitle, and an
// unread badge) plus a machine-readable rawData payload. The SDK derives the
// markdown/text fallback for clients that can't render blocks.
function buildStructuredEmailList(
    messages: EmailMessage[],
    heading: string,
): ActionResultSuccess {
    const items = messages.map((msg) => {
        const from = msg.from ? msg.from.name || msg.from.address : "Unknown";
        const date = msg.receivedDateTime
            ? new Date(msg.receivedDateTime).toLocaleDateString()
            : "";
        const preview = msg.bodyPreview
            ? msg.bodyPreview.replace(/\s+/g, " ").trim().slice(0, 120)
            : "";
        const subtitleParts = [`From ${from}`];
        if (date) subtitleParts.push(date);
        if (preview) subtitleParts.push(preview);
        const unread = msg.isRead === false;
        return {
            text: msg.subject || "(no subject)",
            ...(msg.webLink ? { href: msg.webLink } : {}),
            subtitle: subtitleParts.join(" · "),
            badges: unread ? (["info"] as BadgeTone[]) : [],
        };
    });

    const rawData = messages.map((msg) => ({
        subject: msg.subject,
        from: msg.from
            ? { name: msg.from.name, address: msg.from.address }
            : undefined,
        receivedDateTime: msg.receivedDateTime,
        isRead: msg.isRead,
        webLink: msg.webLink,
        bodyPreview: msg.bodyPreview,
    }));

    return createStructuredResult(
        [
            { kind: "heading", level: 3, text: heading },
            { kind: "list", items },
        ],
        {
            rawData,
            historyText: formatEmailListPlain(messages, heading),
        },
    );
}

const SELF_TERMS = new Set(["myself", "me", "my email", "i", "my", "s"]);

/**
 * Expand self-referential names ("me", "myself", etc.) to the logged-in
 * user's email address. Returns the expanded list.
 */
async function expandSelfReferences(
    names: string[],
    emailProvider: IEmailProvider,
): Promise<string[]> {
    const expanded: string[] = [];
    for (const s of names) {
        if (SELF_TERMS.has(s.toLowerCase().trim())) {
            try {
                const user = await emailProvider.getUser();
                if (user.email) {
                    expanded.push(user.email);
                    continue;
                }
            } catch {}
        }
        expanded.push(s);
    }
    return expanded;
}

/**
 * Replace name/signature placeholders in email body with the user's
 * actual display name (e.g. "[Your Name]" → "Steven Lucco").
 */
async function resolveBodyPlaceholders(
    body: string,
    emailProvider: IEmailProvider,
): Promise<string> {
    if (!body.includes("[Your Name]") && !body.includes("[your name]")) {
        return body;
    }
    try {
        const user = await emailProvider.getUser();
        if (user.displayName) {
            return body.replace(/\[Your Name\]/gi, user.displayName);
        }
    } catch {}
    return body;
}

/**
 * Online RAG: convert provider search results into chunks and generate
 * a grounded LLM answer. No offline index required.
 */
async function generateOnlineAnswer(
    userQuery: string,
    messages: EmailMessage[],
    emailProvider: IEmailProvider,
): Promise<AnswerResult | undefined> {
    if (messages.length === 0) return undefined;

    const { chunks } = emailsToChunks(messages);

    // Get logged-in user's display name for personalized answers
    let userName: string | undefined;
    try {
        const user = await emailProvider.getUser();
        userName = user.displayName || undefined;
    } catch {}

    // Build synthetic SearchResult with position-based scoring
    // (provider already ranks by relevance — first result is best)
    const scoredChunks: ScoredChunkResult[] = chunks.map((c, i) => ({
        chunkId: c.chunkId,
        score: 10.0 - i * (9.0 / Math.max(chunks.length - 1, 1)),
    }));

    const searchResult: SearchResult = {
        chunks: scoredChunks,
        matchedTerms: [],
        totalConsidered: chunks.length,
    };

    // Build chunk lookup for the getChunk() callback
    const chunkMap = new Map(chunks.map((c) => [c.chunkId, c]));

    const ctx: AnswerContext = {
        userQuery,
        searchResult,
        getChunk: (id: number): ChunkContent | undefined => {
            const c = chunkMap.get(id);
            if (!c) return undefined;
            const content: ChunkContent = {
                text: c.text,
                metadata: c.metadata,
            };
            if (c.groupId) content.groupId = c.groupId;
            if (c.timestamp) content.timestamp = c.timestamp;
            return content;
        },
    };
    if (userName) ctx.userName = userName;

    try {
        return await generateAnswer(ctx, {
            charBudget: 16_000,
            htmlOutput: true,
        });
    } catch (e: any) {
        debug("Online answer generation failed: %s", e.message);
        return undefined;
    }
}

async function handleFindEmailAction(
    action: FindEmailAction,
    emailProvider: IEmailProvider,
    kpIndex: EmailKpIndex,
    context: ActionContext<unknown>,
): Promise<ActionResultSuccess | string> {
    debug(chalk.green("Handling findEmail action ..."));

    const rawRef = action.parameters.messageRef as MessageReference | string;
    const msgRef: MessageReference =
        typeof rawRef === "string" ? { content: rawRef } : rawRef;

    // Build provider search query from message reference
    const searchQuery: EmailSearchQuery = {};
    if (msgRef.senders && msgRef.senders.length > 0) {
        const expandedSenders = await expandSelfReferences(
            msgRef.senders,
            emailProvider,
        );
        const resolved = await resolveRecipients(
            expandedSenders,
            emailProvider,
        );
        if (resolved.length > 0) {
            searchQuery.sender = resolved[0];
        }
    }
    if (msgRef.subject) searchQuery.subject = msgRef.subject;
    if (msgRef.content) searchQuery.content = msgRef.content;
    if (msgRef.receivedDateTime?.startTime)
        searchQuery.startDateTime = msgRef.receivedDateTime.startTime;
    if (msgRef.receivedDateTime?.endTime)
        searchQuery.endDateTime = msgRef.receivedDateTime.endTime;
    if (msgRef.receivedDateTime?.dayRange && !searchQuery.startDateTime) {
        // Grammar matching may deliver a CalendarDayRangeValue object (asISORange method);
        // LLM path always delivers a plain string. Handle both via duck typing.
        const dr = msgRef.receivedDateTime.dayRange as unknown;
        const isoRange =
            dr !== null &&
            typeof dr === "object" &&
            "asISORange" in (dr as object)
                ? (
                      dr as {
                          asISORange(): { since?: string; before?: string };
                      }
                  ).asISORange()
                : parseDayRange(String(dr));
        if (isoRange.since) searchQuery.startDateTime = isoRange.since;
        if (isoRange.before) searchQuery.endDateTime = isoRange.before;
    }
    if (msgRef.srcFolder) searchQuery.folder = msgRef.srcFolder;

    const hasSearchCriteria =
        searchQuery.sender ||
        searchQuery.subject ||
        searchQuery.content ||
        searchQuery.startDateTime ||
        searchQuery.folder;

    if (!hasSearchCriteria) {
        // No specific search criteria — just show inbox
        displayStatus("Fetching inbox...", context);
        const messages = await emailProvider.getInbox(10);

        // Absorb inbox emails into kp index (incremental, in background)
        if (messages && messages.length > 0) {
            kpIndex.absorbEmails(messages).catch((e) => {
                debug("Background absorb failed: %s", e.message);
            });
        }

        if (!messages || messages.length === 0) {
            return "No emails found in inbox.";
        }
        const heading = `Inbox (${messages.length} messages):`;
        return buildStructuredEmailList(messages, heading);
    }

    // Provider search — primary path for all queries
    displayStatus("Searching emails...", context);
    // Use a higher limit for date-range fetches (e.g. weekly digest); 10 for targeted searches
    searchQuery.maxResults =
        searchQuery.maxResults || (searchQuery.startDateTime ? 100 : 10);
    const messages = await emailProvider.searchEmails(searchQuery);

    // Background: absorb results into kp index for async enrichment
    if (messages && messages.length > 0) {
        kpIndex.absorbEmails(messages).catch((e) => {
            debug("Background absorb failed: %s", e.message);
        });
    }

    if (!messages || messages.length === 0) {
        return "No emails found matching your search.";
    }

    // Content query: online RAG — convert emails to chunks and generate answer
    if (msgRef.content) {
        displayStatus(
            `Found ${messages.length} email(s), generating answer...`,
            context,
        );
        const answer = await generateOnlineAnswer(
            msgRef.content,
            messages,
            emailProvider,
        );
        if (answer && answer.chunksUsed > 0) {
            // Post-process: link email subjects in the answer HTML
            const answerHtml = linkEmailSubjects(answer.answer, messages);

            // Count linked titles already in the answer body
            const inlineLinks = (answerHtml.match(/<a\s+href=/gi) || []).length;

            // Build source links only if the answer doesn't already have 2+ inline links
            let sourceLinksHtml = "";
            if (inlineLinks < 2) {
                const sourceEmails = messages
                    .filter((m) => m.webLink)
                    .slice(0, 3);
                if (sourceEmails.length > 0) {
                    sourceLinksHtml = `<div style="margin-top:10px;padding-top:8px;border-top:1px solid #e0e0e0;font-size:12px;color:#666;">
<div style="margin-bottom:4px;">Sources:</div>
${sourceEmails
    .map((m) => {
        const from = m.from
            ? escapeHtml(m.from.name || m.from.address)
            : "Unknown";
        const subject = escapeHtml(m.subject);
        const date = m.receivedDateTime
            ? new Date(m.receivedDateTime).toLocaleDateString()
            : "";
        return `<div style="margin-left:8px;"><a href="${escapeHtml(m.webLink!)}" target="_blank" style="color:#4a9eda;text-decoration:none;">${subject}</a> <span style="color:#999;">— ${from}, ${date}</span></div>`;
    })
    .join("\n")}
</div>`;
                }
            }

            // answer.answer is HTML (from htmlOutput: true)
            const htmlContent = `<div style="font-family:-apple-system,sans-serif;font-size:13px;">
${answerHtml}
${sourceLinksHtml}
</div>`;

            // Strip HTML tags for plain text historyText
            let plainText = answer.answer;
            // Loop to handle nested constructs like <scr<script>ipt>
            let prev: string;
            do {
                prev = plainText;
                plainText = plainText.replace(/<[^>]*>/g, "");
            } while (plainText !== prev);
            // Remove any residual angle brackets
            plainText = plainText.replace(/[<>]/g, "");

            return createActionResultFromHtmlDisplay(htmlContent, plainText);
        }
        // Fallback: LLM answer generation failed, show email list
    }

    // Metadata-only query or RAG fallback: show email list
    const heading = `Found ${messages.length} email(s):`;
    return buildStructuredEmailList(messages, heading);
}

/**
 * Post-process RAG answer HTML to make email subjects clickable.
 * Scans the HTML for <em> tags (used for subjects per prompt instructions)
 * and plain-text subject mentions, and wraps them in links when a matching
 * email webLink is available.
 */
function linkEmailSubjects(html: string, messages: EmailMessage[]): string {
    // Build a map of subject → webLink (first match wins)
    const subjectLinks = new Map<string, string>();
    for (const m of messages) {
        if (m.webLink && m.subject) {
            const clean = m.subject
                .replace(/^(Re:\s*|Fwd:\s*|FW:\s*)+/i, "")
                .trim();
            if (clean.length > 10 && !subjectLinks.has(clean.toLowerCase())) {
                subjectLinks.set(clean.toLowerCase(), m.webLink);
            }
        }
    }

    if (subjectLinks.size === 0) return html;

    // First pass: link <em> tags that match known subjects
    html = html.replace(/<em>([^<]+)<\/em>/g, (match, inner) => {
        const normalized = inner.trim().toLowerCase();
        for (const [subject, link] of subjectLinks) {
            if (normalized.includes(subject) || subject.includes(normalized)) {
                return `<a href="${escapeHtml(link)}" target="_blank" style="color:#4a9eda;text-decoration:none;font-style:italic;">${inner}</a>`;
            }
        }
        return match;
    });

    // Second pass: link remaining unlinked subject mentions in plain text.
    // Only replace once per subject, and skip if already inside a link.
    for (const [subject, link] of subjectLinks) {
        const escapedSubject = subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const idx = html.search(new RegExp(escapedSubject, "i"));
        if (idx === -1) continue;

        // Check if this occurrence is already inside an <a> tag
        const before = html.slice(0, idx);
        const lastOpenA = before.lastIndexOf("<a ");
        const lastCloseA = before.lastIndexOf("</a>");
        if (lastOpenA > lastCloseA) continue; // inside a link already

        const matchText = html
            .slice(idx)
            .match(new RegExp(escapedSubject, "i"))![0];
        html =
            html.slice(0, idx) +
            `<a href="${escapeHtml(link)}" target="_blank" style="color:#4a9eda;text-decoration:none;">${matchText}</a>` +
            html.slice(idx + matchText.length);
    }

    return html;
}

// =========================================================================
// Background Index Lifecycle
// =========================================================================

/**
 * Create a progress callback that sends notifications via SessionContext.
 */
function makeNotifyProgress(ctx: EmailActionContext): IndexProgressCallback {
    return (message: string) => {
        debug("index progress: %s", message);
        ctx.sessionContext?.notify(
            AppAgentEvent.Info,
            `[Email Index] ${message}`,
        );
    };
}

/**
 * Build the initial index in the background (first login, no existing index).
 * Non-blocking: fires and forgets; sends progress via notify().
 */
function startBackgroundInitialIndex(ctx: EmailActionContext): void {
    if (ctx.indexingInProgress || !ctx.emailProvider) return;
    ctx.indexingInProgress = true;

    const provider = ctx.emailProvider;
    const kpIndex = ctx.kpIndex;
    const onProgress = makeNotifyProgress(ctx);

    onProgress("Starting initial email index build...");

    kpIndex
        .indexEmails(provider, onProgress)
        .then((stats) => {
            onProgress(
                `Initial index complete: ${stats.chunkCount} chunks, ${stats.termCount} terms.`,
            );
            // After initial build, start one backfill batch
            return runBackfillBatch(ctx);
        })
        .catch((e) => {
            debug("Background initial index failed: %s", e.message);
            ctx.sessionContext?.notify(
                AppAgentEvent.Warning,
                `[Email Index] Initial build failed: ${e.message}`,
            );
        })
        .finally(() => {
            ctx.indexingInProgress = false;
        });
}

/**
 * Forward sync + backfill in background (session start with existing index).
 * Non-blocking: fires and forgets; sends progress via notify().
 */
function startBackgroundSync(ctx: EmailActionContext): void {
    if (ctx.indexingInProgress || !ctx.emailProvider) return;
    ctx.indexingInProgress = true;

    const provider = ctx.emailProvider;
    const kpIndex = ctx.kpIndex;
    const onProgress = makeNotifyProgress(ctx);

    kpIndex
        .syncForward(provider, onProgress)
        .then(() => {
            // After forward sync, run one backfill batch
            return runBackfillBatch(ctx);
        })
        .catch((e) => {
            debug("Background sync failed: %s", e.message);
            ctx.sessionContext?.notify(
                AppAgentEvent.Warning,
                `[Email Index] Sync failed: ${e.message}`,
            );
        })
        .finally(() => {
            ctx.indexingInProgress = false;
        });
}

/**
 * Run a single backfill batch. Called after forward sync completes.
 */
async function runBackfillBatch(ctx: EmailActionContext): Promise<void> {
    if (!ctx.emailProvider || !ctx.kpIndex.canBackfill) return;

    const onProgress = makeNotifyProgress(ctx);

    try {
        await ctx.kpIndex.backfillBatch(
            ctx.emailProvider,
            undefined,
            onProgress,
        );
    } catch (e: any) {
        debug("Backfill batch failed: %s", e.message);
    }
}
