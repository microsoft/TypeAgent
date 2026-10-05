// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import "./memoryHubRunbookImports.css";
import { iconButton } from "./memoryHubUi";
import { invokeView } from "./viewClient";
import {
    runbookImportLimits,
    type RunbookImportFile,
    type RunbookImportKind,
    type RunbookImportRequest,
    type RunbookImportResponse,
    type RunbookImportBatch,
} from "@typeagent/browser-control-rpc/runbookImportViewTypes";
import type {
    MemoryBatchImport,
    RunbookJobResult,
} from "@typeagent/memory-service";

export interface MemoryHubRunbookImportsOptions {
    activityHost?: HTMLElement;
    scope: () => string | undefined;
    onError: (error: unknown) => void;
    onChanged: () => void | Promise<void>;
    onOpenRunbook?: (corpusId: string, candidateId: string) => void;
}
function node<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
}
function button(
    label: string,
    action: () => void,
    name?: string,
): HTMLButtonElement {
    const control = node("button", label);
    control.type = "button";
    if (name) control.name = name;
    control.onclick = action;
    return control;
}
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
function readSelectedFile(file: File): Promise<RunbookImportFile> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () =>
            reject(
                reader.error ??
                    new Error(`Cannot read selected file ${file.name}`),
            );
        reader.onabort = () =>
            reject(
                new Error(`Reading selected file ${file.name} was interrupted`),
            );
        reader.onload = () => {
            const result = reader.result;
            if (typeof result !== "string") {
                reject(
                    new Error("Selected file did not produce bounded bytes"),
                );
                return;
            }
            resolve({
                relativePath: file.webkitRelativePath || file.name,
                contentBase64: result.slice(result.indexOf(",") + 1),
                mimeType: file.type,
            });
        };
        reader.readAsDataURL(file);
    });
}
function assertSelectedFiles(files: File[]): void {
    if (!files.length || files.length > runbookImportLimits.selectedFiles)
        throw new Error(
            "Select 1-200 files, including local referenced images.",
        );
    const documents = files.filter(
        (file) => !/\.(?:png|jpe?g|gif|webp)$/i.test(file.name),
    );
    if (documents.length > runbookImportLimits.documents)
        throw new Error(
            "More than 50 documents selected. Split the batch before uploading.",
        );
    if (
        files.reduce((bytes, file) => bytes + file.size, 0) >
        runbookImportLimits.coreBytes
    )
        throw new Error(
            "Selected file bytes exceed 8 MB. Split the batch before uploading.",
        );
    if (
        files.some(
            (file) =>
                /\.(?:png|jpe?g|gif|webp)$/i.test(file.name) &&
                file.size > runbookImportLimits.revisionAssetBytes,
        )
    )
        throw new Error(
            "An image exceeds the 6 MB revision asset limit. No upload was started.",
        );
}
function assertUploadBody(request: RunbookImportRequest): void {
    const body = JSON.stringify({
        method: "memoryHubStartRunbookImport",
        params: request,
    });
    if (
        new TextEncoder().encode(body).byteLength >
        runbookImportLimits.gatewayBytes
    )
        throw new Error(
            "Encoded request exceeds the 10 MB gateway body limit. Split the batch before uploading.",
        );
}
function decodedFileText(file: RunbookImportFile): string {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        Uint8Array.from(atob(file.contentBase64), (character) =>
            character.charCodeAt(0),
        ),
    );
}
function htmlAttributeText(value: string): string {
    const entities: Record<string, string> = {
        amp: "&",
        quot: '"',
        apos: "'",
        lt: "<",
        gt: ">",
        nbsp: "\u00a0",
    };
    return value.replace(
        /&([a-z]+|#x[\da-f]+|#\d+);/gi,
        (whole: string, entity: string) => {
            if (!entity.startsWith("#")) {
                const name = entity.toLowerCase();
                return Object.hasOwn(entities, name) ? entities[name] : whole;
            }
            const hexadecimal = entity[1].toLowerCase() === "x";
            const code = Number.parseInt(
                entity.slice(hexadecimal ? 2 : 1),
                hexadecimal ? 16 : 10,
            );
            return code >= 0 && code <= 0x10ffff
                ? String.fromCodePoint(code)
                : whole;
        },
    );
}
function preflightImageReferences(content: string, html: boolean): string[] {
    if (html) {
        // Inert browser documents can load images, so read references without creating one.
        return Array.from(
            content.matchAll(
                /<img\b[^>]*?\s+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
            ),
            (match) => htmlAttributeText(match[1] ?? match[2] ?? match[3]),
        );
    }
    const references = Array.from(
        content.matchAll(
            /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g,
        ),
        (match) => match[1] ?? match[2],
    );
    const definitions = new Map(
        Array.from(
            content.matchAll(/^\s*\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm),
            (match) => [match[1].toLowerCase(), match[2] ?? match[3]],
        ),
    );
    for (const match of content.matchAll(/!\[([^\]]*)\]\[([^\]]*)\]/g)) {
        const reference = definitions.get((match[2] || match[1]).toLowerCase());
        if (reference) references.push(reference);
    }
    return references;
}
function preflightSelectedPath(
    documentPath: string,
    reference: string,
): string | undefined {
    if (/^(?:[a-z][a-z0-9+.-]*:|[/\\])/i.test(reference)) return undefined;
    let decoded: string;
    try {
        decoded = decodeURIComponent(reference.split(/[?#]/)[0]);
    } catch {
        return undefined;
    }
    if (/[\\:\0]/.test(decoded)) return undefined;
    const parts = documentPath.split("/").slice(0, -1);
    for (const part of decoded.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") {
            if (!parts.length) return undefined;
            parts.pop();
        } else parts.push(part);
    }
    if (documentPath.includes("/") && parts[0] !== documentPath.split("/")[0])
        return undefined;
    return parts.join("/");
}
function assertAcquiredFileBounds(
    request: Extract<RunbookImportRequest, { files: RunbookImportFile[] }>,
): void {
    const selected = new Map(
        request.files.map((file) => [file.relativePath, file]),
    );
    let serializedContentBytes = 0;
    for (const file of request.files.filter((file) =>
        /\.(?:md|markdown|html?|txt)$/i.test(file.relativePath),
    )) {
        const text = decodedFileText(file);
        const html = /\.html?$/i.test(file.relativePath);
        const references = preflightImageReferences(text, html);
        const images = new Map<string, RunbookImportFile>();
        for (const reference of references) {
            const path = preflightSelectedPath(file.relativePath, reference);
            const image = path ? selected.get(path) : undefined;
            if (image && /\.(?:png|jpe?g|gif|webp)$/i.test(image.relativePath))
                images.set(image.relativePath, image);
        }
        const imageBytes = Array.from(images.values()).reduce(
            (total, image) => total + atob(image.contentBase64).length,
            0,
        );
        if (
            imageBytes > runbookImportLimits.revisionAssetBytes ||
            images.size > 32
        )
            throw new Error(
                `Referenced images for ${file.relativePath} exceed 6 MB or 32 revision assets. Split the batch before uploading.`,
            );
        serializedContentBytes += new TextEncoder().encode(
            JSON.stringify(text),
        ).byteLength;
        for (const image of images.values())
            serializedContentBytes += new TextEncoder().encode(
                JSON.stringify({ batchAssetBytes: image.contentBase64 }),
            ).byteLength;
    }
    // This lower bound counts actual JSON escaping and repeated base64 asset bytes.
    // The service applies the final 8 MB gate including acquisition metadata.
    if (serializedContentBytes > runbookImportLimits.coreBytes)
        throw new Error(
            "Acquired source content and encoded assets exceed the 8 MB core limit. Split the batch before uploading.",
        );
}
function issueText(response: RunbookImportResponse): string {
    return [
        response.batch
            ? response.batch.members.every(
                  (member) => member.stage === "acquisition",
              )
                ? `Batch ${response.batch.batchId}: ${response.batch.state}. Acquisition was rejected; no documents were submitted.`
                : `Batch ${response.batch.batchId}: ${response.batch.state}. Acquired sources were submitted; this is not a promise of successful synthesis.`
            : "No batch was started.",
        ...(response.batch?.members.some(
            (member) => member.stage !== "acquisition",
        ) && response.acquisition.some((issue) => issue.state === "rejected")
            ? [
                  "Partial acquisition: supported sources were submitted; rejected selections were not imported.",
              ]
            : []),
        ...response.acquisition.map(
            (issue) => `${issue.state}: ${issue.member}: ${issue.reason}`,
        ),
        ...response.warnings,
    ].join("\n");
}
function ongoing(batch: MemoryBatchImport): boolean {
    return batch.state === "running" || batch.state === "cancelling";
}
function batchState(batch: MemoryBatchImport): string {
    return JSON.stringify([
        batch.state,
        batch.members
            .map((member) => [
                member.memberId,
                member.state,
                member.sourceId,
                member.revisionId,
                member.jobId,
            ])
            .sort((left, right) =>
                String(left[0]).localeCompare(String(right[0])),
            ),
    ]);
}
function observeStates<T>(
    items: T[],
    known: Map<string, string>,
    id: (item: T) => string,
    state: (item: T) => string,
    changedOnFirstObservation: (item: T) => boolean,
): boolean {
    const next = new Map<string, string>();
    let changed = false;
    for (const item of items) {
        const key = id(item);
        const snapshot = state(item);
        const previous = known.get(key);
        if (
            previous === undefined
                ? changedOnFirstObservation(item)
                : previous !== snapshot
        )
            changed = true;
        next.set(key, snapshot);
    }
    if (Array.from(known.keys()).some((key) => !next.has(key))) changed = true;
    known.clear();
    for (const [key, snapshot] of next) known.set(key, snapshot);
    return changed;
}
function jobState(job: RunbookJobResult): string {
    return JSON.stringify([job.state, [...job.candidateIds].sort()]);
}
function newImportKey(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
}

export function mountMemoryHubRunbookImports(
    host: HTMLElement,
    options: MemoryHubRunbookImportsOptions,
) {
    const root = node("section");
    root.className = "hub-runbook-imports";
    const dialog = node("dialog");
    dialog.className = "hub-runbook-import-dialog";
    dialog.setAttribute("aria-label", "Import Runbook sources");
    const title = node("h2", "Import Runbook sources");
    const targetLabel = node("label", "Named target corpus");
    const target = node("select");
    target.name = "runbook-import-target";
    target.required = true;
    targetLabel.append(target);
    const files = node("input");
    files.type = "file";
    files.multiple = true;
    files.name = "runbook-import-files";
    const fileLabel = node(
        "label",
        "Select exported source files and referenced local images",
    );
    fileLabel.append(files);
    const urls = node("textarea");
    urls.name = "runbook-import-urls";
    urls.rows = 6;
    const urlLabel = node("label", "Public HTTP(S) URLs, one per line");
    urlLabel.append(urls);
    const notice = node(
        "p",
        "Whole plain Markdown, HTML and text originals are retained. Only selected-tree PNG/JPEG/GIF/WebP references are attached; remote images, archives, host paths and authentication forwarding are unavailable. Classification/synthesis happens after commit. Configured image descriptions may be unavailable: manual review remains required. Import never executes tools or automations.",
    );
    const status = node("pre");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const start = button(
        "Start batch import",
        () => {
            void startImport();
        },
        "runbook-import-start",
    );
    const close = iconButton(
        "fa-xmark",
        "Close",
        () => dialog.close(),
        "close-dialog",
    );
    close.name = "runbook-import-close";
    const head = node("div");
    head.className = "hub-dialog-head";
    head.append(title, close);
    start.classList.add("primary");
    const help = node("details");
    help.className = "hub-help-block";
    help.append(
        node("summary", "How this import works"),
        notice,
        node(
            "p",
            "Durable recovery begins after the server admits a batch. Before admission, fetched URL content is not durably frozen; retry may fetch changed content. The request fingerprint identifies the selection, not a saved pre-admission snapshot.",
        ),
        node(
            "p",
            "Closing this dialog does not cancel a server operation. Use the real batch cancellation control in Activity after the batch is identified.",
        ),
    );
    dialog.append(head, targetLabel, fileLabel, urlLabel, help, start, status);
    const activity = node("section");
    activity.className = "hub-runbook-imports hub-runbook-import-activity";
    activity.hidden = true;
    const activityStatus = node("p");
    activityStatus.setAttribute("role", "status");
    const rows = node("div");
    const refresh = button(
        "Refresh durable batch activity",
        () => {
            void loadActivity();
        },
        "runbook-import-refresh",
    );
    activity.append(
        node("h2", "Runbook import activity"),
        refresh,
        activityStatus,
        rows,
    );
    root.append(dialog);
    (options.activityHost ?? root).append(activity);
    host.append(root);
    let kind: RunbookImportKind = "folder";
    let disposed = false;
    let generation = 0;
    let listSequence = 0;
    let busy = false;
    let currentScope = options.scope();
    let targetCorpus = currentScope;
    let idempotencyKey = newImportKey();
    let request: RunbookImportRequest | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activityPaused = false;
    const observedBatches = new Map<string, string>();
    const observedJobs = new Map<string, string>();
    const batchActions = new Set<string>();

    function current(epoch: number): boolean {
        return !disposed && epoch === generation;
    }
    function report(error: unknown, element: HTMLElement = status): void {
        if (disposed) return;
        element.textContent = `Unavailable or failed: ${errorMessage(error)}. No success is assumed.`;
        options.onError(error);
    }
    function resetRequest(): void {
        request = undefined;
        idempotencyKey = newImportKey();
        status.textContent = "";
    }
    function setBusy(value: boolean): void {
        busy = value;
        start.disabled = value;
        target.disabled = value;
        files.disabled = value;
        urls.disabled = value;
    }
    async function changed(): Promise<void> {
        if (disposed) return;
        try {
            await options.onChanged();
        } catch (error) {
            report(
                new Error(
                    `Server operation finished, but refreshing Memory Hub failed: ${errorMessage(error)}`,
                ),
                activityStatus,
            );
        }
    }
    function stopPolling(): void {
        clearTimeout(timer);
        timer = undefined;
    }

    async function loadTargets(epoch: number): Promise<void> {
        try {
            const corpora = await invokeView("memoryListCorpora");
            if (!current(epoch)) return;
            target.replaceChildren(
                node("option", "Choose a named target corpus"),
            );
            target.options[0].value = "";
            for (const corpus of corpora) {
                const option = node(
                    "option",
                    `${corpus.name} (${corpus.corpusId})`,
                );
                option.value = corpus.corpusId;
                target.append(option);
            }
            target.value = targetCorpus ?? "";
            if (!target.value) targetCorpus = undefined;
            start.disabled = busy || !target.value;
        } catch (error) {
            if (current(epoch)) report(error);
        }
    }

    async function buildRequest(
        corpusId: string,
    ): Promise<RunbookImportRequest> {
        if (kind === "urls") {
            const selected = urls.value
                .split(/\r?\n/)
                .map((url) => url.trim())
                .filter(Boolean);
            if (
                !selected.length ||
                selected.length > runbookImportLimits.documents
            )
                throw new Error(
                    "Enter 1-50 public URLs; nothing is silently truncated.",
                );
            for (const raw of selected) {
                const url = new URL(raw);
                if (
                    !["http:", "https:"].includes(url.protocol) ||
                    url.username ||
                    url.password
                )
                    throw new Error(
                        "Only credential-free HTTP(S) URLs are accepted.",
                    );
            }
            return { corpusId, idempotencyKey, kind, urls: selected };
        }
        const selected = Array.from(files.files ?? []);
        assertSelectedFiles(selected);
        const acquired: RunbookImportFile[] = [];
        for (const file of selected)
            acquired.push(await readSelectedFile(file));
        return { corpusId, idempotencyKey, kind, files: acquired };
    }

    async function startImport(): Promise<void> {
        if (busy || disposed) return;
        const corpusId = target.value;
        if (!corpusId) {
            report(
                new Error(
                    "Choose a named target corpus. All-corpora imports are unavailable.",
                ),
            );
            return;
        }
        const epoch = generation;
        setBusy(true);
        status.textContent = "Preparing bounded acquisition…";
        try {
            request ??= await buildRequest(corpusId);
            if (!current(epoch)) return;
            if (request.corpusId !== corpusId)
                throw new Error(
                    "Target changed; discard the old acquisition before uploading.",
                );
            assertUploadBody(request);
            if (request.kind !== "urls") assertAcquiredFileBounds(request);
            status.textContent =
                "Acquiring sources and creating a durable batch… If the response is lost, retry unchanged inputs with the same idempotency key or use Activity lookup. An admitted batch is recovered without refetching; before admission, URLs may be fetched again and may have changed.";
            const response = await invokeView(
                "memoryHubStartRunbookImport",
                request,
            );
            if (!current(epoch)) return;
            if (response.batch && response.batch.corpusId !== corpusId)
                throw new Error(
                    "Import response belongs to another target corpus.",
                );
            status.textContent = issueText(response);
            targetCorpus = corpusId;
            activity.hidden = false;
            if (response.batch) {
                files.value = "";
                urls.value = "";
                request = undefined;
                idempotencyKey = newImportKey();
                observedBatches.set(
                    response.batch.batchId,
                    batchState(response.batch),
                );
                await changed();
                if (current(epoch)) await loadActivity();
            }
        } catch (error) {
            if (current(epoch)) report(error);
        } finally {
            if (current(epoch)) setBusy(false);
        }
    }

    function memberRow(
        member: RunbookImportBatch["members"][number],
    ): HTMLElement {
        const row = node(
            "li",
            `Member ${member.memberId}: ${member.title ?? member.displayName ?? "Document name unavailable"} · ${member.state}${member.duplicateOf ? ` (duplicate of ${member.duplicateOf})` : ""}`,
        );
        if (member.canonicalUri) row.append(node("p", member.canonicalUri));
        row.append(
            node(
                "p",
                `Source: ${member.sourceId ?? "not committed"} · revision: ${member.revisionId ?? "none"} · ingestion job: ${member.jobId ?? "none"}`,
            ),
        );
        if (member.reason) row.append(node("p", member.reason));
        for (const warning of member.warnings) row.append(node("p", warning));
        return row;
    }

    async function batchAction(
        batch: MemoryBatchImport,
        action: "retry" | "cancel",
    ): Promise<void> {
        if (disposed || activityPaused || batchActions.has(batch.batchId))
            return;
        if (targetCorpus !== batch.corpusId) {
            report(
                new Error("Batch target does not match the selected corpus."),
                activityStatus,
            );
            return;
        }
        const epoch = generation;
        batchActions.add(batch.batchId);
        activityStatus.textContent =
            action === "cancel"
                ? "Requesting real cancellation; committed sources remain. Awaiting server confirmation…"
                : "Retrying failed/interrupted/cancelled members from their durable acquired originals…";
        try {
            const result =
                action === "cancel"
                    ? await invokeView("memoryHubCancelRunbookBatch", {
                          corpusId: batch.corpusId,
                          batchId: batch.batchId,
                      })
                    : await invokeView("memoryHubRetryRunbookBatch", {
                          corpusId: batch.corpusId,
                          batchId: batch.batchId,
                      });
            if (!current(epoch)) return;
            if (
                result.corpusId !== batch.corpusId ||
                result.batchId !== batch.batchId
            )
                throw new Error(
                    "Batch action returned another target or batch.",
                );
            activityStatus.textContent = `Server batch state: ${result.state}.`;
            observedBatches.set(result.batchId, batchState(result));
            await changed();
            if (current(epoch)) await loadActivity();
        } catch (error) {
            if (current(epoch)) report(error, activityStatus);
        } finally {
            batchActions.delete(batch.batchId);
        }
    }

    function batchRow(batch: RunbookImportBatch): HTMLElement {
        const card = node("article");
        card.append(
            node("h3", `${batch.batchId}: ${batch.state}`),
            node(
                "p",
                `Target corpus: ${batch.corpusId} · updated: ${batch.updatedAt}`,
            ),
            node(
                "p",
                `Members: ${batch.members.length} · completed: ${batch.members.filter((member) => member.state === "complete").length} · duplicates: ${batch.members.filter((member) => member.state === "duplicate").length} · failed: ${batch.members.filter((member) => member.state === "failed").length} · interrupted: ${batch.members.filter((member) => member.state === "interrupted").length} · cancelled: ${batch.members.filter((member) => member.state === "cancelled").length}`,
            ),
        );
        const members = node("ul");
        members.append(...batch.members.map(memberRow));
        card.append(members);
        for (const warning of batch.warnings ?? [])
            card.append(node("p", warning));
        for (const issue of batch.acquisitionIssues ?? []) {
            if (issue.state !== "warning") continue;
            const member = batch.members.find(
                (member) =>
                    member.clientKey === issue.member ||
                    member.memberId === issue.member,
            );
            card.append(
                node(
                    "p",
                    `Acquisition warning for ${member?.title ?? member?.displayName ?? issue.member}: ${issue.reason}`,
                ),
            );
        }
        if (
            batch.members.some(
                (member) =>
                    member.stage === "acquisition" && member.state === "failed",
            )
        )
            card.append(
                node(
                    "p",
                    "Acquisition rejections were not imported. Correct those sources and start a new batch; batch retry never reacquires files or URLs.",
                ),
            );
        if (ongoing(batch)) {
            const cancel = button("Request batch cancellation", () => {
                void batchAction(batch, "cancel");
            });
            cancel.disabled = batchActions.has(batch.batchId);
            card.append(cancel);
        }
        if (
            !ongoing(batch) &&
            batch.members.some(
                (member) =>
                    member.stage !== "acquisition" &&
                    ["failed", "interrupted", "cancelled"].includes(
                        member.state,
                    ),
            )
        ) {
            const retry = button(
                "Retry failed/interrupted/cancelled members",
                () => {
                    void batchAction(batch, "retry");
                },
            );
            retry.disabled = batchActions.has(batch.batchId);
            card.append(retry);
        }
        return card;
    }
    const synthesisActions = new Set<string>();
    async function retrySynthesis(
        job: RunbookJobResult,
        control: HTMLButtonElement,
    ): Promise<void> {
        const key = JSON.stringify([
            job.corpusId,
            job.sourceId,
            job.revisionId,
        ]);
        if (disposed || activityPaused || synthesisActions.has(key)) return;
        if (targetCorpus !== job.corpusId) {
            report(
                new Error("Job target does not match the selected corpus."),
                activityStatus,
            );
            return;
        }
        const epoch = generation;
        synthesisActions.add(key);
        control.disabled = true;
        activityStatus.textContent =
            "Requesting post-commit synthesis from the exact retained active revision; no sources are reacquired or re-ingested…";
        let refreshActivity = false;
        try {
            const result = await invokeView("memoryHubRetryRunbookSynthesis", {
                corpusId: job.corpusId,
                sourceId: job.sourceId,
                revisionId: job.revisionId,
            });
            if (!current(epoch) || activityPaused) return;
            if (
                result.corpusId !== job.corpusId ||
                result.sourceId !== job.sourceId ||
                result.revisionId !== job.revisionId
            )
                throw new Error(
                    "Synthesis retry returned another target or source revision.",
                );
            observedJobs.set(result.jobId, jobState(result));
            activityStatus.textContent = `Server synthesis job ${result.jobId}: ${result.state}.`;
            await changed();
            refreshActivity = true;
        } catch (error) {
            if (current(epoch) && !activityPaused)
                report(error, activityStatus);
        } finally {
            synthesisActions.delete(key);
            control.disabled = false;
        }
        if (refreshActivity && current(epoch) && !activityPaused)
            await loadActivity();
    }
    function jobRow(
        job: RunbookJobResult,
        batches: MemoryBatchImport[],
    ): HTMLElement {
        const card = node("article");
        const linked = batches
            .filter((batch) =>
                batch.members.some(
                    (member) =>
                        member.sourceId === job.sourceId &&
                        member.revisionId === job.revisionId,
                ),
            )
            .map((batch) => batch.batchId);
        card.append(
            node("h3", `Post-commit Runbook job ${job.jobId}: ${job.state}`),
            node(
                "p",
                `Source ${job.sourceId} · revision ${job.revisionId} · batches: ${linked.join(", ") || "no acquired batch link"}`,
            ),
            node(
                "p",
                `Classification: ${job.classification ?? "pending/unavailable"}${job.confidence === undefined ? "" : ` · confidence ${job.confidence}`}`,
            ),
        );
        if (job.reason) card.append(node("p", job.reason));
        for (const warning of job.warnings) card.append(node("p", warning));
        card.append(
            node(
                "p",
                "Post-commit synthesis cancellation is unavailable. Batch retry/cancellation affects acquired ingestion members only. Synthesis retry requires this exact retained active revision and current corpus detection/agent-edition preferences; stale revisions must be compared with the current active revision.",
            ),
        );
        if (["failed", "interrupted", "cancelled"].includes(job.state)) {
            const retry = button("Retry post-commit synthesis", () => {
                void retrySynthesis(job, retry);
            });
            retry.disabled = synthesisActions.has(
                JSON.stringify([job.corpusId, job.sourceId, job.revisionId]),
            );
            card.append(retry);
        }
        for (const candidateId of job.candidateIds) {
            if (options.onOpenRunbook)
                card.append(
                    button(`Review Runbook ${candidateId}`, () => {
                        if (
                            !disposed &&
                            !activityPaused &&
                            targetCorpus === job.corpusId
                        )
                            options.onOpenRunbook?.(job.corpusId, candidateId);
                    }),
                );
            else card.append(node("p", `Detected candidate: ${candidateId}`));
        }
        return card;
    }

    async function loadActivity(): Promise<void> {
        stopPolling();
        const corpusId = targetCorpus ?? options.scope();
        if (disposed || activityPaused || activity.hidden) return;
        if (!corpusId) {
            rows.replaceChildren();
            activityStatus.textContent =
                "Select a named corpus to look up durable batches and jobs.";
            return;
        }
        const epoch = generation;
        const sequence = ++listSequence;
        activityStatus.textContent = `Loading durable batches and post-commit jobs for ${corpusId}…`;
        try {
            const [batches, jobs] = await Promise.all([
                invokeView("memoryHubRunbookBatches", { corpusId }),
                invokeView("memoryHubRunbookJobs", { corpusId }),
            ]);
            if (!current(epoch) || activityPaused || sequence !== listSequence)
                return;
            if (
                batches.some((batch) => batch.corpusId !== corpusId) ||
                jobs.some((job) => job.corpusId !== corpusId)
            )
                throw new Error(
                    "Activity returned items from another target corpus.",
                );
            activityStatus.textContent = `Returned records (up to the latest 100 each for this corpus): ${batches.length} durable batches; ${jobs.length} post-commit jobs. These are bounded results, not corpus totals. Ingestion completion is distinct from classification/synthesis. Interrupted ingestion members require explicit retry.`;
            rows.replaceChildren(
                ...batches.map(batchRow),
                ...jobs.map((job) => jobRow(job, batches)),
            );
            if (!jobs.length)
                rows.append(
                    node(
                        "p",
                        "No post-commit jobs are available. Enable corpus how-to detection and Runbook agent-edition preferences to request synthesis; image descriptions require a configured multimodal provider.",
                    ),
                );
            const batchesChanged = observeStates(
                batches,
                observedBatches,
                (batch) => batch.batchId,
                batchState,
                (batch) => !ongoing(batch),
            );
            const jobsChanged = observeStates(
                jobs,
                observedJobs,
                (job) => job.jobId,
                jobState,
                () => true,
            );
            if (batchesChanged || jobsChanged) await changed();
            if (!current(epoch) || activityPaused || sequence !== listSequence)
                return;
            if (
                batches.some(ongoing) ||
                jobs.some((job) => job.state === "running")
            )
                timer = setTimeout(() => {
                    void loadActivity();
                }, 2000);
        } catch (error) {
            if (current(epoch) && sequence === listSequence)
                report(error, activityStatus);
        }
    }

    function discardChanges(): boolean {
        if (busy) {
            report(
                new Error(
                    "Wait for acquisition to return. Closing the dialog does not cancel it.",
                ),
            );
            return false;
        }
        if (
            (request || files.files?.length || urls.value.trim()) &&
            !confirm(
                "Discard selected unsent Runbook sources? Durable batches and jobs remain unchanged.",
            )
        )
            return false;
        files.value = "";
        urls.value = "";
        resetRequest();
        if (dialog.open) dialog.close();
        return true;
    }
    function open(selectedKind: RunbookImportKind): void {
        if (disposed) return;
        if (busy) {
            if (!dialog.open) dialog.showModal();
            return;
        }
        if (selectedKind !== kind && !discardChanges()) return;
        kind = selectedKind;
        title.textContent = `Import ${kind === "urls" ? "URL list" : kind === "wiki" ? "wiki export" : "selected folder"} as Runbook sources`;
        fileLabel.hidden = kind === "urls";
        urlLabel.hidden = kind !== "urls";
        if (kind !== "urls") files.setAttribute("webkitdirectory", "");
        else files.removeAttribute("webkitdirectory");
        if (!dialog.open) dialog.showModal();
        void loadTargets(generation);
    }
    target.onchange = () => {
        if (busy || disposed) return;
        generation++;
        stopPolling();
        resetRequest();
        observedBatches.clear();
        observedJobs.clear();
        targetCorpus = target.value || undefined;
        start.disabled = !targetCorpus;
        if (!activity.hidden) void loadActivity();
    };
    files.onchange = resetRequest;
    urls.oninput = resetRequest;
    return {
        open,
        showActivity(): void {
            if (disposed) return;
            activityPaused = false;
            activity.hidden = false;
            void loadActivity();
        },
        pauseActivity(): void {
            activityPaused = true;
            listSequence++;
            stopPolling();
        },
        hideActivity(): void {
            activityPaused = true;
            listSequence++;
            stopPolling();
            activity.hidden = true;
        },
        scopeChanged(): void {
            if (disposed) return;
            const scope = options.scope();
            if (scope === currentScope) return;
            currentScope = scope;
            generation++;
            stopPolling();
            targetCorpus = options.scope();
            observedBatches.clear();
            observedJobs.clear();
            request = undefined;
            idempotencyKey = newImportKey();
            files.value = "";
            urls.value = "";
            rows.replaceChildren();
            setBusy(false);
            if (dialog.open) {
                status.textContent =
                    "Scope changed; unsent selections cleared. Existing durable batches were not cancelled.";
                void loadTargets(generation);
            }
            if (!activity.hidden) void loadActivity();
        },
        discardChanges,
        dispose(): void {
            if (disposed) return;
            disposed = true;
            observedBatches.clear();
            observedJobs.clear();
            generation++;
            stopPolling();
            target.onchange = null;
            files.onchange = null;
            urls.oninput = null;
            start.onclick = null;
            close.onclick = null;
            refresh.onclick = null;
            if (dialog.open) dialog.close();
            dialog.remove();
            activity.remove();
            root.remove();
        },
    };
}
