// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import DOMPurify from "dompurify";

let nextId = 0;
let loaded: Promise<typeof import("mermaid").default> | undefined;

function isDark(): boolean {
    const theme = document.documentElement.dataset.theme;
    if (theme) return theme === "dark";
    return (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
    );
}

// Imported content is untrusted, so diagrams use mermaid's strict security
// level (no click handlers, encoded label HTML) and plain SVG text labels.
let configuredTheme: string | undefined;
async function loadMermaid() {
    loaded ??= import("mermaid").then(({ default: mermaid }) => mermaid);
    const mermaid = await loaded;
    const theme = isDark() ? "dark" : "default";
    if (configuredTheme !== theme) {
        configuredTheme = theme;
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme,
            htmlLabels: false,
            flowchart: { htmlLabels: false },
        });
    }
    return mermaid;
}

// mermaid renders into shared state, so render one diagram at a time.
let queue: Promise<unknown> = Promise.resolve();

function renderNow(source: string): Promise<string> {
    return loadMermaid().then((mermaid) => renderWith(mermaid, source));
}

async function renderWith(
    mermaid: Awaited<ReturnType<typeof loadMermaid>>,
    source: string,
): Promise<string> {
    const id = `hub-mermaid-${nextId++}`;
    try {
        await mermaid.parse(source);
        const { svg } = await mermaid.render(id, source);
        return DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
        });
    } catch (error) {
        // mermaid leaves its error graphic in the document body.
        document.getElementById(`d${id}`)?.remove();
        throw error;
    }
}

export function renderMermaidSvg(source: string): Promise<string> {
    const result = queue.then(() => renderNow(source));
    queue = result.catch(() => undefined);
    return result;
}

function fillDiagram(target: HTMLElement, source: string): Promise<void> {
    return renderMermaidSvg(source).then(
        (svg) => {
            if (!target.isConnected) return;
            target.innerHTML = svg;
        },
        (error: unknown) => {
            if (!target.isConnected) return;
            const note = document.createElement("p");
            note.className = "hub-mermaid-error";
            note.textContent = `Diagram could not be rendered: ${error instanceof Error ? error.message : String(error)}`;
            target.append(note);
        },
    );
}

// Replaces ```mermaid blocks in rendered Markdown with diagrams. A block that
// fails to render stays visible as code with an error note.
export async function renderMermaidIn(root: HTMLElement): Promise<void> {
    const blocks = Array.from(
        root.querySelectorAll<HTMLElement>("pre > code.language-mermaid"),
    );
    await Promise.all(
        blocks.map(async (code) => {
            const pre = code.parentElement!;
            const figure = document.createElement("figure");
            figure.className = "hub-mermaid";
            figure.setAttribute("role", "img");
            figure.setAttribute("aria-label", "Mermaid diagram");
            pre.after(figure);
            await fillDiagram(figure, code.textContent ?? "");
            if (figure.querySelector("svg")) pre.remove();
            else figure.prepend(pre);
        }),
    );
}

// For the WYSIWYG editor. Crepe copies preview markup into its own panel as a
// string, so a diagram cannot be filled in later through the returned element.
// This returns cached markup when available, otherwise a placeholder that is
// replaced inside the editor once the render finishes.
export function createMermaidPreview(root: HTMLElement) {
    const cache = new Map<string, string>();
    const ids = new Map<string, number>();

    function replacePlaceholder(id: number, html: string, attempt = 0) {
        const found = root.querySelectorAll(`[data-mermaid-key="${id}"]`);
        for (const placeholder of found) placeholder.outerHTML = html;
        if (!found.length && attempt < 5)
            window.setTimeout(
                () => replacePlaceholder(id, html, attempt + 1),
                50,
            );
    }
    return (source: string): string => {
        const cached = cache.get(source);
        if (cached) return cached;
        let id = ids.get(source);
        if (id === undefined) {
            id = ids.size;
            ids.set(source, id);
            const key = id;
            void renderMermaidSvg(source).then(
                (svg) => {
                    const html = `<div class="hub-mermaid">${svg}</div>`;
                    cache.set(source, html);
                    replacePlaceholder(key, html);
                },
                (error: unknown) => {
                    const note = document.createElement("div");
                    note.className = "hub-mermaid hub-mermaid-error";
                    note.textContent = `Diagram could not be rendered: ${error instanceof Error ? error.message : String(error)}`;
                    cache.set(source, note.outerHTML);
                    replacePlaceholder(key, note.outerHTML);
                },
            );
        }
        return `<div class="hub-mermaid" data-mermaid-key="${id}">Rendering diagram…</div>`;
    };
}
