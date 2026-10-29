// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { HubPage } from "./memoryHubModel";

export type HubNotification = {
    title: string;
    page: HubPage;
    context?: string;
    severity?: "info" | "warning";
    messages: readonly string[];
};

export class HubNotifications {
    private entries = new Map<string, HubNotification>();
    private listeners = new Set<() => void>();

    set(key: string, value: HubNotification): void {
        const messages = [
            ...new Set(value.messages.map((line) => line.trim())),
        ].filter(Boolean);
        if (!messages.length) {
            this.clear(key);
            return;
        }
        const next = { ...value, messages };
        if (JSON.stringify(this.entries.get(key)) === JSON.stringify(next))
            return;
        this.entries.delete(key);
        this.entries.set(key, next);
        this.changed();
    }

    clear(key?: string): void {
        const changed =
            key === undefined ? this.entries.size > 0 : this.entries.has(key);
        if (key === undefined) this.entries.clear();
        else this.entries.delete(key);
        if (changed) this.changed();
    }

    has(key: string): boolean {
        return this.entries.has(key);
    }

    list(): HubNotification[] {
        return [...this.entries.values()].reverse().map((entry) => ({
            ...entry,
            messages: [...entry.messages],
        }));
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private changed(): void {
        for (const listener of this.listeners) listener();
    }
}

export const hubNotifications = new HubNotifications();

export function mountMemoryHubNotifications(
    host: HTMLElement,
    entryPoint: HTMLAnchorElement,
    store = hubNotifications,
) {
    const description = document.createElement("p");
    description.className = "hub-muted";
    description.textContent =
        "Current notices from across Memory. Notices update as pages load and operations complete, and clear when you refresh the Hub or change scope. They are not saved as a history.";
    const list = document.createElement("div");
    list.className = "hub-notifications";
    const count = document.createElement("span");
    count.className = "hub-badge";
    count.setAttribute("aria-hidden", "true");
    entryPoint.append(count);
    host.append(description, list);

    function render() {
        const entries = store.list();
        const total = entries.reduce(
            (sum, entry) => sum + entry.messages.length,
            0,
        );
        count.hidden = total === 0;
        count.textContent = String(total);
        entryPoint.setAttribute(
            "aria-label",
            total ? `Notifications (${total})` : "Notifications",
        );
        entryPoint.title = total ? `${total} current notices` : "Notifications";
        list.replaceChildren();
        if (!entries.length) {
            const empty = document.createElement("p");
            empty.className = "hub-notifications-empty";
            empty.textContent = "No current notifications.";
            list.append(empty);
        }
        for (const entry of entries) {
            const card = document.createElement("article");
            card.className = "card hub-notification";
            card.dataset.severity = entry.severity ?? "warning";
            const heading = document.createElement("h3");
            const link = document.createElement("a");
            link.href = `#/${entry.page}`;
            link.textContent = entry.title;
            heading.append(link);
            card.append(heading);
            if (entry.context) {
                const context = document.createElement("p");
                context.className = "hub-muted";
                context.textContent = entry.context;
                card.append(context);
            }
            const messages = document.createElement("ul");
            for (const text of entry.messages) {
                const message = document.createElement("li");
                message.textContent = text;
                messages.append(message);
            }
            card.append(messages);
            list.append(card);
        }
    }
    const unsubscribe = store.subscribe(render);
    render();
    return { dispose: unsubscribe };
}
