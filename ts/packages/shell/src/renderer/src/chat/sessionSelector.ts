// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Session selector dropdown UI for the shell chat header.
 *
 * Renders a button showing the current session name. Clicking it opens
 * a dropdown that lists available sessions and allows creating new ones.
 */

import type { SessionInfo } from "../../../preload/electronTypes";
import { getClientAPI } from "../main";

export class SessionSelector {
    private readonly container: HTMLDivElement;
    private readonly button: HTMLButtonElement;
    private readonly dropdown: HTMLDivElement;
    private isOpen = false;
    private currentSessionId: string | undefined;
    private currentSessionName: string = "Default Session";

    constructor(
        private onSessionSwitched?: (sessionId: string, name: string) => void,
    ) {
        this.container = document.createElement("div");
        this.container.className = "session-selector";

        this.button = document.createElement("button");
        this.button.className = "session-selector-button";
        this.button.title = "Switch session";
        this.updateButtonLabel();
        this.button.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggle();
        });
        this.container.appendChild(this.button);

        this.dropdown = document.createElement("div");
        this.dropdown.className = "session-selector-dropdown";
        this.dropdown.style.display = "none";
        this.container.appendChild(this.dropdown);

        // Close on outside click
        document.addEventListener("click", () => this.close());

        // Load initial session
        this.refreshCurrentSession();
    }

    getElement(): HTMLDivElement {
        return this.container;
    }

    setCurrentSession(sessionId: string, name: string): void {
        this.currentSessionId = sessionId;
        this.currentSessionName = name;
        this.updateButtonLabel();
    }

    private updateButtonLabel(): void {
        this.button.textContent = `📋 ${this.currentSessionName}`;
    }

    private toggle(): void {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    private close(): void {
        this.isOpen = false;
        this.dropdown.style.display = "none";
    }

    private async open(): Promise<void> {
        this.isOpen = true;
        this.dropdown.style.display = "";
        this.dropdown.innerHTML =
            "<div class='session-loading'>Loading...</div>";

        try {
            const api = getClientAPI();
            const sessions = await api.sessionList();
            this.renderDropdown(sessions);
        } catch {
            this.dropdown.innerHTML =
                "<div class='session-error'>Failed to load sessions</div>";
        }
    }

    private renderDropdown(sessions: SessionInfo[]): void {
        this.dropdown.innerHTML = "";

        // Session list
        for (const session of sessions) {
            const item = document.createElement("div");
            item.className = "session-item";
            if (session.sessionId === this.currentSessionId) {
                item.classList.add("session-item-current");
            }

            const nameSpan = document.createElement("span");
            nameSpan.className = "session-item-name";
            nameSpan.textContent = session.name;
            item.appendChild(nameSpan);

            const metaSpan = document.createElement("span");
            metaSpan.className = "session-item-meta";
            metaSpan.textContent = `${session.clientCount} client(s)`;
            item.appendChild(metaSpan);

            item.addEventListener("click", (e) => {
                e.stopPropagation();
                this.switchTo(session.sessionId, session.name);
            });
            this.dropdown.appendChild(item);
        }

        // Separator
        const sep = document.createElement("div");
        sep.className = "session-separator";
        this.dropdown.appendChild(sep);

        // New session button
        const newBtn = document.createElement("div");
        newBtn.className = "session-item session-new";
        newBtn.textContent = "+ New Session";
        newBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            await this.createNewSession();
        });
        this.dropdown.appendChild(newBtn);
    }

    private async switchTo(sessionId: string, name: string): Promise<void> {
        this.close();
        if (sessionId === this.currentSessionId) return;

        try {
            const api = getClientAPI();
            const result = await api.sessionSwitch(sessionId);
            if (result.success) {
                this.setCurrentSession(
                    result.sessionId ?? sessionId,
                    result.name ?? name,
                );
                this.onSessionSwitched?.(
                    result.sessionId ?? sessionId,
                    result.name ?? name,
                );
            }
        } catch {
            // Handled by the slash command fallback
        }
    }

    private async createNewSession(): Promise<void> {
        this.close();
        const name = prompt("New session name:");
        if (!name) return;

        try {
            const api = getClientAPI();
            const session = await api.sessionCreate(name);
            // Automatically switch to the new session
            await this.switchTo(session.sessionId, session.name);
        } catch {
            // Handled by the slash command fallback
        }
    }

    private async refreshCurrentSession(): Promise<void> {
        try {
            const api = getClientAPI();
            const current = await api.sessionGetCurrent();
            if (current) {
                this.setCurrentSession(current.sessionId, current.name);
            }
        } catch {
            // Non-critical — keep the default label
        }
    }
}
