// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(
    new URL("../src/main/inlinePageCapture.ts", import.meta.url),
    "utf8",
);
const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
    },
});
const { createInlinePageCapture } = await import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

function page(url, title, persistent = true) {
    const contents = new EventEmitter();
    Object.assign(contents, {
        session: { isPersistent: () => persistent },
        isDestroyed: () => false,
        isLoadingMainFrame: () => false,
        getURL: () => url,
        mainFrame: {
            async executeJavaScript(script) {
                if (!script.includes("htmlFragments")) return { url, title };
                return {
                    url,
                    title,
                    htmlFragments: [
                        { frameId: "0", content: `<h1>${title}</h1>` },
                    ],
                    warnings: [],
                };
            },
        },
    });
    return contents;
}

test("Electron pins non-active WebContents rather than Hub and returns coherent snapshot", async () => {
    const article = page("https://example.com/article", "Article");
    const hub = page("http://localhost/memory-hub", "Hub");
    const capture = createInlinePageCapture(() => [article, hub]);
    const [selected] = await capture.getCapturePages();
    const result = await capture.capturePageSnapshot(selected.pageId);
    assert.deepEqual(result, {
        ...selected,
        htmlFragments: [{ frameId: "0", content: "<h1>Article</h1>" }],
        warnings: [],
    });
    capture.close();
    assert.equal(article.listenerCount("did-start-navigation"), 0);
});

test("Electron rejects same-URL navigation, vanished contents, and replaced frame", async () => {
    for (const mutation of [
        (contents) =>
            contents.emit(
                "did-start-navigation",
                {},
                contents.getURL(),
                false,
                true,
            ),
        (contents) => (contents.isDestroyed = () => true),
        (contents) =>
            (contents.mainFrame = {
                executeJavaScript: async () => assert.fail("replacement frame"),
            }),
    ]) {
        const article = page("https://example.com/article", "Article");
        const capture = createInlinePageCapture(() => [article]);
        const [selected] = await capture.getCapturePages();
        mutation(article);
        await assert.rejects(
            capture.capturePageSnapshot(selected.pageId),
            /disappeared or navigated/,
        );
        capture.close();
    }
});

test("Electron excludes private sessions and reports missing object-bound evaluation unavailable", async () => {
    const privatePage = page("https://private.test", "Private", false);
    const article = page("https://example.com", "Article");
    const capture = createInlinePageCapture(() => [privatePage, article]);
    assert.equal((await capture.getCapturePages()).length, 1);
    capture.close();
    article.mainFrame = {};
    await assert.rejects(capture.getCapturePages(), /capture is unavailable/);
});

test("Electron rejects in-flight navigation", async () => {
    const article = page("https://example.com", "Article");
    const capture = createInlinePageCapture(() => [article]);
    const [selected] = await capture.getCapturePages();
    article.mainFrame.executeJavaScript = async () => {
        article.emit("did-start-navigation", {}, article.getURL(), true, true);
        return {
            url: article.getURL(),
            title: "Other",
            htmlFragments: [],
            warnings: [],
        };
    };
    await assert.rejects(
        capture.capturePageSnapshot(selected.pageId),
        /disappeared or navigated/,
    );
    capture.close();
});

test("Electron rejects malformed document snapshot values", async () => {
    const article = page("https://example.com", "Article");
    const capture = createInlinePageCapture(() => [article]);
    const [selected] = await capture.getCapturePages();
    article.mainFrame.executeJavaScript = async () => ({
        url: article.getURL(),
        title: "Article",
        htmlFragments: [{ frameId: "not-root", content: "<h1>Article</h1>" }],
        warnings: [],
    });
    await assert.rejects(
        capture.capturePageSnapshot(selected.pageId),
        /invalid root fragment/,
    );
    capture.close();
});
