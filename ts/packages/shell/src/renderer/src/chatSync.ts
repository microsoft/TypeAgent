// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export async function createWebSocket(autoReconnect: boolean = true) {
    let url = window.location;
    let protocol = url.protocol.toLowerCase() == "https:" ? "wss" : "ws";
    let port = url.port;

    const endpoint = `${protocol}://${url.hostname}${port}`;

    return new Promise<WebSocket | undefined>((resolve) => {
        console.log(`opening web socket to ${endpoint} `);
        const webSocket = new WebSocket(endpoint);

        webSocket.onopen = (event: object) => {
            console.log("websocket open" + event);
            resolve(webSocket);
        };

        // messages from the typeAgent server appear here
        webSocket.onmessage = (event: any) => {
            console.log("websocket message: " + JSON.stringify(event));

            const msgObj = JSON.parse(event.data);
            console.log(msgObj);
            switch (msgObj.message) {
                case "updated-content":
                    const wrapper: HTMLDivElement = document.getElementById(
                        "wrapper",
                    ) as HTMLDivElement;

                    wrapper.innerHTML += "updated";
                    break;

                default:
                    console.warn(
                        `websocket message not handled: ${msgObj.message}`,
                    );
                    break;
            }
        };
        webSocket.onclose = (event: object) => {
            console.log("websocket connection closed" + event);

            // reconnect?
            if (autoReconnect) {
                createWebSocket().then((ws) => (globalThis.ws = ws));
            }
        };
        webSocket.onerror = (event: object) => {
            console.log("websocket error" + event);
            resolve(undefined);
        };
    });
}

export function keepWebSocketAlive(webSocket: WebSocket, source: string) {
    const keepAliveIntervalId = setInterval(() => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            webSocket.send(
                JSON.stringify({
                    source: `${source}`,
                    target: "none",
                    messageType: "keepAlive",
                    body: {},
                }),
            );
        } else {
            console.log("Clearing keepalive retry interval");
            clearInterval(keepAliveIntervalId);
        }
    }, 20 * 1000);
}

document.addEventListener("DOMContentLoaded", async function () {
    const wrapper = document.getElementById("wrapper")!;
    wrapper.innerHTML = "Loading...";

    await createWebSocket(true);
});
