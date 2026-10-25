// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import ts from "typescript";

export const socketKey = Symbol.for("typeagent.crossword.offline.socket");

export async function loadServiceWorkerTransport() {
    const source = await readFile(
        new URL(
            "../../browserExtension/src/extension/serviceWorker/crosswordDecisionRpc.ts",
            import.meta.url,
        ),
        "utf8",
    );
    const websocketModule = `data:text/javascript;base64,${Buffer.from(
        'export const getWebSocket = () => globalThis[Symbol.for("typeagent.crossword.offline.socket")];',
    ).toString("base64")}`;
    const rewritten = source
        .replace(
            '"@typeagent/browser-control-rpc/crosswordDecisionTypes"',
            JSON.stringify(
                import.meta.resolve(
                    "@typeagent/browser-control-rpc/crosswordDecisionTypes",
                ),
            ),
        )
        .replace('"./websocket"', JSON.stringify(websocketModule));
    const compiled = ts.transpileModule(rewritten, {
        compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText;
    return import(
        `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
    );
}

export class PrivateSocket extends EventTarget {
    readyState = 1;
    sent = [];
    completed = [];

    constructor(handler, clientId = "offline-extension") {
        super();
        this.handler = handler;
        this.clientId = clientId;
    }

    send(text) {
        const envelope = JSON.parse(text);
        this.sent.push(envelope);
        const { id, method, params } = envelope.params;
        if (method === "cancelCrosswordDecision") {
            this.handler.cancel(this.clientId, params);
            return;
        }
        const result =
            method === "getCrosswordDecisionCapabilities"
                ? this.handler.capabilities()
                : this.handler.resolve(this.clientId, id, params);
        const completed = Promise.resolve(result).then((value) => {
            this.dispatchEvent(
                new MessageEvent("message", {
                    data: JSON.stringify({
                        source: "dispatcher",
                        method: "crosswordDecision/response",
                        type: "builtInRpcResponse",
                        id,
                        result: value,
                    }),
                }),
            );
        });
        this.completed.push(completed);
    }

    close() {
        this.readyState = 3;
        this.dispatchEvent(new Event("close"));
        this.handler.disconnect(this.clientId);
    }
}
