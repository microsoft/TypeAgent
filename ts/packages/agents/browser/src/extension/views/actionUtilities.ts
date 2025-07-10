// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface StoredAction {
    id: string;
    name: string;
    description?: string;
    author: "user" | "discovered";
    scope?: { pattern: string };
    urlPattern?: string;
    definition?: ActionDefinition;
    steps?: ActionStep[];
    screenshot?: string[];
    html?: string[];
}

export interface ActionDefinition {
    intentSchema?: string;
    actionsJson?: any;
    screenshot?: string[];
    htmlFragments?: string[];
    steps?: string | ActionStep[];
}

export interface ActionStep {
    type: string;
    timestamp: number;
    [key: string]: any;
}

export interface ActionQueryOptions {
    includeGlobal?: boolean;
    author?: "discovered" | "user";
}

export interface FilterOptions {
    searchQuery?: string;
    author?: string;
    domain?: string;
    category?: string;
}

export interface NotificationConfig {
    message: string;
    type: "success" | "error" | "warning" | "info";
    duration?: number;
    persistent?: boolean;
}

export interface ModalConfig {
    title: string;
    body: string | HTMLElement;
    buttons?: ModalButton[];
    size?: "sm" | "lg" | "xl";
    dismissible?: boolean;
}

export interface ModalButton {
    text: string;
    className: string;
    handler?: () => void;
}

export interface DeleteActionResult {
    success: boolean;
    error?: string;
    actionId: string;
}

export interface BulkDeleteResult {
    successCount: number;
    errorCount: number;
    errors: Array<{ actionId: string; error: string }>;
}

export interface ActionStats {
    totalActions: number;
    actions: StoredAction[];
}

export type ActionCategory =
    | "Search"
    | "Authentication"
    | "Form Interaction"
    | "Navigation"
    | "E-commerce"
    | "File Operations"
    | "Other";
export type NotificationType = "success" | "error" | "warning" | "info";

export async function getActionsForUrl(
    url: string,
    options: ActionQueryOptions = {},
): Promise<StoredAction[]> {
    try {
        const response = await chrome.runtime.sendMessage({
            type: "getActionsForUrl",
            url: url,
            includeGlobal: options.includeGlobal ?? true,
            author: options.author,
        });

        return response?.actions || [];
    } catch (error) {
        console.error("Failed to get actions for URL:", error);
        return [];
    }
}

export async function getAllActions(): Promise<StoredAction[]> {
    try {
        const response = await chrome.runtime.sendMessage({
            type: "getAllActions",
        });

        return response?.actions || [];
    } catch (error) {
        console.error("Failed to get all actions:", error);
        return [];
    }
}

export async function getActionDomains(): Promise<string[]> {
    try {
        const response = await chrome.runtime.sendMessage({
            type: "getActionDomains",
        });

        return response?.domains || [];
    } catch (error) {
        console.error("Failed to get action domains:", error);
        return [];
    }
}
export async function deleteAction(
    actionId: string,
): Promise<DeleteActionResult> {
    try {
        const response = await chrome.runtime.sendMessage({
            type: "deleteAction",
            actionId: actionId,
        });

        return {
            success: response?.success || false,
            error: response?.error,
            actionId: actionId,
        };
    } catch (error) {
        console.error("Failed to delete action:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            actionId: actionId,
        };
    }
}

export async function deleteMultipleActions(
    actionIds: string[],
): Promise<BulkDeleteResult> {
    const result: BulkDeleteResult = {
        successCount: 0,
        errorCount: 0,
        errors: [],
    };

    for (const actionId of actionIds) {
        const deleteResult = await deleteAction(actionId);
        if (deleteResult.success) {
            result.successCount++;
        } else {
            result.errorCount++;
            result.errors.push({
                actionId,
                error: deleteResult.error || "Unknown error",
            });
        }
    }

    return result;
}

export function filterActions(
    actions: StoredAction[],
    options: FilterOptions,
): StoredAction[] {
    let filtered = [...actions];

    if (options.searchQuery) {
        const query = options.searchQuery.toLowerCase();
        filtered = filtered.filter((action) => {
            const nameMatch = action.name.toLowerCase().includes(query);
            const descMatch =
                action.description &&
                action.description.toLowerCase().includes(query);
            const domain = extractDomain(action);
            const domainMatch = domain && domain.toLowerCase().includes(query);

            return nameMatch || descMatch || domainMatch;
        });
    }

    if (options.author && options.author !== "all") {
        filtered = filtered.filter(
            (action) => action.author === options.author,
        );
    }

    if (options.domain && options.domain !== "all") {
        filtered = filtered.filter((action) => {
            const domain = extractDomain(action);
            return domain === options.domain;
        });
    }

    if (options.category && options.category !== "all") {
        filtered = filtered.filter((action) => {
            const category = categorizeAction(action);
            return category === options.category;
        });
    }

    return filtered;
}

export function showNotification(
    message: string,
    type: NotificationType = "info",
    duration: number = 3000,
): void {
    const toast = document.createElement("div");
    const alertClass = type === "error" ? "danger" : type;
    toast.className = `alert alert-${alertClass} alert-dismissible position-fixed`;
    toast.style.cssText =
        "top: 20px; right: 20px; z-index: 1050; min-width: 300px;";

    const messageSpan = document.createElement("span");
    messageSpan.textContent = message;

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "btn-close";
    closeButton.setAttribute("data-bs-dismiss", "alert");

    toast.appendChild(messageSpan);
    toast.appendChild(closeButton);
    document.body.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, duration);
}

export async function showConfirmationDialog(
    message: string,
    title: string = "Confirm Action",
): Promise<boolean> {
    return new Promise((resolve) => {
        const confirmed = confirm(message);
        resolve(confirmed);
    });
}

export function showLoadingState(
    container: HTMLElement,
    message: string = "Loading...",
): void {
    container.innerHTML = `
        <div class="text-center text-muted p-3">
            <div class="spinner-border spinner-border-sm mb-2" role="status" aria-hidden="true"></div>
            <p class="mb-0">${message}</p>
        </div>
    `;
}

export function showEmptyState(
    container: HTMLElement,
    message: string,
    icon: string = "bi-info-circle",
): void {
    container.innerHTML = `
        <div class="text-center text-muted p-3">
            <i class="${icon} fs-4 mb-2"></i>
            <p class="mb-0">${message}</p>
        </div>
    `;
}

export function showErrorState(container: HTMLElement, message: string): void {
    container.innerHTML = `
        <div class="text-center text-danger p-3">
            <i class="bi bi-exclamation-triangle fs-4 mb-2"></i>
            <p class="mb-0">${message}</p>
        </div>
    `;
}
export function extractDomain(action: StoredAction): string | null {
    const pattern = action.scope?.pattern || action.urlPattern;
    if (pattern) {
        try {
            return new URL(pattern).hostname;
        } catch {
            const domainMatch = pattern.match(/(?:https?:\/\/)?([^\/\*]+)/);
            return domainMatch ? domainMatch[1] : null;
        }
    }
    return null;
}

export function normalizeUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        return `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
    } catch {
        return url;
    }
}

export function matchesUrlPattern(url: string, pattern: string): boolean {
    try {
        const normalizedUrl = normalizeUrl(url);
        const normalizedPattern = normalizeUrl(pattern);

        const regex = new RegExp(
            normalizedPattern.replace(/\*/g, ".*").replace(/\?/g, "\\?"),
        );
        return regex.test(normalizedUrl);
    } catch {
        return url.includes(pattern) || pattern.includes(url);
    }
}

export function getDomainFromUrl(url: string): string | null {
    try {
        return new URL(url).hostname;
    } catch {
        const domainMatch = url.match(/(?:https?:\/\/)?([^\/\*]+)/);
        return domainMatch ? domainMatch[1] : null;
    }
}

export function categorizeAction(action: StoredAction): ActionCategory {
    const text = `${action.name} ${action.description || ""}`.toLowerCase();

    if (text.includes("search") || text.includes("find")) return "Search";
    if (
        text.includes("login") ||
        text.includes("sign in") ||
        text.includes("auth")
    )
        return "Authentication";
    if (
        text.includes("form") ||
        text.includes("submit") ||
        text.includes("input")
    )
        return "Form Interaction";
    if (
        text.includes("click") ||
        text.includes("button") ||
        text.includes("link")
    )
        return "Navigation";
    if (
        text.includes("cart") ||
        text.includes("buy") ||
        text.includes("purchase") ||
        text.includes("order")
    )
        return "E-commerce";
    if (
        text.includes("download") ||
        text.includes("upload") ||
        text.includes("file")
    )
        return "File Operations";

    return "Other";
}

export function groupActionsByDomain(
    actions: StoredAction[],
): Map<string, StoredAction[]> {
    const grouped = new Map<string, StoredAction[]>();

    actions.forEach((action) => {
        const domain = extractDomain(action) || "unknown";
        if (!grouped.has(domain)) {
            grouped.set(domain, []);
        }
        grouped.get(domain)!.push(action);
    });

    return grouped;
}

export function formatRelativeDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    } else if (diffHours < 24) {
        return `${diffHours}h ago`;
    } else if (diffDays === 1) {
        return "yesterday";
    } else if (diffDays < 7) {
        return `${diffDays}d ago`;
    } else if (diffDays < 30) {
        return `${Math.floor(diffDays / 7)}w ago`;
    } else {
        return date.toLocaleDateString();
    }
}

export function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

export function createActionBadge(type: string, text: string): string {
    const escapedText = escapeHtml(text);
    return `<span class="badge badge-${type}">${escapedText}</span>`;
}

export function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength - 3) + "...";
}

export function createButton(
    text: string,
    classes: string,
    attributes: Record<string, string> = {},
): string {
    const attrs = Object.entries(attributes)
        .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
        .join(" ");
    return `<button class="${classes}" ${attrs}>${text}</button>`;
}

export function extractCategories(actions: StoredAction[]): string[] {
    const categories = new Set<string>();

    actions.forEach((action) => {
        categories.add(categorizeAction(action));
    });

    return Array.from(categories).sort();
}
