// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { BrowserControl } from "@typeagent/browser-control-rpc/types";
import type { MemoryHubFunctions } from "@typeagent/browser-control-rpc/viewRpc";
import type { BrowserMemoryService } from "./browserMemoryService.mjs";
import { createExtractionInputsFromFragments } from "./knowledge/actions/extractionInputs.mjs";
import { timed } from "./memoryHubQuery.mjs";

function eligibleUrl(url: string, viewPort: number): boolean {
    const parsed = new URL(url);
    const loopback =
        parsed.hostname === "localhost" ||
        parsed.hostname.endsWith(".localhost") ||
        /^127\./.test(parsed.hostname) ||
        parsed.hostname === "[::1]";
    const port = Number(
        parsed.port || (parsed.protocol === "https:" ? 443 : 80),
    );
    return (
        ["https:", "http:"].includes(parsed.protocol) &&
        !(loopback && port === viewPort)
    );
}

export function createMemoryHubCaptureFunctions(
    getBrowser: () => BrowserControl,
    getMemory: () => Pick<BrowserMemoryService, "ingest"> | undefined,
    getViewPort: () => number,
): Pick<MemoryHubFunctions, "memoryHubCapturePages" | "memoryHubCapturePage"> {
    function browser() {
        const control = getBrowser();
        if (
            typeof control.getCapturePages !== "function" ||
            typeof control.capturePageSnapshot !== "function"
        )
            throw new Error(
                "Selected browser does not support explicit-page capture. Use its existing webpage capture action.",
            );
        return control;
    }
    return {
        async memoryHubCapturePages() {
            if (!getMemory())
                throw new Error("Durable browser memory is not available");
            const pages = await timed(browser().getCapturePages());
            return {
                pages: pages.filter((page) =>
                    eligibleUrl(page.url, getViewPort()),
                ),
            };
        },
        async memoryHubCapturePage({ pageId, expectedUrl }) {
            if (!pageId || !eligibleUrl(expectedUrl, getViewPort()))
                throw new Error(
                    "Select an open web page outside the local Memory view.",
                );
            const memory = getMemory();
            if (!memory)
                throw new Error("Durable browser memory is not available");
            const captured = await timed(browser().capturePageSnapshot(pageId));
            if (
                captured.pageId !== pageId ||
                captured.url !== expectedUrl ||
                !eligibleUrl(captured.url, getViewPort())
            )
                throw new Error(
                    "Selected page changed. Refresh the page list and review the capture target.",
                );
            const capturedAt = new Date().toISOString();
            const fragments = captured.htmlFragments.map((fragment) => {
                if (!/^\d+$/.test(fragment.frameId))
                    throw new Error(
                        "Browser snapshot returned an invalid frame identity.",
                    );
                return { ...fragment, frameId: Number(fragment.frameId) };
            });
            const inputs = createExtractionInputsFromFragments(
                fragments,
                captured.url,
                captured.title,
                "index",
                capturedAt,
            );
            const markdown = inputs
                .map((input) => `## ${input.title}\n\n${input.textContent}`)
                .join("\n\n");
            if (!markdown.trim())
                throw new Error(
                    "Selected page has no readable content to capture.",
                );
            const result = await memory.ingest(
                {
                    url: captured.url,
                    title: captured.title,
                    markdown,
                    source: "current-page",
                    capturedAt,
                    activityType: "captured",
                },
                "content",
                { reportHowToStatus: true },
            );
            return {
                corpusId: result.source.corpusId,
                sourceId: result.source.sourceId,
                warnings: [...captured.warnings, ...result.warnings],
            };
        },
    };
}
