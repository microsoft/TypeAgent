// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect, afterEach, jest } from "@jest/globals";
import { ConversationBar } from "../src/conversationBar.js";
import type {
    ConversationBarController,
    ConversationBarOptions,
} from "../src/conversationBar.js";

type MockConversationBarController = ConversationBarController & {
    requestConversations: jest.MockedFunction<() => void>;
    createConversation: jest.MockedFunction<(name: string) => void>;
    switchConversation: jest.MockedFunction<(conversationId: string) => void>;
    renameConversation: jest.MockedFunction<
        (conversationId: string, name: string) => void
    >;
    deleteConversation: jest.MockedFunction<(conversationId: string) => void>;
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
