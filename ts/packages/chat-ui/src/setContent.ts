// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AnsiUp } from "ansi_up";
import {
    DisplayAppendMode,
    DisplayContent,
    DisplayType,
    DisplayMessageKind,
    MessageContent,
    StructuredBlock,
    StructuredContent,
    TableBlock,
    TableCell,
    BadgeTone,
} from "@typeagent/agent-sdk";
import {
    getContentForType,
    isStructuredContent,
} from "@typeagent/agent-sdk/helpers/display";
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { PlatformAdapter, ChatSettingsView } from "./platformAdapter.js";

const ansiUpTextToHtml = new AnsiUp();
ansiUpTextToHtml.use_classes = true;
const ansiUpMarkdownToHtml = new AnsiUp();
ansiUpMarkdownToHtml.use_classes = true;
ansiUpMarkdownToHtml.escape_html = false;

// ---------------------------------------------------------------------------
// Structured-content HTML renderer (Phase 3a)
// Converts a StructuredContent block document to an HTML string. DOMPurify
// sanitizes it at the final sink in setContent(), so string concatenation here
// is safe — we never set innerHTML before sanitization.
// ---------------------------------------------------------------------------

function esc(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function cellDisplayText(cell: TableCell): string {
    if (cell === null || cell === undefined) return "";
    if (typeof cell === "object") return cell.text;
    return String(cell);
}

function badgeClass(tone: BadgeTone | undefined): string {
    return `sc-badge sc-badge-${tone ?? "neutral"}`;
}

function renderTableCell(cell: TableCell, colType: string | undefined): string {
    const text = cellDisplayText(cell);
    const obj = typeof cell === "object" && cell !== null ? cell : null;
    const href = obj?.href ?? undefined;
    const badge = obj?.badge ?? undefined;
    const tooltip = obj?.tooltip ? ` title="${esc(obj.tooltip)}"` : "";
    const effectiveType = badge ? "badge" : href ? "link" : (colType ?? "text");

    switch (effectiveType) {
        case "link":
            if (href) {
                return `<a href="${esc(href)}" target="_blank"${tooltip}>${esc(text)}</a>`;
            }
            return esc(text);
        case "badge": {
            const tone = badge ?? "neutral";
            return `<span class="${esc(badgeClass(tone))}"${tooltip}>${esc(text)}</span>`;
        }
        case "code":
            return `<code${tooltip}>${esc(text)}</code>`;
        case "number":
            return `<span class="sc-cell-number"${tooltip}>${esc(text)}</span>`;
        case "date":
            return `<span class="sc-cell-date"${tooltip}>${esc(text)}</span>`;
        default:
            return tooltip ? `<span${tooltip}>${esc(text)}</span>` : esc(text);
    }
}

function renderTableBlock(block: TableBlock): string {
    const { columns, rows, caption, sortable, filterable, readonly, pageSize } =
        block;
    const sortAttr =
        !readonly && sortable !== false ? ' data-sc-sortable="true"' : "";
    const filterAttr =
        !readonly && filterable ? ' data-sc-filterable="true"' : "";
    const paginate =
        typeof pageSize === "number" && pageSize > 0 && rows.length > pageSize;
    const pageAttr = paginate ? ` data-sc-page-size="${pageSize}"` : "";
    const parts: string[] = [
        `<div class="sc-table-wrap"><table class="sc-table"${sortAttr}${filterAttr}${pageAttr}>`,
    ];
    if (caption) {
        parts.push(`<caption class="sc-caption">${esc(caption)}</caption>`);
    }
    parts.push("<thead><tr>");
    for (const col of columns) {
        const align = col.align ? ` style="text-align:${esc(col.align)}"` : "";
        const colSortable =
            !readonly && (col.sortable ?? sortable ?? true) !== false;
        const sortBtn = colSortable
            ? ` <button class="sc-sort-btn" aria-label="sort by ${esc(col.header)}" data-sc-col="${esc(col.id)}" tabindex="0">↕</button>`
            : "";
        parts.push(`<th scope="col"${align}>${esc(col.header)}${sortBtn}</th>`);
    }
    parts.push("</tr></thead><tbody>");
    for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri];
        // Rows beyond the first page start hidden; the "Show more" control
        // (wired in attachTableInteractivity) reveals them in batches.
        const hidden =
            paginate && ri >= pageSize! ? ' class="sc-row-hidden"' : "";
        parts.push(`<tr${hidden}>`);
        for (let ci = 0; ci < columns.length; ci++) {
            const col = columns[ci];
            const cell = row[ci] ?? "";
            const align = col.align
                ? ` style="text-align:${esc(col.align)}"`
                : "";
            parts.push(`<td${align}>${renderTableCell(cell, col.type)}</td>`);
        }
        parts.push("</tr>");
    }
    parts.push("</tbody></table>");
    if (paginate) {
        const remaining = rows.length - pageSize!;
        parts.push(
            `<button class="sc-show-more" data-sc-remaining="${remaining}">Show more (${remaining})</button>`,
        );
    }
    parts.push("</div>");
    return parts.join("");
}

function renderMarkdownToHtml(text: string): string {
    const md = new MarkdownIt({ html: true });
    const defaultRender =
        md.renderer.rules.link_open ||
        function (tokens: any, idx: any, options: any, _env: any, self: any) {
            return self.renderToken(tokens, idx, options);
        };
    md.renderer.rules.link_open = (
        tokens: any,
        idx: any,
        options: any,
        env: any,
        self: any,
    ) => {
        tokens[idx].attrSet("target", "_blank");
        return defaultRender(tokens, idx, options, env, self);
    };
    const rendered = md.render(text);
    return ansiUpMarkdownToHtml.ansi_to_html(rendered);
}

function renderTextBlock(
    block: Extract<StructuredBlock, { kind: "text" }>,
): string {
    const raw =
        typeof block.text === "string"
            ? block.text
            : Array.isArray(block.text) && typeof block.text[0] === "string"
              ? (block.text as string[]).join("\n")
              : (block.text as string[][])
                    .map((row) => row.join(" | "))
                    .join("\n");
    const fmt = block.format ?? "markdown";
    if (fmt === "text") {
        return `<p class="sc-text">${textToHtml(raw)}</p>`;
    }
    return `<div class="sc-text">${renderMarkdownToHtml(raw)}</div>`;
}

function renderListBlock(
    block: Extract<StructuredBlock, { kind: "list" }>,
): string {
    const tag = block.ordered ? "ol" : "ul";
    const items = block.items
        .map((item) => {
            const label = item.href
                ? `<a href="${esc(item.href)}" target="_blank">${esc(item.text)}</a>`
                : esc(item.text);
            const subtitle = item.subtitle
                ? ` <span class="sc-list-subtitle">${esc(item.subtitle)}</span>`
                : "";
            const badges = (item.badges ?? [])
                .map((tone) => {
                    const label = tone.charAt(0).toUpperCase() + tone.slice(1);
                    return `<span class="${esc(badgeClass(tone))}">${esc(label)}</span>`;
                })
                .join(" ");
            return `<li>${label}${subtitle}${badges ? " " + badges : ""}</li>`;
        })
        .join("");
    return `<${tag} class="sc-list">${items}</${tag}>`;
}

function renderCardBlock(
    block: Extract<StructuredBlock, { kind: "card" }>,
): string {
    const parts: string[] = [`<div class="sc-card">`];
    if (block.title) {
        const title = block.href
            ? `<a href="${esc(block.href)}" target="_blank">${esc(block.title)}</a>`
            : esc(block.title);
        parts.push(`<div class="sc-card-title">${title}</div>`);
    }
    if (block.subtitle) {
        parts.push(
            `<div class="sc-card-subtitle">${esc(block.subtitle)}</div>`,
        );
    }
    if (block.fields && block.fields.length > 0) {
        const rows = block.fields
            .map(
                (pair) =>
                    `<tr><th scope="row" class="sc-kv-label">${esc(pair.label)}</th>` +
                    `<td class="sc-kv-value">${renderTableCell(pair.value, undefined)}</td></tr>`,
            )
            .join("");
        parts.push(
            `<table class="sc-kv-table sc-card-fields"><tbody>${rows}</tbody></table>`,
        );
    }
    parts.push("</div>");
    return parts.join("");
}

function renderBlock(block: StructuredBlock): string {
    switch (block.kind) {
        case "heading": {
            const level = block.level ?? 1;
            return `<h${level} class="sc-heading sc-heading-${level}">${esc(block.text)}</h${level}>`;
        }
        case "text":
            return renderTextBlock(block);
        case "table":
            return renderTableBlock(block);
        case "list":
            return renderListBlock(block);
        case "keyValue": {
            const rows = block.pairs
                .map(
                    (pair) =>
                        `<tr><th scope="row" class="sc-kv-label">${esc(pair.label)}</th>` +
                        `<td class="sc-kv-value">${renderTableCell(pair.value, undefined)}</td></tr>`,
                )
                .join("");
            return `<table class="sc-kv-table"><tbody>${rows}</tbody></table>`;
        }
        case "card":
            return renderCardBlock(block);
        case "image": {
            const widthAttr = block.width ? ` width="${block.width}"` : "";
            const heightAttr = block.height ? ` height="${block.height}"` : "";
            const img = `<img src="${esc(block.src)}" alt="${esc(block.alt ?? "")}"${widthAttr}${heightAttr} class="sc-image">`;
            if (block.caption) {
                return `<figure class="sc-figure">${img}<figcaption class="sc-caption">${esc(block.caption)}</figcaption></figure>`;
            }
            return `<figure class="sc-figure">${img}</figure>`;
        }
        case "code":
            return `<pre class="sc-code"><code${block.language ? ` class="language-${esc(block.language)}"` : ""}>${esc(block.code)}</code></pre>`;
        case "divider":
            return `<hr class="sc-divider">`;
        default:
            return "";
    }
}

/**
 * Render a StructuredContent block document to an HTML string.
 * The result is passed through DOMPurify at the sink before being written to
 * the DOM, so concatenation here is safe.
 */
function renderStructuredContent(content: StructuredContent): string {
    return content.blocks.map(renderBlock).join("\n");
}

// ---------------------------------------------------------------------------
// Phase 4a — client-side sort + filter for sc-table elements
// ---------------------------------------------------------------------------

/**
 * Wire up sort buttons and filter inputs for every `.sc-table` found inside
 * `root`.  Called after innerHTML is written so the elements are live in the
 * DOM.
 */
function attachTableInteractivity(root: HTMLElement): void {
    root.querySelectorAll<HTMLTableElement>("table.sc-table").forEach(
        (table) => {
            const canSort = table.dataset.scSortable === "true";
            const canFilter = table.dataset.scFilterable === "true";
            const pageSize = parseInt(table.dataset.scPageSize ?? "", 10);
            const canPaginate = Number.isFinite(pageSize) && pageSize > 0;
            if (!canSort && !canFilter && !canPaginate) return;

            const tbody = table.querySelector<HTMLTableSectionElement>("tbody");
            if (!tbody) return;

            // Snapshot original row order so we can restore it on "none" sort.
            const originalRows = Array.from(
                tbody.querySelectorAll<HTMLTableRowElement>("tr"),
            );
            originalRows.forEach(
                (row, idx) => (row.dataset.scIdx = String(idx)),
            );

            // Per-table sort state.
            let sortColId: string | null = null;
            let sortDir: "asc" | "desc" | "none" = "none";

            // Per-table pagination state. `filtering` is shared so sort/filter
            // can suspend or re-apply the row cap. When a filter query is
            // active it takes precedence (all matches shown, cap suspended).
            let filtering = false;
            let visibleCount = canPaginate ? pageSize : Infinity;
            const wrapEl = table.closest<HTMLElement>(".sc-table-wrap");
            const showMoreBtn =
                wrapEl?.querySelector<HTMLButtonElement>(".sc-show-more") ??
                null;

            const applyPagination = () => {
                if (!canPaginate) return;
                const rows = Array.from(
                    tbody.querySelectorAll<HTMLTableRowElement>("tr"),
                );
                rows.forEach((row, i) => {
                    row.classList.toggle("sc-row-hidden", i >= visibleCount);
                });
                if (showMoreBtn) {
                    const remaining = Math.max(0, rows.length - visibleCount);
                    if (remaining > 0) {
                        showMoreBtn.textContent = `Show more (${remaining})`;
                        showMoreBtn.style.display = "";
                    } else {
                        showMoreBtn.style.display = "none";
                    }
                }
            };

            if (showMoreBtn) {
                showMoreBtn.addEventListener("click", () => {
                    visibleCount += pageSize;
                    applyPagination();
                });
            }

            if (canSort) {
                table
                    .querySelectorAll<HTMLButtonElement>(".sc-sort-btn")
                    .forEach((btn) => {
                        btn.addEventListener("click", () => {
                            const colId = btn.dataset.scCol ?? "";
                            // Cycle: none → asc → desc → none
                            if (sortColId !== colId) {
                                sortColId = colId;
                                sortDir = "asc";
                            } else if (sortDir === "asc") {
                                sortDir = "desc";
                            } else {
                                sortDir = "none";
                                sortColId = null;
                            }

                            // Update all sort-button icons in this table.
                            table
                                .querySelectorAll<HTMLButtonElement>(
                                    ".sc-sort-btn",
                                )
                                .forEach((b) => {
                                    if (b !== btn || sortDir === "none") {
                                        b.textContent = "↕";
                                        b.dataset.scSortDir = "none";
                                    } else {
                                        b.textContent =
                                            sortDir === "asc" ? "↑" : "↓";
                                        b.dataset.scSortDir = sortDir;
                                    }
                                });

                            const th = btn.closest<HTMLTableCellElement>("th");
                            if (!th) return;
                            const colIdx = th.cellIndex;

                            const rows = Array.from(
                                tbody.querySelectorAll<HTMLTableRowElement>(
                                    "tr",
                                ),
                            );
                            if (sortDir === "none") {
                                // Restore original order.
                                originalRows.forEach((row) =>
                                    tbody.appendChild(row),
                                );
                            } else {
                                rows.sort((a, b) => {
                                    const ca =
                                        a.cells[colIdx]?.textContent?.trim() ??
                                        "";
                                    const cb =
                                        b.cells[colIdx]?.textContent?.trim() ??
                                        "";
                                    const cmp = ca.localeCompare(
                                        cb,
                                        undefined,
                                        {
                                            numeric: true,
                                            sensitivity: "base",
                                        },
                                    );
                                    return sortDir === "asc" ? cmp : -cmp;
                                });
                                rows.forEach((row) => tbody.appendChild(row));
                            }
                            // Row order changed — re-apply the page cap so the
                            // first `visibleCount` rows in the new order show
                            // (unless a filter query is currently active).
                            if (!filtering) applyPagination();
                        });
                    });
            }

            if (canFilter) {
                const wrap = table.closest<HTMLElement>(".sc-table-wrap");
                const input = document.createElement("input");
                input.type = "text";
                input.placeholder = "Filter rows…";
                input.className = "sc-filter-input";
                // Insert the filter input before the table (or its wrapper).
                // `container` is null if neither a wrapper nor a parent exists.
                const container = wrap ?? table.parentElement;
                if (container) {
                    container.insertBefore(input, table);
                }

                input.addEventListener("input", () => {
                    const query = input.value.trim().toLowerCase();
                    filtering = query.length > 0;
                    tbody
                        .querySelectorAll<HTMLTableRowElement>("tr")
                        .forEach((row) => {
                            const text = row.textContent?.toLowerCase() ?? "";
                            row.classList.toggle(
                                "sc-row-filtered",
                                !!query && !text.includes(query),
                            );
                        });
                    if (filtering) {
                        // Filter overrides pagination: reveal all matches and
                        // hide the Show-more control while filtering.
                        tbody
                            .querySelectorAll<HTMLTableRowElement>("tr")
                            .forEach((r) =>
                                r.classList.remove("sc-row-hidden"),
                            );
                        if (showMoreBtn) showMoreBtn.style.display = "none";
                    } else {
                        // Query cleared — restore the page cap.
                        applyPagination();
                    }
                });
            }
        },
    );
}

function textToHtml(text: string): string {
    const value = ansiUpTextToHtml.ansi_to_html(text);
    const line = value.replace(/\n/gm, "<br>");
    return line;
}

function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function encodeTextToHtml(text: string): string {
    return text
        .replace(/&/gm, "&amp;")
        .replace(/</gm, "&lt;")
        .replace(/>/gm, "&gt;");
}

const enableText2Html = true;
function processContent(
    content: string,
    type: string,
    inline: boolean = false,
): string {
    switch (type) {
        case "iframe":
            return content;
        case "html":
            return DOMPurify.sanitize(content, {
                ADD_ATTR: ["target", "onclick", "onerror", "href"],
                ADD_DATA_URI_TAGS: ["img"],
                ADD_URI_SAFE_ATTR: ["src", "href"],
                ALLOWED_URI_REGEXP:
                    /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|typeagent-browser):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
            });
        case "markdown": {
            const md = new MarkdownIt({
                html: true,
            });
            // Links in the chat windows should open in a new tab.
            const defaultRender =
                md.renderer.rules.link_open ||
                function (tokens, idx, options, _env, self) {
                    return self.renderToken(tokens, idx, options);
                };
            md.renderer.rules.link_open = (tokens, idx, ...args) => {
                tokens[idx].attrSet("target", "_blank");
                return defaultRender(tokens, idx, ...args);
            };

            const renderedMarkdown = inline
                ? md.renderInline(content)
                : md.render(content);
            const withAnsi =
                ansiUpMarkdownToHtml.ansi_to_html(renderedMarkdown);

            return DOMPurify.sanitize(withAnsi, {
                ADD_ATTR: ["target", "onclick", "onerror", "href"],
                ADD_DATA_URI_TAGS: ["img"],
                ADD_URI_SAFE_ATTR: ["src", "href", "style"],
                ALLOWED_URI_REGEXP:
                    /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|typeagent-browser):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
            });
        }
        case "text":
            return enableText2Html
                ? textToHtml(content)
                : stripAnsi(encodeTextToHtml(content));
        default:
            throw new Error(`Invalid content type ${type}`);
    }
}

function matchKindStyle(elm: HTMLElement, kindStyle?: string) {
    if (kindStyle !== undefined) {
        return elm.classList.contains(kindStyle);
    }
    for (const cls of elm.classList) {
        if (cls.startsWith("chat-message-kind-")) {
            return false;
        }
    }
    return true;
}

function tableToMarkdown(table: string[][]): string {
    if (table.length === 0) {
        return "";
    }

    const rows: string[] = [];

    // Add header row
    if (table.length > 0) {
        rows.push("| " + table[0].join(" | ") + " |");

        // Add separator row
        const separators = table[0].map(() => "---");
        rows.push("| " + separators.join(" | ") + " |");
    }

    // Add data rows
    for (let i = 1; i < table.length; i++) {
        rows.push("| " + table[i].join(" | ") + " |");
    }

    return rows.join("\n");
}

function messageContentToHTML(
    message: MessageContent,
    type: DisplayType,
    inline: boolean,
): string {
    if (typeof message === "string") {
        return processContent(message, type, inline);
    }

    if (message.length === 0) {
        return "";
    }

    if (typeof message[0] === "string") {
        return processContent(
            (message as string[]).join(
                type === "html" || type === "iframe" ? "<br>" : "\n",
            ),
            type,
            inline,
        );
    }

    const table = message as string[][];

    // For text and markdown types, convert to markdown table
    if (type === "text" || type === "markdown") {
        const markdownTable = tableToMarkdown(table);
        return processContent(markdownTable, "markdown", inline);
    }

    // For HTML and iframe types, use HTML table
    return `<table class="table-message">${table.map((row, i) => `<tr>${row.map((cell) => `${i === 0 ? "<th>" : "<td>"}${processContent(cell, type)}${i === 0 ? "</th>" : "</td>"}`).join("")}</tr>`).join("")}</table>`;
}

// Copy a status badge's tooltip message to the clipboard, then show a brief
// "Copied!" confirmation anchored to the clicked badge. Uses the same
// clipboard API + graceful-failure handling as the message copy button in
// feedbackWidget.
async function copyStatusMessage(
    text: string,
    anchor: HTMLElement,
): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        console.warn("clipboard write failed", e);
        return;
    }
    showCopiedToast(anchor);
}

// Transient, self-removing "Copied!" toast centered just above `anchor`.
// Positioned in viewport coordinates (the CSS uses `position: fixed`).
function showCopiedToast(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const toast = document.createElement("div");
    toast.className = "chat-copied-toast";
    toast.setAttribute("role", "status");
    toast.textContent = "Copied!";
    toast.style.left = `${rect.left + rect.width / 2}px`;
    toast.style.top = `${rect.top}px`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1200);
}

/**
 * Render DisplayContent into a DOM element.
 *
 * This is the core rendering function shared between the Electron shell
 * and the Chrome extension chat panel. Platform-specific link handling
 * is delegated to the PlatformAdapter.
 */
export function setContent(
    elm: HTMLElement,
    content: DisplayContent,
    settingsView: ChatSettingsView,
    classNameModifier: string,
    platformAdapter: PlatformAdapter,
    appendMode?: DisplayAppendMode,
): string | undefined {
    // Remove existing content if we are not appending.
    if (appendMode === undefined) {
        while (elm.firstChild) {
            elm.removeChild(elm.firstChild);
        }
    }

    let type: DisplayType;
    let kind: DisplayMessageKind | undefined;
    let message: MessageContent;
    let speak: boolean;
    if (typeof content === "string" || Array.isArray(content)) {
        type = "text";
        message = content;
        speak = false;
    } else {
        if (isStructuredContent(content)) {
            // Phase 3a: render blocks natively as HTML.
            type = "html";
            message = renderStructuredContent(content);
        } else {
            // Prefer HTML alternates when available
            const htmlContent = getContentForType(content, "html");
            if (htmlContent !== undefined && content.type !== "html") {
                type = "html";
                message = htmlContent;
            } else {
                type = content.type;
                message = content.content;
            }
        }
        kind = content.kind;
        speak = content.speak ?? false;
    }

    if (!settingsView.isDisplayTypeAllowed(type)) {
        message = `The supplied content type (${type}) is not allowed by the configured settings.`;
        appendMode = "block";
        speak = false;
        kind = "error";
        type = "text";
    }

    const kindStyle = kind ? `chat-message-kind-${kind}` : undefined;

    let contentDiv = elm.lastChild as HTMLDivElement | null;
    let newDiv = true;
    if (
        appendMode !== "inline" ||
        !contentDiv ||
        !matchKindStyle(contentDiv, kindStyle)
    ) {
        // Create a new div
        contentDiv = document.createElement("div");
        if (kindStyle) {
            contentDiv.classList.add(kindStyle);
        }
        if (appendMode === "inline") {
            contentDiv.style.display = "inline-block";
        }
        elm.appendChild(contentDiv);
        newDiv = false;
    }

    let contentElm: HTMLElement = contentDiv;

    if (type === "text") {
        const prevElm = contentDiv.lastChild as HTMLElement | null;
        if (
            prevElm?.classList.contains(
                `chat-message-${classNameModifier}-text`,
            )
        ) {
            // If there is an existing text element then append to it.
            contentElm = prevElm;
        } else {
            const span = document.createElement("span");
            // create a text span so we can set "whitespace: break-spaces" css style of text content.
            span.className = `chat-message-${classNameModifier}-text`;
            contentDiv.appendChild(span);
            contentElm = span;
        }
    }

    // Process content according to type
    const contentHtml = messageContentToHTML(
        message,
        type,
        appendMode === "inline",
    );

    // if the agent wants to show script we need to do that in isolation so create an iframe
    // and put both the script and supplied HTML into it
    if (type === "iframe") {
        const iframe: HTMLIFrameElement = document.createElement("iframe");
        iframe.sandbox.add("allow-scripts");
        iframe.classList.add("host-frame");

        // use the same stylesheets as the main page
        let css: string = "";
        const links = document.head.getElementsByTagName("link");
        const promises: Promise<void>[] = [];
        for (let i = 0; i < links.length; i++) {
            if (links[i].rel.toLowerCase() == "stylesheet") {
                if (links[i].href.startsWith("./")) {
                    const l = links[i].cloneNode(true) as HTMLLinkElement;
                    l.href = window.location.origin + "/" + l.href;
                    css += l.outerHTML;
                } else if (links[i].href.startsWith("file:")) {
                    // Download the CSS
                    promises.push(
                        fetch(links[i].href)
                            .then((response) => response.text())
                            .then((text) => {
                                css += `<style>${text}</style>`;
                            }),
                    );
                } else {
                    css += links[i].outerHTML;
                }
            }
        }

        // after all stylesheets have been loaded craft the iframe source document
        Promise.all(promises).then(() => {
            iframe.srcdoc = `<html>
            <head>
            ${css}
            </head>
            <body style="height: auto; overflow: hidden; background: transparent;">${message}</body></html>`;
        });

        contentElm.appendChild(iframe);
    } else {
        // vanilla, sanitized HTML only — re-run DOMPurify at the sink so
        // CodeQL js/xss can recognize sanitization (the upstream
        // `processContent` already sanitizes html/markdown, but the data
        // flow through messageContentToHTML breaks the static analysis
        // chain).
        contentElm.innerHTML += DOMPurify.sanitize(contentHtml, {
            ADD_ATTR: ["target", "onclick", "onerror", "href"],
            ADD_DATA_URI_TAGS: ["img"],
            ADD_URI_SAFE_ATTR: ["src", "href", "style"],
            ALLOWED_URI_REGEXP:
                /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|typeagent-browser):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        });

        // Add click handlers for all links — delegated to platform adapter
        const allLinks = contentElm.querySelectorAll("a[href]");
        allLinks.forEach((link) => {
            const href = link.getAttribute("href");
            if (
                href &&
                (href.startsWith("typeagent-browser://") ||
                    href.startsWith("http://") ||
                    href.startsWith("https://"))
            ) {
                link.addEventListener("click", (e) => {
                    e.preventDefault();
                    const target = link.getAttribute("target");
                    platformAdapter.handleLinkClick(href, target);
                });
            }
        });

        // Phase 4a — wire sort + filter on any sc-table elements just added.
        attachTableInteractivity(contentElm);

        // Status badges (agent-status readiness/load indicators and other
        // tooltip-bearing status glyphs) stash their full message in a
        // `title` attribute. Make them click-to-copy so the (often long)
        // message can be grabbed without hand-selecting text. Re-bound on
        // every render — matching the link handling above — because the
        // `innerHTML +=` sink recreates these nodes on each append.
        const copyables =
            contentElm.querySelectorAll<HTMLElement>("span[title]");
        copyables.forEach((badge) => {
            badge.style.cursor = "pointer";
            badge.addEventListener("click", (e) => {
                const text = badge.getAttribute("title");
                if (!text) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                void copyStatusMessage(text, badge);
            });
        });
    }

    if (!speak) {
        return undefined;
    }
    if (type === "text") {
        if (typeof message === "string") {
            return stripAnsi(message);
        }
        if (message.length === 0) {
            return undefined;
        }
        if (typeof message[0] === "string") {
            return (message as string[]).join("\n");
        }
        return (message as string[][]).map((row) => row.join("\t")).join("\n");
    }

    if (newDiv) {
        return contentElm.innerText;
    }

    // Strip all HTML to plain text for TTS. Using DOMPurify with no
    // allowed tags is both safe and recognized by CodeQL as a sanitizer
    // (DOMParser-based extraction trips js/xss even though .body.innerText
    // never executes scripts).
    return DOMPurify.sanitize(contentHtml, {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: [],
    }) as string;
}

/**
 * Takes the "action-data" attribute from the source element and places it as the html
 * of the target element.
 */
export function swapContent(
    sourceElement: HTMLElement,
    targetElement: HTMLElement,
) {
    const data: string = sourceElement.getAttribute("action-data") ?? "";
    const originalMessage: string = targetElement.innerHTML;

    if (data.length === 0) {
        return;
    }

    if (targetElement.classList.contains("chat-message-action-data")) {
        targetElement.classList.remove("chat-message-action-data");
    } else {
        targetElement.classList.add("chat-message-action-data");
    }

    sourceElement.setAttribute("action-data", originalMessage);
    targetElement.innerHTML = data;
}
