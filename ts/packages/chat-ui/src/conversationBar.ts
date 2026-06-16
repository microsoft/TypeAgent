// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ConversationBarConversation = {
    conversationId: string;
    name: string;
    clientCount?: number;
};

export type ConversationBarStatus = {
    connected: boolean;
    switching?: boolean;
    statusLabel?: "Creating" | "Connecting" | "Switching";
    targetName?: string;
    errorText?: string;
    reconnectText?: string;
    demoSuffix?: string;
};

export type ConversationBarController = {
    requestConversations(): void | Promise<void>;
    createConversation(name: string): void | Promise<void>;
    switchConversation(conversationId: string): void | Promise<void>;
    renameConversation(
        conversationId: string,
        name: string,
    ): void | Promise<void>;
    deleteConversation(conversationId: string): void | Promise<void>;
};

export type ConversationBarIconName =
    | "create"
    | "rename"
    | "delete"
    | "save"
    | "cancel";

export type ConversationBarIcon = {
    className?: string;
    text?: string;
};

export type ConversationBarIcons = Partial<
    Record<ConversationBarIconName, ConversationBarIcon>
>;

export type ConversationBarOptions = {
    controller: ConversationBarController;
    label?: string;
    showCreateButton?: boolean;
    icons?: ConversationBarIcons;
};

const fallbackIconText: Record<ConversationBarIconName, string> = {
    create: "+",
    rename: "E",
    delete: "D",
    save: "OK",
    cancel: "X",
};

export class ConversationBar {
    private readonly controller: ConversationBarController;
    private readonly icons: ConversationBarIcons;
    private status: ConversationBarStatus = { connected: false };
    private conversations: ConversationBarConversation[] = [];
    private currentConversationId: string | undefined;
    private currentConversationName = "";
    private currentClientCount: number | undefined;
    private isRenamingCurrent = false;
    private inlineRenameConversationId: string | undefined;

    private readonly rootEl: HTMLDivElement;
    private readonly nameBtn: HTMLButtonElement;
    private readonly renameEditorEl: HTMLDivElement;
    private readonly renameInputEl: HTMLInputElement;
    private readonly renameSaveBtn: HTMLButtonElement;
    private readonly renameCancelBtn: HTMLButtonElement;
    private readonly currentCreateBtn: HTMLButtonElement | undefined;
    private readonly currentRenameBtn: HTMLButtonElement;
    private readonly currentDeleteBtn: HTMLButtonElement;
    private readonly statusEl: HTMLSpanElement;
    private readonly createPopoverEl: HTMLDivElement;
    private readonly newNameEl: HTMLInputElement;
    private readonly createBtn: HTMLButtonElement;
    private readonly createHintEl: HTMLDivElement;
    private readonly searchPopoverEl: HTMLDivElement;
    private readonly searchInputEl: HTMLInputElement;
    private readonly searchResultsEl: HTMLDivElement;

    private readonly documentClickHandler = (event: MouseEvent) => {
        const target = event.target as Node | null;
        if (!target || this.rootEl.contains(target)) return;
        this.hidePopovers();
    };

    private readonly documentKeyHandler = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        if (this.isRenamingCurrent) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.cancelRenameCurrentConversation();
            return;
        }
        if (this.inlineRenameConversationId) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.inlineRenameConversationId = undefined;
            this.renderConversationSearchResults();
            return;
        }
        if (!this.isPopoverVisible()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.hidePopovers();
    };

    constructor(parentElement: HTMLElement, options: ConversationBarOptions) {
        this.controller = options.controller;
        this.icons = options.icons ?? {};

        this.rootEl = document.createElement("div");
        this.rootEl.className = "conversation-name-bar";

        const labelEl = document.createElement("span");
        labelEl.className = "conversation-name-label";
        labelEl.textContent = options.label ?? "Conversation";
        this.rootEl.appendChild(labelEl);

        this.nameBtn = document.createElement("button");
        this.nameBtn.type = "button";
        this.nameBtn.className = "conversation-name-btn";
        this.nameBtn.title = "Search conversations";
        this.nameBtn.setAttribute("aria-label", "Search conversations");
        this.nameBtn.textContent = "Conversation";
        this.rootEl.appendChild(this.nameBtn);

        this.renameEditorEl = document.createElement("div");
        this.renameEditorEl.className = "conversation-rename-editor hidden";
        this.renameInputEl = document.createElement("input");
        this.renameInputEl.type = "text";
        this.renameInputEl.title = "Rename conversation";
        this.renameInputEl.setAttribute("aria-label", "Rename conversation");
        this.renameEditorEl.appendChild(this.renameInputEl);
        this.renameSaveBtn = this.makeActionButton(
            "save",
            "Save conversation name",
            "conversation-action-btn",
        );
        this.renameEditorEl.appendChild(this.renameSaveBtn);
        this.renameCancelBtn = this.makeActionButton(
            "cancel",
            "Cancel rename",
            "conversation-action-btn",
        );
        this.renameEditorEl.appendChild(this.renameCancelBtn);
        this.rootEl.appendChild(this.renameEditorEl);

        this.statusEl = document.createElement("span");
        this.statusEl.className = "conversation-status-summary disconnected";
        this.statusEl.setAttribute("aria-live", "polite");
        this.statusEl.textContent = "Disconnected";
        this.rootEl.appendChild(this.statusEl);

        const actionsEl = document.createElement("div");
        actionsEl.className = "conversation-actions";
        actionsEl.setAttribute("aria-label", "Conversation actions");
        if (options.showCreateButton) {
            this.currentCreateBtn = this.makeActionButton(
                "create",
                "New conversation",
                "conversation-action-btn",
            );
            actionsEl.appendChild(this.currentCreateBtn);
        }
        this.currentRenameBtn = this.makeActionButton(
            "rename",
            "Rename conversation",
            "conversation-action-btn",
        );
        actionsEl.appendChild(this.currentRenameBtn);
        this.currentDeleteBtn = this.makeActionButton(
            "delete",
            "Delete conversation",
            "conversation-action-btn",
        );
        actionsEl.appendChild(this.currentDeleteBtn);
        this.rootEl.appendChild(actionsEl);

        this.createPopoverEl = document.createElement("div");
        this.createPopoverEl.className =
            "conversation-popover conversation-create-popover hidden";
        const createInputWrapperEl = document.createElement("div");
        createInputWrapperEl.className = "conversation-create-input-wrapper";
        this.newNameEl = document.createElement("input");
        this.newNameEl.type = "text";
        this.newNameEl.placeholder = "New conversation name";
        this.newNameEl.title = "New conversation name";
        createInputWrapperEl.appendChild(this.newNameEl);
        this.createBtn = document.createElement("button");
        this.createBtn.type = "button";
        this.createBtn.className = "conversation-create-submit";
        this.createBtn.title = "Create conversation";
        this.createBtn.setAttribute("aria-label", "Create conversation");
        this.createBtn.textContent = "+";
        createInputWrapperEl.appendChild(this.createBtn);
        this.createPopoverEl.appendChild(createInputWrapperEl);
        this.createHintEl = document.createElement("div");
        this.createHintEl.className = "conversation-create-hint hidden";
        this.createHintEl.textContent = "Conversation already exists";
        this.createPopoverEl.appendChild(this.createHintEl);
        this.rootEl.appendChild(this.createPopoverEl);

        this.searchPopoverEl = document.createElement("div");
        this.searchPopoverEl.className =
            "conversation-popover conversation-search-popover hidden";
        this.searchInputEl = document.createElement("input");
        this.searchInputEl.type = "text";
        this.searchInputEl.placeholder = "Search conversations";
        this.searchInputEl.title = "Search conversations";
        this.searchPopoverEl.appendChild(this.searchInputEl);
        this.searchResultsEl = document.createElement("div");
        this.searchResultsEl.className = "conversation-search-results";
        this.searchResultsEl.setAttribute("role", "listbox");
        this.searchPopoverEl.appendChild(this.searchResultsEl);
        this.rootEl.appendChild(this.searchPopoverEl);

        parentElement.appendChild(this.rootEl);
        this.bindEvents();
        this.updateSummary();
        this.updateControlsEnabled();
        document.addEventListener("click", this.documentClickHandler);
        document.addEventListener("keydown", this.documentKeyHandler);
    }

    public getContainer(): HTMLElement {
        return this.rootEl;
    }

    public dispose(): void {
        document.removeEventListener("click", this.documentClickHandler);
        document.removeEventListener("keydown", this.documentKeyHandler);
        this.searchResultsEl.innerHTML = "";
        this.rootEl.remove();
    }

    public setStatus(status: Partial<ConversationBarStatus>): void {
        this.status = { ...this.status, ...status };
        if (status.connected) this.status.errorText = undefined;
        this.updateSummary();
        this.updateControlsEnabled();
    }

    public setCurrentConversation(
        conversationId: string | undefined,
        name?: string,
        clientCount?: number,
    ): void {
        this.currentConversationId = conversationId;
        if (name !== undefined) this.currentConversationName = name;
        this.currentClientCount = clientCount;
        this.updateSummary();
        this.updateControlsEnabled();
    }

    public setConversations(
        conversations: ConversationBarConversation[],
        currentConversationId?: string,
    ): void {
        const selectedId = currentConversationId ?? this.currentConversationId;
        this.conversations = conversations;
        const selected = conversations.find(
            (conversation) => conversation.conversationId === selectedId,
        );
        if (selected) {
            this.currentConversationId = selected.conversationId;
            this.currentConversationName = selected.name;
            this.currentClientCount = selected.clientCount;
        } else {
            this.currentClientCount = undefined;
        }
        this.updateSummary();
        this.renderConversationSearchResults();
        this.updateControlsEnabled();
    }

    public setError(message: string | undefined): void {
        this.status.errorText = message;
        this.updateSummary();
    }

    public activateCreateInput(): void {
        this.showCreateConversationPopover();
    }

    private bindEvents(): void {
        this.nameBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            if (this.isRenamingCurrent) return;
            const willShow = this.searchPopoverEl.classList.contains("hidden");
            if (willShow) {
                this.showConversationSearchPopover();
            } else {
                this.setPopoverVisible(this.searchPopoverEl, false);
            }
        });

        this.currentCreateBtn?.addEventListener("click", (event) => {
            event.stopPropagation();
            this.showCreateConversationPopover();
        });

        this.currentRenameBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            this.beginRenameCurrentConversation();
        });

        this.currentDeleteBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            if (!this.isActionEnabled() || !this.currentConversationId) return;
            this.hidePopovers();
            this.status.errorText = undefined;
            void this.fire(() =>
                this.controller.deleteConversation(this.currentConversationId!),
            );
        });

        this.searchInputEl.addEventListener("input", () => {
            this.renderConversationSearchResults();
        });

        this.newNameEl.addEventListener("input", () => {
            this.updateControlsEnabled();
        });

        this.newNameEl.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            this.createConversationFromInput();
        });

        this.createBtn.addEventListener("click", () => {
            this.createConversationFromInput();
        });

        this.renameInputEl.addEventListener("input", () => {
            this.updateControlsEnabled();
        });

        this.renameInputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                this.submitRenameCurrentConversation();
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                this.cancelRenameCurrentConversation();
            }
        });

        this.renameSaveBtn.addEventListener("click", () => {
            this.submitRenameCurrentConversation();
        });

        this.renameCancelBtn.addEventListener("click", () => {
            this.cancelRenameCurrentConversation();
        });
    }

    private makeActionButton(
        icon: ConversationBarIconName,
        label: string,
        className: string,
    ): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.title = label;
        button.setAttribute("aria-label", label);
        const iconConfig = this.icons[icon];
        if (iconConfig?.className) {
            const iconEl = document.createElement("span");
            iconEl.className = `${iconConfig.className} conversation-action-icon`;
            iconEl.setAttribute("aria-hidden", "true");
            button.appendChild(iconEl);
        } else {
            button.textContent = iconConfig?.text ?? fallbackIconText[icon];
        }
        return button;
    }

    private renderStatus(): void {
        if (this.status.errorText) {
            this.statusEl.className =
                "conversation-status-summary disconnected";
            this.statusEl.textContent = this.status.errorText;
        } else if (this.status.switching) {
            this.statusEl.className = "conversation-status-summary switching";
            this.statusEl.textContent = this.status.statusLabel ?? "Connecting";
        } else if (this.status.connected) {
            this.statusEl.className = "conversation-status-summary connected";
            const parts = ["Connected"];
            const clientCount = this.formatClientCount(this.currentClientCount);
            if (clientCount) parts.push(clientCount);
            if (this.status.demoSuffix) parts.push(this.status.demoSuffix);
            this.statusEl.textContent = parts.join(" · ");
        } else {
            this.statusEl.className =
                "conversation-status-summary disconnected";
            this.statusEl.textContent =
                this.status.reconnectText ?? "Disconnected";
        }
    }

    private updateSummary(): void {
        const displayName =
            this.status.targetName ||
            this.currentConversationName ||
            this.currentConversationId?.substring(0, 8) ||
            "Conversation";
        this.nameBtn.textContent = displayName;
        this.renderStatus();
    }

    private updateControlsEnabled(): void {
        const enabled = this.isActionEnabled();
        const hasCurrentConversation = this.currentConversationId !== undefined;
        const createValue = this.newNameEl.value.trim();
        const renameValue = this.renameInputEl.value.trim();
        const createConflict = this.hasCreateConflict(createValue);
        const renameConflict = this.hasRenameConflict(renameValue);
        const renameUnchanged =
            renameValue !== "" &&
            this.currentConversationName.trim().toLowerCase() ===
                renameValue.toLowerCase();

        this.nameBtn.disabled = !enabled;
        if (this.currentCreateBtn) {
            this.currentCreateBtn.disabled = !enabled;
        }
        this.currentRenameBtn.disabled =
            !enabled || !hasCurrentConversation || this.isRenamingCurrent;
        this.currentDeleteBtn.disabled = !enabled || !hasCurrentConversation;
        this.newNameEl.disabled = !enabled;
        this.createBtn.disabled =
            !enabled || createValue === "" || createConflict;
        this.renameInputEl.disabled = !enabled || !this.isRenamingCurrent;
        this.renameSaveBtn.disabled =
            !enabled ||
            !this.isRenamingCurrent ||
            renameValue === "" ||
            renameConflict ||
            renameUnchanged;
        this.renameCancelBtn.disabled = !enabled || !this.isRenamingCurrent;
        this.searchInputEl.disabled = !enabled;

        this.renameInputEl.classList.toggle("conflict", renameConflict);
        if (renameConflict) {
            this.renameInputEl.setAttribute("aria-invalid", "true");
            this.renameInputEl.title =
                "A conversation with this name already exists.";
        } else {
            this.renameInputEl.removeAttribute("aria-invalid");
            this.renameInputEl.title = "Rename conversation";
        }

        this.newNameEl.classList.toggle("conflict", createConflict);
        if (createConflict) {
            this.newNameEl.setAttribute("aria-invalid", "true");
            this.newNameEl.title =
                "A conversation with this name already exists.";
            this.createHintEl.classList.remove("hidden");
        } else {
            this.newNameEl.removeAttribute("aria-invalid");
            this.newNameEl.title = "New conversation name";
            this.createHintEl.classList.add("hidden");
        }
    }

    private isActionEnabled(): boolean {
        return this.status.connected && !this.status.switching;
    }

    private formatClientCount(count: number | undefined): string {
        if (count === undefined) return "";
        return count === 1 ? "1 client" : `${count} clients`;
    }

    private setPopoverVisible(popover: HTMLElement, visible: boolean): void {
        popover.classList.toggle("hidden", !visible);
    }

    private hidePopovers(): void {
        this.setPopoverVisible(this.createPopoverEl, false);
        this.setPopoverVisible(this.searchPopoverEl, false);
        this.inlineRenameConversationId = undefined;
    }

    private isPopoverVisible(): boolean {
        return (
            !this.createPopoverEl.classList.contains("hidden") ||
            !this.searchPopoverEl.classList.contains("hidden")
        );
    }

    private hasRenameConflict(name: string): boolean {
        if (!name) return false;
        const lower = name.toLowerCase();
        return this.conversations.some(
            (conversation) =>
                conversation.conversationId !== this.currentConversationId &&
                conversation.name.toLowerCase() === lower,
        );
    }

    private hasCreateConflict(name: string): boolean {
        if (!name) return false;
        const lower = name.toLowerCase();
        return this.conversations.some(
            (conversation) => conversation.name.toLowerCase() === lower,
        );
    }

    private hasConversationRenameConflict(
        conversationId: string,
        name: string,
    ): boolean {
        if (!name) return false;
        const lower = name.toLowerCase();
        return this.conversations.some(
            (conversation) =>
                conversation.conversationId !== conversationId &&
                conversation.name.toLowerCase() === lower,
        );
    }

    private setRenameMode(renaming: boolean): void {
        this.isRenamingCurrent = renaming;
        this.nameBtn.classList.toggle("hidden", renaming);
        this.renameEditorEl.classList.toggle("hidden", !renaming);
        if (!renaming) {
            this.renameInputEl.classList.remove("conflict");
            this.renameInputEl.removeAttribute("aria-invalid");
        }
    }

    private beginRenameCurrentConversation(): void {
        if (!this.isActionEnabled() || !this.currentConversationId) return;
        this.hidePopovers();
        this.renameInputEl.value =
            this.currentConversationName ||
            this.currentConversationId.substring(0, 8);
        this.setRenameMode(true);
        this.updateControlsEnabled();
        this.renameInputEl.focus();
        this.renameInputEl.select();
    }

    private cancelRenameCurrentConversation(): void {
        this.setRenameMode(false);
        this.updateControlsEnabled();
    }

    private submitRenameCurrentConversation(): void {
        void this.submitRenameCurrentConversationAsync();
    }

    private async submitRenameCurrentConversationAsync(): Promise<void> {
        if (
            !this.isActionEnabled() ||
            !this.currentConversationId ||
            !this.isRenamingCurrent
        ) {
            return;
        }
        const name = this.renameInputEl.value.trim();
        const conflict = this.hasRenameConflict(name);
        const unchanged =
            name !== "" &&
            this.currentConversationName.trim().toLowerCase() ===
                name.toLowerCase();
        if (!name || conflict || unchanged) return;

        const succeeded = await this.fire(() =>
            this.controller.renameConversation(
                this.currentConversationId!,
                name,
            ),
        );
        if (!succeeded) return;
        this.currentConversationName = name;
        this.status.errorText = undefined;
        this.updateSummary();
        this.setRenameMode(false);
        this.updateControlsEnabled();
    }

    private renderConversationSearchResults(): void {
        const query = this.searchInputEl.value.trim().toLowerCase();
        const matches = this.conversations.filter((conversation) =>
            conversation.name.toLowerCase().includes(query),
        );

        if (
            this.inlineRenameConversationId &&
            !this.conversations.some(
                (conversation) =>
                    conversation.conversationId ===
                    this.inlineRenameConversationId,
            )
        ) {
            this.inlineRenameConversationId = undefined;
        }

        this.searchResultsEl.innerHTML = "";
        if (matches.length === 0) {
            const emptyEl = document.createElement("div");
            emptyEl.className = "conversation-search-empty";
            emptyEl.textContent = "No conversations found";
            this.searchResultsEl.appendChild(emptyEl);
            return;
        }

        for (const conversation of matches) {
            this.renderConversationSearchResult(conversation);
        }
    }

    private renderConversationSearchResult(
        conversation: ConversationBarConversation,
    ): void {
        const rowEl = document.createElement("div");
        rowEl.className = "conversation-search-result-row";

        const resultBtn = document.createElement("button");
        resultBtn.type = "button";
        resultBtn.className = "conversation-search-result";
        resultBtn.setAttribute("role", "option");
        const isCurrent =
            conversation.conversationId === this.currentConversationId;
        resultBtn.setAttribute("aria-selected", String(isCurrent));
        if (isCurrent) resultBtn.classList.add("current");
        const isRenameRow =
            this.inlineRenameConversationId === conversation.conversationId;
        if (isRenameRow) resultBtn.classList.add("hidden");

        const nameEl = document.createElement("span");
        nameEl.className = "conversation-search-result-name";
        nameEl.textContent = conversation.name;
        resultBtn.appendChild(nameEl);

        const countEl = document.createElement("span");
        countEl.className = "conversation-search-result-count";
        countEl.textContent = this.formatClientCount(conversation.clientCount);
        resultBtn.appendChild(countEl);

        resultBtn.addEventListener("click", () => {
            if (conversation.conversationId !== this.currentConversationId) {
                void this.fire(() =>
                    this.controller.switchConversation(
                        conversation.conversationId,
                    ),
                );
            }
            this.hidePopovers();
        });

        const actionsEl = document.createElement("div");
        actionsEl.className = "conversation-search-result-actions";
        if (isRenameRow) actionsEl.classList.add("hidden");

        const editBtn = this.makeActionButton(
            "rename",
            "Rename conversation",
            "conversation-search-item-btn",
        );
        editBtn.disabled = !this.isActionEnabled();
        editBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            if (!this.isActionEnabled()) return;
            this.inlineRenameConversationId = conversation.conversationId;
            this.renderConversationSearchResults();
            const input = this.searchResultsEl.querySelector(
                `input[data-conversation-id="${conversation.conversationId}"]`,
            ) as HTMLInputElement | null;
            input?.focus();
            input?.select();
        });
        actionsEl.appendChild(editBtn);

        const deleteBtn = this.makeActionButton(
            "delete",
            "Delete conversation",
            "conversation-search-item-btn",
        );
        deleteBtn.disabled = !this.isActionEnabled();
        deleteBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            if (!this.isActionEnabled()) return;
            void this.fire(() =>
                this.controller.deleteConversation(conversation.conversationId),
            );
        });
        actionsEl.appendChild(deleteBtn);

        const renameEditorEl = document.createElement("div");
        renameEditorEl.className = "conversation-search-inline-rename";
        if (!isRenameRow) renameEditorEl.classList.add("hidden");

        const renameInputEl = document.createElement("input");
        renameInputEl.type = "text";
        renameInputEl.value = conversation.name;
        renameInputEl.title = "Rename conversation";
        renameInputEl.setAttribute("aria-label", "Rename conversation");
        renameInputEl.setAttribute(
            "data-conversation-id",
            conversation.conversationId,
        );
        renameEditorEl.appendChild(renameInputEl);

        const renameSaveBtn = this.makeActionButton(
            "save",
            "Save conversation name",
            "conversation-search-item-btn",
        );
        renameEditorEl.appendChild(renameSaveBtn);

        const renameCancelBtn = this.makeActionButton(
            "cancel",
            "Cancel rename",
            "conversation-search-item-btn",
        );
        renameEditorEl.appendChild(renameCancelBtn);

        const syncRenameState = () => {
            const name = renameInputEl.value.trim();
            const conflict = this.hasConversationRenameConflict(
                conversation.conversationId,
                name,
            );
            const unchanged =
                name.toLowerCase() === conversation.name.toLowerCase();
            renameSaveBtn.disabled =
                !this.isActionEnabled() || !name || conflict || unchanged;
            renameInputEl.classList.toggle("conflict", conflict);
            if (conflict) {
                renameInputEl.setAttribute("aria-invalid", "true");
                renameInputEl.title =
                    "A conversation with this name already exists.";
            } else {
                renameInputEl.removeAttribute("aria-invalid");
                renameInputEl.title = "Rename conversation";
            }
        };

        const cancelInlineRename = () => {
            this.inlineRenameConversationId = undefined;
            this.renderConversationSearchResults();
        };

        const submitInlineRename = () => {
            if (!this.isActionEnabled()) return;
            const name = renameInputEl.value.trim();
            const conflict = this.hasConversationRenameConflict(
                conversation.conversationId,
                name,
            );
            const unchanged =
                name.toLowerCase() === conversation.name.toLowerCase();
            if (!name || conflict || unchanged) return;
            this.inlineRenameConversationId = undefined;
            this.status.errorText = undefined;
            void this.fire(() =>
                this.controller.renameConversation(
                    conversation.conversationId,
                    name,
                ),
            );
        };

        renameInputEl.addEventListener("input", syncRenameState);
        renameInputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                submitInlineRename();
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                cancelInlineRename();
            }
        });
        renameSaveBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            submitInlineRename();
        });
        renameCancelBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            cancelInlineRename();
        });
        syncRenameState();

        rowEl.appendChild(resultBtn);
        rowEl.appendChild(actionsEl);
        rowEl.appendChild(renameEditorEl);
        this.searchResultsEl.appendChild(rowEl);
    }

    private showConversationSearchPopover(): void {
        if (!this.isActionEnabled()) return;
        this.setPopoverVisible(this.createPopoverEl, false);
        this.inlineRenameConversationId = undefined;
        this.searchInputEl.value = "";
        this.renderConversationSearchResults();
        this.setPopoverVisible(this.searchPopoverEl, true);
        void this.fire(() => this.controller.requestConversations());
        this.searchInputEl.focus();
    }

    private createConversationFromInput(): void {
        const name = this.newNameEl.value.trim();
        if (!name || !this.isActionEnabled() || this.hasCreateConflict(name)) {
            return;
        }
        this.status.errorText = undefined;
        void this.fire(() => this.controller.createConversation(name));
        this.newNameEl.value = "";
        this.hidePopovers();
        this.updateControlsEnabled();
    }

    private showCreateConversationPopover(): void {
        if (!this.isActionEnabled()) return;
        this.setPopoverVisible(this.searchPopoverEl, false);
        this.setPopoverVisible(this.createPopoverEl, true);
        this.newNameEl.focus();
        this.newNameEl.select();
    }

    private async fire(op: () => void | Promise<void>): Promise<boolean> {
        try {
            await op();
            return true;
        } catch (e: any) {
            this.setError(e?.message ?? String(e));
            return false;
        }
    }
}
