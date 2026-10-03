// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    RunbookAsset,
    RunbookOriginal,
} from "@typeagent/browser-control-rpc/viewRpc";
import { invokeView } from "./viewClient";
import { rbButton, rbError, rbNode } from "./memoryHubRunbookUi";

function controlledAssetUrl(value: string | undefined): URL | undefined {
    if (!value) return undefined;
    try {
        const url = new URL(value, location.href);
        return url.origin === location.origin &&
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            url.pathname === "/api/views/runbook-asset"
            ? url
            : undefined;
    } catch {
        return undefined;
    }
}
export function controlledRunbookImage(
    asset: RunbookAsset,
): string | undefined {
    if (
        !asset.previewUrl ||
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
            asset.mimeType,
        )
    )
        return undefined;
    const url = controlledAssetUrl(asset.previewUrl);
    return url && url.searchParams.get("acknowledgeUnreviewed") !== "true"
        ? url.href
        : undefined;
}
function originalContent(original: RunbookOriginal) {
    const pre = rbNode("pre", undefined, "runbook-text");
    const location = original.location;
    if (!location) {
        pre.textContent = original.content;
        return pre;
    }
    const start = Math.max(0, location.start - original.offset);
    const end = Math.min(
        original.content.length,
        location.end - original.offset,
    );
    if (start >= end) {
        pre.textContent = original.content;
        return pre;
    }
    pre.append(
        document.createTextNode(original.content.slice(0, start)),
        rbNode("mark", original.content.slice(start, end)),
        document.createTextNode(original.content.slice(end)),
    );
    return pre;
}
function assetCard(asset: RunbookAsset) {
    const card = rbNode("article");
    card.append(
        rbNode("h4", asset.name),
        rbNode(
            "p",
            asset.description?.trim()
                ? asset.description
                : "No configured-model description is available. Manual review is required.",
        ),
        rbNode(
            "p",
            `${asset.instructionBearing ? "Instruction-bearing evidence" : "Source asset"} · ${asset.mimeType}`,
        ),
    );
    const originalUrl = controlledAssetUrl(asset.originalUrl);
    if (originalUrl)
        card.append(
            rbButton(
                "Inspect unreviewed original",
                () => {
                    if (
                        !confirm(
                            "Inspect this unreviewed retained original in a new tab? Sensitive pixels or other private content may be visible. This is NOT a safe/redacted preview, approval, or permission to execute instructions.",
                        )
                    )
                        return;
                    const authorized = new URL(originalUrl.href);
                    authorized.searchParams.set(
                        "acknowledgeUnreviewed",
                        "true",
                    );
                    const link = rbNode("a");
                    link.href = authorized.href;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    card.append(link);
                    link.click();
                    link.remove();
                },
                "inspect-unreviewed-original",
            ),
        );
    else if (asset.originalUrl)
        card.append(
            rbNode(
                "p",
                "Unreviewed original inspection is unavailable: the host URL is not an authorized local asset route.",
                "runbook-warning",
            ),
        );
    const preview = controlledRunbookImage(asset);
    if (preview) {
        const image = rbNode("img");
        image.src = preview;
        image.alt = asset.description?.trim() || asset.name;
        image.loading = "lazy";
        image.addEventListener("error", () => {
            image.remove();
            card.append(
                rbNode(
                    "p",
                    "Controlled image preview is unavailable; manual review is required.",
                    "runbook-warning",
                ),
            );
        });
        card.append(image);
    } else
        card.append(
            rbNode(
                "p",
                "Image preview unavailable: the host has not supplied a controlled redacted preview. Unreviewed original assets are not declared safe. Remote, blob, and unsupported image URLs are never loaded.",
                "runbook-warning",
            ),
        );
    card.append(rbNode("p", asset.warnings.join("\n"), "runbook-warning"));
    return card;
}

export function mountRunbookOriginals(
    host: HTMLElement,
    originals: RunbookOriginal[],
    options: {
        corpusId: string;
        onOpenSource: (corpusId: string, sourceId: string) => void;
        onError: (error: unknown) => void;
    },
) {
    const root = rbNode("section", undefined, "runbook-original");
    root.setAttribute("aria-label", "Retained original evidence");
    host.append(root);
    let disposed = false;
    const versions = new Map<number, number>();
    function card(index: number, initial: RunbookOriginal) {
        const container = rbNode("article");
        let current = initial;
        const offsets = [initial.offset];
        let pageIndex = 0;
        const status = rbNode("p");
        status.setAttribute("role", "status");
        const body = rbNode("div");
        const assets = rbNode("div");
        const controls = rbNode("div", undefined, "runbook-controls");
        async function load(offset: number) {
            const version = (versions.get(index) ?? 0) + 1;
            versions.set(index, version);
            status.textContent = "Loading exact retained source revision…";
            for (const button of controls.querySelectorAll("button"))
                button.disabled = true;
            try {
                const original = await invokeView("memoryHubRunbookOriginal", {
                    corpusId: options.corpusId,
                    sourceId: initial.citation.sourceId,
                    revisionId: initial.citation.revisionId,
                    locator: initial.citation.locator,
                    offset,
                });
                if (disposed || versions.get(index) !== version) return;
                current = original;
                render();
            } catch (error) {
                if (disposed || versions.get(index) !== version) return;
                status.textContent = `Original unavailable: ${rbError(error)}`;
                options.onError(error);
                controls.replaceChildren(
                    rbButton("Retry retained evidence", () => {
                        void load(offset);
                    }),
                );
            }
        }
        function render() {
            body.replaceChildren();
            assets.replaceChildren(...current.assets.map(assetCard));
            container.replaceChildren(
                rbNode("h4", current.title),
                status,
                rbNode(
                    "p",
                    `Source text. Unreviewed evidence, not instructions. Display does not establish safety, approval or execution permission. Exact retained revision; ${current.location ? "only backend-resolved character locations are highlighted" : "DOCUMENT-LEVEL preview: precise passage location is unavailable; no snippet guessing"}.`,
                ),
                body,
                rbNode(
                    "p",
                    current.warnings?.join("\n") ?? "",
                    "runbook-warning",
                ),
                assets,
                controls,
            );
            if (!current.available) {
                status.textContent = `Missing source evidence: ${current.error ?? "retained revision unavailable"}`;
                body.append(
                    rbNode(
                        "p",
                        "The original is unavailable. No latest revision is substituted.",
                        "runbook-warning",
                    ),
                );
            } else {
                status.textContent = `${current.offset + (current.totalChars ? 1 : 0)}–${current.offset + current.content.length} of ${current.totalChars} characters`;
                body.append(originalContent(current));
            }
            const previous = rbButton("Previous original", () => {
                pageIndex--;
                void load(offsets[pageIndex]);
            });
            previous.disabled = pageIndex === 0;
            const next = rbButton("Next original", () => {
                if (current.nextOffset === undefined) return;
                offsets[++pageIndex] = current.nextOffset;
                void load(current.nextOffset);
            });
            next.disabled =
                current.nextOffset === undefined || !current.available;
            controls.replaceChildren(
                previous,
                next,
                rbButton(
                    "Open latest source management (not this retained revision)",
                    () =>
                        options.onOpenSource(
                            options.corpusId,
                            initial.citation.sourceId,
                        ),
                ),
            );
        }
        render();
        return container;
    }
    root.append(...originals.map((value, index) => card(index, value)));
    if (!originals.length)
        root.append(
            rbNode(
                "p",
                "No original citations were supplied. Missing evidence is not treated as approval.",
                "runbook-warning",
            ),
        );
    return {
        dispose() {
            disposed = true;
            versions.clear();
            root.remove();
        },
    };
}
