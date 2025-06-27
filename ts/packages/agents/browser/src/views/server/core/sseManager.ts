// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SSEClient, SSEEvent, SSEManager } from "./types.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:views:server:sse");

/**
 * Manages Server-Sent Events connections for multiple features
 */
export class SSEManagerImpl implements SSEManager {
    private clients: Map<string, Set<SSEClient>> = new Map();

    /**
     * Add a client to a specific namespace
     */
    addClient(namespace: string, client: SSEClient): void {
        if (!this.clients.has(namespace)) {
            this.clients.set(namespace, new Set());
        }

        const namespaceClients = this.clients.get(namespace)!;
        namespaceClients.add(client);

        debug(
            `Client added to namespace '${namespace}'. Total clients: ${namespaceClients.size}`,
        );

        // Handle client disconnect
        client.on("close", () => {
            this.removeClient(namespace, client);
        });

        // Send initial connection event
        this.sendToClient(client, {
            type: "connected",
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Remove a client from a specific namespace
     */
    removeClient(namespace: string, client: SSEClient): void {
        const namespaceClients = this.clients.get(namespace);
        if (namespaceClients) {
            namespaceClients.delete(client);
            debug(
                `Client removed from namespace '${namespace}'. Remaining clients: ${namespaceClients.size}`,
            );

            // Clean up empty namespaces
            if (namespaceClients.size === 0) {
                this.clients.delete(namespace);
                debug(`Namespace '${namespace}' cleaned up`);
            }
        }
    }

    /**
     * Broadcast an event to all clients in a namespace
     */
    broadcast(namespace: string, event: SSEEvent): void {
        const namespaceClients = this.clients.get(namespace);
        if (!namespaceClients || namespaceClients.size === 0) {
            debug(`No clients in namespace '${namespace}' to broadcast to`);
            return;
        }

        const eventWithTimestamp: SSEEvent = {
            ...event,
            timestamp: event.timestamp || new Date().toISOString(),
        };

        debug(
            `Broadcasting event '${event.type}' to ${namespaceClients.size} clients in namespace '${namespace}'`,
        );

        // Send to all clients, removing any that fail
        const failedClients: SSEClient[] = [];
        namespaceClients.forEach((client) => {
            try {
                this.sendToClient(client, eventWithTimestamp);
            } catch (error) {
                debug(`Failed to send to client, marking for removal:`, error);
                failedClients.push(client);
            }
        });

        // Clean up failed clients
        failedClients.forEach((client) => {
            this.removeClient(namespace, client);
        });
    }

    /**
     * Get the number of connected clients in a namespace
     */
    getClientCount(namespace: string): number {
        return this.clients.get(namespace)?.size || 0;
    }

    /**
     * Get all namespaces
     */
    getNamespaces(): string[] {
        return Array.from(this.clients.keys());
    }

    /**
     * Send event to a specific client
     */
    private sendToClient(client: SSEClient, event: SSEEvent): void {
        const eventString = `data: ${JSON.stringify(event)}\n\n`;
        client.write(eventString);
    }

    /**
     * Setup SSE headers for a response
     */
    static setupSSEHeaders(res: SSEClient): void {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "Cache-Control");
    }
}
