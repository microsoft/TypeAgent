import assert from "node:assert/strict";
import { test } from "node:test";
import type { IpcMainEvent, WebContents } from "electron";
import {
    isLegacyBrowserRelayMessage,
    isTrustedBrowserRpcSender,
} from "../src/main/browserRpcBoundary.js";

function makeSender(url: string) {
    const frame = { url };
    const sender = {
        mainFrame: frame,
        isDestroyed: () => false,
    } as unknown as WebContents;
    const event = { sender, senderFrame: frame } as unknown as IpcMainEvent;
    return { sender, event };
}

test("native RPC accepts only a host-owned top-level packaged view", () => {
    const { sender, event } = makeSender(
        "chrome-extension://host-extension/views/pdfView.html?document=1",
    );
    assert.equal(
        isTrustedBrowserRpcSender(event, [sender], "host-extension"),
        true,
    );
    assert.equal(isTrustedBrowserRpcSender(event, [], "host-extension"), false);
    assert.equal(isTrustedBrowserRpcSender(event, [sender], undefined), false);
    assert.equal(
        isTrustedBrowserRpcSender(event, [sender], "forged-id"),
        false,
    );
    assert.equal(
        isTrustedBrowserRpcSender(
            { ...event, senderFrame: null },
            [sender],
            "host-extension",
        ),
        false,
    );
    assert.equal(
        isTrustedBrowserRpcSender(
            {
                ...event,
                senderFrame: {
                    url: event.senderFrame!.url,
                } as typeof event.senderFrame,
            },
            [sender],
            "host-extension",
        ),
        false,
    );
});

test("native RPC rejects webcontent, arbitrary extension pages and navigated views", () => {
    for (const url of [
        "https://attacker.example/views/pdfView.html",
        "http://localhost:9000/views/pdfView.html",
        "file:///views/pdfView.html",
        "chrome-extension://other/views/pdfView.html",
        "chrome-extension://host-extension/offscreen/offscreen.html",
        "chrome-extension://host-extension/views/pdfView.html/extra",
    ]) {
        const { sender, event } = makeSender(url);
        assert.equal(
            isTrustedBrowserRpcSender(event, [sender], "host-extension"),
            false,
        );
    }
    const { sender, event } = makeSender(
        "chrome-extension://host-extension/views/pdfView.html",
    );
    event.senderFrame!.url = "https://attacker.example/";
    assert.equal(
        isTrustedBrowserRpcSender(event, [sender], "host-extension"),
        false,
    );
});

test("legacy native relay keeps site actions but rejects service envelopes", () => {
    assert.equal(
        isLegacyBrowserRelayMessage({
            method: "enableSiteTranslator",
            params: { translator: "site" },
        }),
        true,
    );
    assert.equal(
        isLegacyBrowserRelayMessage({ method: "webAgent/action", params: {} }),
        true,
    );
    for (const message of [
        null,
        {},
        { name: "agentService", message: { method: "memoryImportDocument" } },
        { name: "agentService", method: "keepAlive", message: {} },
        { name: "browserControl", method: "keepAlive", message: {} },
    ]) {
        assert.equal(isLegacyBrowserRelayMessage(message), false);
    }
});
