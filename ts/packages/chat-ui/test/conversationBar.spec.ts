// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect, afterEach, jest } from "@jest/globals";
import { ConversationBar } from "../src/conversationBar.js";
import type {
    ConversationBarController,
    ConversationBarOptions,
} from "../src/conversationBar.js";
import type { ConnectionActionId } from "../src/connectionStatus.js";

type MockConversationBarController = ConversationBarController & {
    requestConversations: jest.MockedFunction<() => void>;
    createConversation: jest.MockedFunction<(name: string) => void>;
    switchConversation: jest.MockedFunction<(conversationId: string) => void>;
    renameConversation: jest.MockedFunction<
        (conversationId: string, name: string) => void
    >;
    deleteConversation: jest.MockedFunction<(conversationId: string) => void>;
    connectionAction: jest.MockedFunction<(action: ConnectionActionId) => void>;
};

function makeBar(
    options: Partial<Omit<ConversationBarOptions, "controller">> = {},
) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const controller: MockConversationBarController = {
        requestConversations: jest.fn(() => undefined),
        createConversation: jest.fn((_name: string) => undefined),
        switchConversation: jest.fn((_conversationId: string) => undefined),
        renameConversation: jest.fn(
            (_conversationId: string, _name: string) => undefined,
        ),
        deleteConversation: jest.fn((_conversationId: string) => undefined),
        connectionAction: jest.fn((_action: ConnectionActionId) => undefined),
    };
    const bar = new ConversationBar(root, { controller, ...options });
    bar.setStatus({ connected: true });
    bar.setConversations(
        [
            { conversationId: "conv-1", name: "Alpha", clientCount: 1 },
            { conversationId: "conv-2", name: "Beta", clientCount: 2 },
        ],
        "conv-1",
    );
    return { root, bar, controller };
}

function buttonByLabel(root: HTMLElement, label: string): HTMLButtonElement {
    const button = root.querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`,
    );
    if (!button) throw new Error(`no button with label ${label}`);
    return button;
}

afterEach(() => {
    document.body.replaceChildren();
});

describe("ConversationBar", () => {
    it("renders the current conversation and connected client count", () => {
        const { root } = makeBar();

        expect(root.textContent).toContain("Alpha");
        expect(root.textContent).toContain("Connected");
        expect(root.textContent).toContain("1 client");
    });

    it("renders the connected state as an ambient indicator with a client-count badge", () => {
        const { root } = makeBar();

        const status = root.querySelector<HTMLElement>(
            ".conversation-status-summary",
        );
        expect(status).not.toBeNull();
        // Ambient indicator (icon + badge), not a solid text pill.
        expect(status!.classList.contains("as-indicator")).toBe(true);
        expect(status!.querySelector("svg")).not.toBeNull();
        const badge = status!.querySelector<HTMLElement>(
            ".conversation-status-badge",
        );
        expect(badge?.textContent).toBe("1");
        // Full status stays available to assistive tech + as a tooltip.
        expect(status!.getAttribute("title")).toBe("Connected · 1 client");
    });

    it("shows the server endpoint in the connected indicator tooltip", () => {
        const { root, bar } = makeBar();
        bar.setStatus({ connected: true, endpoint: "localhost:8899" });

        const status = root.querySelector<HTMLElement>(
            ".conversation-status-summary",
        );
        // Endpoint is appended so the user can confirm the target server.
        expect(status!.getAttribute("title")).toBe(
            "Connected · 1 client · localhost:8899",
        );
        // ...and mirrored into the visually-hidden text for assistive tech.
        const sr = status!.querySelector(".conversation-status-sr");
        expect(sr?.textContent).toContain("localhost:8899");
    });

    it("requests and filters conversations from the search popover", () => {
        const { root, controller } = makeBar();

        buttonByLabel(root, "Search conversations").click();
        expect(controller.requestConversations).toHaveBeenCalledTimes(1);

        const searchInput = root.querySelector<HTMLInputElement>(
            ".conversation-search-popover input",
        );
        expect(searchInput).not.toBeNull();
        searchInput!.value = "bet";
        searchInput!.dispatchEvent(new Event("input", { bubbles: true }));

        expect(root.textContent).toContain("Beta");
        expect(root.textContent).not.toContain("Alpha1 client");
    });

    it("validates duplicate create names", () => {
        const { root, bar, controller } = makeBar();

        bar.activateCreateInput();
        const input = root.querySelector<HTMLInputElement>(
            ".conversation-create-popover input",
        );
        expect(input).not.toBeNull();
        input!.value = "Alpha";
        input!.dispatchEvent(new Event("input", { bubbles: true }));

        const createButton = buttonByLabel(root, "Create conversation");
        expect(createButton.disabled).toBe(true);
        expect(root.textContent).toContain("Conversation already exists");

        input!.value = "Gamma";
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        createButton.click();
        expect(controller.createConversation).toHaveBeenCalledWith("Gamma");
    });

    it("shows the create toolbar action only when opted in", () => {
        const defaultBar = makeBar();
        expect(
            defaultBar.root.querySelector(
                'button[aria-label="New conversation"]',
            ),
        ).toBeNull();

        const { root, controller } = makeBar({ showCreateButton: true });
        buttonByLabel(root, "New conversation").click();

        const popover = root.querySelector<HTMLElement>(
            ".conversation-create-popover",
        );
        expect(popover?.classList.contains("hidden")).toBe(false);

        const input = root.querySelector<HTMLInputElement>(
            ".conversation-create-popover input",
        );
        input!.value = "Gamma";
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        buttonByLabel(root, "Create conversation").click();

        expect(controller.createConversation).toHaveBeenCalledWith("Gamma");
    });

    it("invokes switch, rename, and delete callbacks", () => {
        const { root, controller } = makeBar();

        buttonByLabel(root, "Search conversations").click();
        const betaButton = Array.from(
            root.querySelectorAll<HTMLButtonElement>(
                ".conversation-search-result",
            ),
        ).find((button) => button.textContent?.includes("Beta"));
        expect(betaButton).not.toBeUndefined();
        betaButton!.click();
        expect(controller.switchConversation).toHaveBeenCalledWith("conv-2");

        buttonByLabel(root, "Rename conversation").click();
        const renameInput = root.querySelector<HTMLInputElement>(
            ".conversation-rename-editor input",
        );
        expect(renameInput).not.toBeNull();
        renameInput!.value = "Alpha Prime";
        renameInput!.dispatchEvent(new Event("input", { bubbles: true }));
        buttonByLabel(root, "Save conversation name").click();
        expect(controller.renameConversation).toHaveBeenCalledWith(
            "conv-1",
            "Alpha Prime",
        );

        buttonByLabel(root, "Delete conversation").click();
        expect(controller.deleteConversation).toHaveBeenCalledWith("conv-1");
    });

    it("dismisses popovers on Escape", () => {
        const { root } = makeBar();

        buttonByLabel(root, "Search conversations").click();
        const popover = root.querySelector<HTMLElement>(
            ".conversation-search-popover",
        );
        expect(popover?.classList.contains("hidden")).toBe(false);

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(popover?.classList.contains("hidden")).toBe(true);
    });

    it("renders error, reconnecting, and switching status states", () => {
        const { root, bar } = makeBar();
        const status = root.querySelector<HTMLElement>(
            ".conversation-status-summary",
        );

        bar.setError("Rename failed");
        expect(status?.textContent).toBe("Rename failed");
        expect(status?.classList.contains("disconnected")).toBe(true);
        expect(status?.getAttribute("aria-live")).toBe("polite");

        bar.setStatus({ connected: false, reconnectText: "Retrying" });
        expect(status?.textContent).toBe("Retrying");

        bar.setStatus({
            connected: true,
            switching: true,
            statusLabel: "Creating",
        });
        expect(status?.textContent).toBe("Creating");
        expect(status?.classList.contains("switching")).toBe(true);
    });

    it("renders the structured reconnect countdown via the connection model", () => {
        const { root, bar } = makeBar();
        const status = root.querySelector<HTMLElement>(
            ".conversation-status-summary",
        );

        bar.setStatus({
            connected: false,
            connection: {
                phase: "waiting",
                attempt: 3,
                secondsRemaining: 5,
            },
        });
        expect(status?.textContent).toContain(
            "Disconnected — retrying in 5s (attempt 3)",
        );
        // Attempt count shown as a negative amber badge.
        const badge = status?.querySelector(".conversation-status-badge");
        expect(badge?.textContent).toBe("-3");
        expect(badge?.classList.contains("attempt")).toBe(true);
        expect(status?.classList.contains("stopped")).toBe(false);
        // No recovery links while still retrying.
        expect(
            status?.querySelectorAll(".connection-status-action").length,
        ).toBe(0);
    });

    it("makes the plug a reconnect button once auto-retry has stopped and routes clicks", () => {
        const { root, bar, controller } = makeBar();
        const status = root.querySelector<HTMLElement>(
            ".conversation-status-summary",
        );

        bar.setStatus({
            connected: false,
            connection: {
                phase: "stopped",
                attempt: 12,
                error: "ECONNREFUSED",
                actions: ["retry", "start"],
            },
        });

        // The plug itself becomes the primary reconnect button; the full
        // status stays available via its accessible label / tooltip.
        const plug = status?.querySelector<HTMLButtonElement>(
            ".conversation-status-plug",
        );
        expect(plug).not.toBeNull();
        expect(plug?.getAttribute("aria-label")).toContain("stopped");
        expect(plug?.getAttribute("aria-label")).toContain("ECONNREFUSED");
        plug?.click();
        expect(controller.connectionAction).toHaveBeenCalledWith("retry");

        // The remaining action (start server) sits alongside as a link.
        expect(status?.classList.contains("has-actions")).toBe(true);
        const links = status?.querySelectorAll<HTMLButtonElement>(
            ".connection-status-action",
        );
        expect(links?.length).toBe(1);
        expect(links?.[0].textContent).toBe("Start server");
        links?.[0].click();
        expect(controller.connectionAction).toHaveBeenCalledWith("start");
    });

    it("renames conversations from search results inline", () => {
        const { root, controller } = makeBar();

        buttonByLabel(root, "Search conversations").click();
        const betaRow = Array.from(
            root.querySelectorAll<HTMLElement>(
                ".conversation-search-result-row",
            ),
        ).find((row) => row.textContent?.includes("Beta"));
        expect(betaRow).not.toBeUndefined();
        const editButton = betaRow!.querySelector<HTMLButtonElement>(
            'button[aria-label="Rename conversation"]',
        );
        expect(editButton).not.toBeNull();
        editButton!.click();

        const input = betaRow!.querySelector<HTMLInputElement>(
            'input[data-conversation-id="conv-2"]',
        );
        expect(input).not.toBeNull();
        input!.value = "Alpha";
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        const saveButton = betaRow!.querySelector<HTMLButtonElement>(
            'button[aria-label="Save conversation name"]',
        );
        expect(saveButton?.disabled).toBe(true);

        input!.value = "Beta Prime";
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        saveButton!.click();
        expect(controller.renameConversation).toHaveBeenCalledWith(
            "conv-2",
            "Beta Prime",
        );
    });

    it("closes popovers on outside click", () => {
        const { root } = makeBar();

        buttonByLabel(root, "Search conversations").click();
        const popover = root.querySelector<HTMLElement>(
            ".conversation-search-popover",
        );
        expect(popover?.classList.contains("hidden")).toBe(false);

        document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(popover?.classList.contains("hidden")).toBe(true);
    });

    it("surfaces controller errors and cleans up on dispose", async () => {
        const { root, bar, controller } = makeBar();
        controller.renameConversation.mockRejectedValueOnce(
            new Error("Backend refused rename") as never,
        );

        buttonByLabel(root, "Rename conversation").click();
        const input = root.querySelector<HTMLInputElement>(
            ".conversation-rename-editor input",
        );
        input!.value = "Alpha Prime";
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        buttonByLabel(root, "Save conversation name").click();
        await Promise.resolve();
        await Promise.resolve();

        expect(root.textContent).toContain("Backend refused rename");

        bar.dispose();
        expect(root.querySelector(".conversation-name-bar")).toBeNull();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
});
