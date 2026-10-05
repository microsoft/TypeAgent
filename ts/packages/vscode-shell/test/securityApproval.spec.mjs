// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

const source = await readFile(
    new URL("../src/bridge/securityApproval.ts", import.meta.url),
    "utf8",
);
const { code } = await transform(source, { loader: "ts", format: "esm" });
const { showSecurityApproval } = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);

function fixture(onShow, failDocument = false) {
    const state = { providerDisposed: false, pickerDisposed: false };
    let accept;
    let hide;
    const picker = {
        selectedItems: [],
        activeItems: [],
        onDidAccept(callback) {
            accept = callback;
            return {
                dispose: () => {
                    accept = undefined;
                },
            };
        },
        onDidHide(callback) {
            hide = callback;
            return {
                dispose: () => {
                    hide = undefined;
                },
            };
        },
        show() {
            onShow(picker, { accept: () => accept?.(), hide: () => hide?.() });
        },
        dispose() {
            state.pickerDisposed = true;
        },
    };
    const api = {
        Uri: { parse: (value) => value },
        ViewColumn: { Active: -1 },
        workspace: {
            registerTextDocumentContentProvider(scheme, provider) {
                state.scheme = scheme;
                state.provider = provider;
                return {
                    dispose: () => {
                        state.providerDisposed = true;
                    },
                };
            },
            async openTextDocument(uri) {
                if (failDocument) throw new Error("Editor unavailable");
                return {
                    uri,
                    getText: () =>
                        state.provider.provideTextDocumentContent(uri),
                };
            },
        },
        window: {
            async showTextDocument(document) {
                state.displayedText = document.getText();
            },
            createQuickPick: () => picker,
        },
    };
    return { api, state };
}

const request = {
    message: "NOT a sandbox.\nExact script:\nWrite-Output 'review me'\n",
    choices: [
        "Run once",
        "Allow this exact invocation for this session",
        "Cancel",
    ],
    defaultId: 2,
};

test("Enter defaults to Cancel while the complete review is in a read-only document", async () => {
    const { api, state } = fixture((picker, events) => {
        assert.equal(picker.activeItems[0].label, "Cancel");
        assert.equal(picker.canSelectMany, false);
        events.accept();
    });
    assert.equal(await showSecurityApproval(api, request), 2);
    assert.equal(state.displayedText, request.message);
    assert.match(state.scheme, /^typeagent-security-review-/);
    assert.equal(state.providerDisposed, true);
    assert.equal(state.pickerDisposed, true);
});

test("explicit selection, rather than the first item, supplies approval", async () => {
    const { api } = fixture((picker, events) => {
        picker.selectedItems = [picker.items[0]];
        events.accept();
    });
    assert.equal(await showSecurityApproval(api, request), 0);
});

test("closing the picker cancels", async () => {
    const { api } = fixture((_picker, events) => events.hide());
    assert.equal(await showSecurityApproval(api, request), 2);
});

test("a review longer than a placeholder is not truncated", async () => {
    const message = request.message + "full-script-line\n".repeat(10000);
    const { api, state } = fixture((_picker, events) => events.hide());
    await showSecurityApproval(api, { ...request, message });
    assert.equal(state.displayedText, message);
});

test("an unrecognized selection does not authorize", async () => {
    const { api } = fixture((picker, events) => {
        picker.selectedItems = [{ label: "Run once", index: 0 }];
        events.accept();
    });
    assert.equal(await showSecurityApproval(api, request), 2);
});

test("failure to show the review fails closed and releases the provider", async () => {
    const { api, state } = fixture(
        () => assert.fail("Must not show approval"),
        true,
    );
    await assert.rejects(
        showSecurityApproval(api, request),
        /Editor unavailable/,
    );
    assert.equal(state.providerDisposed, true);
});

test("invalid default indices fail before showing approval", async () => {
    const { api } = fixture(() => assert.fail("Must not show approval"));
    await assert.rejects(
        showSecurityApproval(api, { ...request, defaultId: -1 }),
        /cancellation default/,
    );
});
