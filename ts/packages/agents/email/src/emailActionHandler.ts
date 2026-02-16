// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IEmailProvider,
    EmailMessage,
    EmailProviderType,
    EmailSearchQuery,
    createEmailProviderFromConfig,
    GoogleEmailClient,
} from "graph-utils";
import chalk from "chalk";
import {
    EmailAction,
    FindEmailAction,
    ForwardEmailAction,
    ReplyEmailAction,
} from "./emailActionsSchema.js";
import { generateNotes } from "typeagent";
import { openai } from "aiclient";
import {
    ActionContext,
    AppAgent,
    AppAgentEvent,
    SessionContext,
    TypeAgentAction,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultFromHtmlDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { ActionResultSuccess } from "@typeagent/agent-sdk";
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
            displayWarn(
                `Already logged in as ${user.displayName || "Unknown"}<${user.email || "Unknown"}>`,
                context,
            );
            return;
        }

        displayStatus(
            `Logging into ${providerType || "email"} service...`,
            context,
        );

        const success = await provider.login(
            (userCode, verificationUri, message) => {
                displayStatus(message, context);
            },
        );

        if (success) {
            const user = await provider.getUser();
            displaySuccess(
                `Successfully logged in as ${user.displayName || "Unknown"} <${user.email || "Unknown"}>`,
                context,
            );

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
        if (provider.logout()) {
            displaySuccess("Successfully logged out", context);
        } else {
            displayWarn("Already logged out", context);
        }
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
    };
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

    let result = await handleEmailAction(action, context);
    if (result) {
        // If handler already built an ActionResultSuccess, return it directly
        if (typeof result === "object") return result;
        return createActionResult(result);
    }
}

async function handleEmailAction(
    action: EmailAction,
    context: ActionContext<EmailActionContext>,
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
                to_addrs = await emailProvider.resolveUserEmails(expandedTo);
            }

            let cc_addrs: string[] | undefined = [];
            if (action.parameters.cc && action.parameters.cc.length > 0) {
                const expandedCc = await expandSelfReferences(
                    action.parameters.cc,
                    emailProvider,
                );
                cc_addrs = await emailProvider.resolveUserEmails(expandedCc);
            }

            let bcc_addrs: string[] | undefined = [];
            if (action.parameters.bcc && action.parameters.bcc.length > 0) {
                const expandedBcc = await expandSelfReferences(
                    action.parameters.bcc,
                    emailProvider,
                );
                bcc_addrs = await emailProvider.resolveUserEmails(expandedBcc);
            }

            let genContent: string = "";
            if (action.parameters.genContent.generateBody) {
                let query = action.parameters.genContent.bodySearchQuery;
                if (query) {
                    let result = await generateNotes(
                        query,
                        4096,
                        openai.createChatModel(
                            "GPT_35_TURBO",
                            undefined,
                            undefined,
                            ["emailActionHandler"],
                        ),
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
            res = await emailProvider.sendEmail(
                action.parameters.subject,
                emailBody,
                to_addrs,
                cc_addrs,
                bcc_addrs,
            );

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
    let msgRef = action.parameters.messageRef;
    if (msgRef) {
        // use the message reference to find the email to reply to
        console.log(chalk.green("Handling replyEmail action ..."));

        let senders: string[] | undefined = [];
        if (msgRef.senders && msgRef.senders.length > 0) {
            senders = await emailProvider.resolveUserEmails(msgRef.senders);
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
            let msg_id = await emailProvider.findEmail(searchQuery);

            if (msg_id) {
                let cc_addrs: string[] | undefined = [];
                if (action.parameters.cc && action.parameters.cc.length > 0) {
                    cc_addrs = await emailProvider.resolveUserEmails(
                        action.parameters.cc,
                    );
                }

                let bcc_addrs: string[] | undefined = [];
                if (action.parameters.bcc && action.parameters.bcc.length > 0) {
                    bcc_addrs = await emailProvider.resolveUserEmails(
                        action.parameters.bcc,
                    );
                }

                // reply to the email
                if (action.actionName === "replyEmail") {
                    let res = await emailProvider.replyToEmail(
                        msg_id,
                        action.parameters.body ?? "",
                        cc_addrs,
                        bcc_addrs,
                    );

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
                        to_addrs = await emailProvider.resolveUserEmails(
                            action.parameters.to,
                        );
                    }

                    let res = await emailProvider.forwardEmail(
                        msg_id,
                        action.parameters.additionalMessage ?? "",
                        to_addrs,
                        cc_addrs,
                        bcc_addrs,
                    );

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

function formatEmailListHtml(
    messages: EmailMessage[],
    heading: string,
): string {
    const rows = messages.map((msg) => {
        const from = msg.from
            ? escapeHtml(msg.from.name || msg.from.address)
            : "Unknown";
        const subject = escapeHtml(msg.subject);
        const date = msg.receivedDateTime
            ? new Date(msg.receivedDateTime).toLocaleDateString()
            : "";
        const preview = msg.bodyPreview
            ? escapeHtml(msg.bodyPreview.replace(/\s+/g, " ").trim().slice(0, 120))
            : "";
        const unread = msg.isRead === false;
        const borderColor = unread ? "#4a9eda" : "#ccc";
        const subjectWeight = unread ? "font-weight:bold;" : "";

        // Wrap subject in a link if webLink is available
        const subjectHtml = msg.webLink
            ? `<a href="${escapeHtml(msg.webLink)}" target="_blank" style="${subjectWeight}color:#1a1a1a;text-decoration:none;" title="Open in browser">${subject}</a>`
            : `<span style="${subjectWeight}">${subject}</span>`;

        return `<div style="border-left:3px solid ${borderColor};padding:6px 10px;margin-bottom:6px;background:#f8f9fa;">
  <div>${subjectHtml} <span style="color:#888;font-size:11px;">&middot; ${date}</span></div>
  <div style="color:#555;font-size:12px;">From: ${from}</div>
  ${preview ? `<div style="color:#777;font-size:12px;margin-top:2px;">${preview}</div>` : ""}
</div>`;
    });

    return `<div style="font-family:-apple-system,sans-serif;font-size:13px;">
<div style="color:#666;margin-bottom:8px;">${escapeHtml(heading)}</div>
${rows.join("\n")}
</div>`;
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

    const msgRef = action.parameters.messageRef;

    // Build provider search query from message reference
    const searchQuery: EmailSearchQuery = {};
    if (msgRef.senders && msgRef.senders.length > 0) {
        const expandedSenders = await expandSelfReferences(
            msgRef.senders,
            emailProvider,
        );
        const resolved = await emailProvider.resolveUserEmails(expandedSenders);
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
        return createActionResultFromHtmlDisplay(
            formatEmailListHtml(messages, heading),
            formatEmailListPlain(messages, heading),
        );
    }

    // Provider search — primary path for all queries
    displayStatus("Searching emails...", context);
    searchQuery.maxResults = searchQuery.maxResults || 10;
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
            let answerHtml = linkEmailSubjects(answer.answer, messages);

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
${sourceEmails.map((m) => {
    const from = m.from ? escapeHtml(m.from.name || m.from.address) : "Unknown";
    const subject = escapeHtml(m.subject);
    const date = m.receivedDateTime ? new Date(m.receivedDateTime).toLocaleDateString() : "";
    return `<div style="margin-left:8px;"><a href="${escapeHtml(m.webLink!)}" target="_blank" style="color:#4a9eda;text-decoration:none;">${subject}</a> <span style="color:#999;">— ${from}, ${date}</span></div>`;
}).join("\n")}
</div>`;
                }
            }

            // answer.answer is HTML (from htmlOutput: true)
            const htmlContent = `<div style="font-family:-apple-system,sans-serif;font-size:13px;">
${answerHtml}
${sourceLinksHtml}
</div>`;

            // Strip HTML tags for plain text historyText
            const plainText = answer.answer.replace(/<[^>]+>/g, "");

            return createActionResultFromHtmlDisplay(htmlContent, plainText);
        }
        // Fallback: LLM answer generation failed, show email list
    }

    // Metadata-only query or RAG fallback: show email list
    const heading = `Found ${messages.length} email(s):`;
    return createActionResultFromHtmlDisplay(
        formatEmailListHtml(messages, heading),
        formatEmailListPlain(messages, heading),
    );
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
            const clean = m.subject.replace(/^(Re:\s*|Fwd:\s*|FW:\s*)+/i, "").trim();
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

        const matchText = html.slice(idx).match(new RegExp(escapedSubject, "i"))![0];
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
