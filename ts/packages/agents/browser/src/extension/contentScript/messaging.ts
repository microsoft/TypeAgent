// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Sends a message to the background script
 * @param message The message to send
 * @returns Promise resolving to the response
 */
export async function sendMessageToBackground(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Sends a message to the content script
 * @param tabId The ID of the tab to send the message to
 * @param message The message to send
 * @param options Options for sending the message
 * @returns Promise resolving to the response
 */
export async function sendMessageToContentScript(
    tabId: number,
    message: any,
    options?: { frameId?: number },
): Promise<any> {
    return new Promise((resolve, reject) => {
        try {
            options = options ?? {};
            chrome.tabs.sendMessage(tabId, message, options, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Posts a message to the window
 * @param message The message to post
 * @param targetOrigin The target origin
 * @returns Promise resolving when the message is acknowledged
 */
export function postMessageToWindow(
    message: any,
    targetOrigin: string = "*",
): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            // Create a unique message ID to identify the response
            const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            message.messageId = messageId;

            // Set up a handler for the response
            const responseHandler = (event: MessageEvent) => {
                if (
                    event.data &&
                    event.data.type === "message_ack" &&
                    event.data.messageId === messageId
                ) {
                    window.removeEventListener("message", responseHandler);
                    resolve();
                }
            };

            // Listen for the response
            window.addEventListener("message", responseHandler);

            // Send the message
            window.postMessage(message, targetOrigin);

            // Set a timeout to prevent hanging
            setTimeout(() => {
                window.removeEventListener("message", responseHandler);
                reject(new Error("Timeout waiting for message acknowledgment"));
            }, 5000);
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Sends a request that requires the main world context
 * @param message The message to send
 * @returns Promise resolving to the response
 */
export async function sendMainWorldRequest(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const requestId = `request_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        const listener = (event: MessageEvent) => {
            if (event.source !== window) return;

            const data = event.data;
            if (
                data &&
                data.type === "main-world-response" &&
                data.requestId === requestId
            ) {
                window.removeEventListener("message", listener);

                if (data.error) {
                    reject(new Error(data.error));
                } else {
                    resolve(data.result);
                }
            }
        };

        window.addEventListener("message", listener);

        // Send the message with the request ID
        window.postMessage(
            {
                type: "content-script-request",
                requestId: requestId,
                payload: message,
            },
            "*",
        );

        // Add a timeout to prevent hanging promises
        setTimeout(() => {
            window.removeEventListener("message", listener);
            reject(new Error("Request to main world timed out"));
        }, 10000);
    });
}
