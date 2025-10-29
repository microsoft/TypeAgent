// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createExtensionService } from "./knowledgeUtilities";

export interface StoredMacro {
    id: string;
    name: string;
    description?: string;
    author: "user" | "discovered";
    scope?: { pattern: string };
    urlPattern?: string;
    definition?: MacroDefinition;
    steps?: MacroStep[];
    screenshot?: string[];
    html?: string[];
}

export interface MacroDefinition {
    intentSchema?: string;
    screenshot?: string[];
    htmlFragments?: string[];
    steps?: string | MacroStep[];
}

export interface MacroStep {
    type: string;
    timestamp: number;
    [key: string]: any;
}

export interface MacroQueryOptions {
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

export interface DeleteMacroResult {
    success: boolean;
    error?: string;
    macroId: string;
}

export interface BulkDeleteResult {
    successCount: number;
    errorCount: number;
    errors: Array<{ macroId: string; error: string }>;
}

export interface ActionStats {
    totalMacros: number;
    macros: StoredMacro[];
}

export type MacroCategory =
    | "Search"
    | "Authentication"
    | "Form Interaction"
    | "Navigation"
    | "E-commerce"
    | "File Operations"
    | "Other";
export type NotificationType = "success" | "error" | "warning" | "info";

// Create global extension service instance
const extensionService = createExtensionService();

export async function getMacrosForUrl(
    url: string,
    options: MacroQueryOptions = {},
): Promise<StoredMacro[]> {
    return await extensionService.getMacrosForUrl(url, options);
}

export async function getAllMacros(): Promise<StoredMacro[]> {
    return await extensionService.getAllMacros();
}

export async function getMacroDomains(): Promise<string[]> {
    return await extensionService.getMacroDomains();
}
export async function deleteMacro(macroId: string): Promise<DeleteMacroResult> {
    return await extensionService.deleteMacro(macroId);
}

export async function deleteMultipleMacros(
    macroIds: string[],
): Promise<BulkDeleteResult> {
    const result: BulkDeleteResult = {
        successCount: 0,
        errorCount: 0,
        errors: [],
    };

    for (const macroId of macroIds) {
        const deleteResult = await deleteMacro(macroId);
        if (deleteResult.success) {
            result.successCount++;
        } else {
            result.errorCount++;
            result.errors.push({
                macroId,
                error: deleteResult.error || "Unknown error",
            });
        }
    }

    return result;
}

export function filterMacros(
    macros: StoredMacro[],
    options: FilterOptions,
): StoredMacro[] {
    let filtered = [...macros];

    if (options.searchQuery) {
        const query = options.searchQuery.toLowerCase();
        filtered = filtered.filter((macro) => {
            const nameMatch = macro.name.toLowerCase().includes(query);
            const descMatch =
                macro.description &&
                macro.description.toLowerCase().includes(query);
            const domain = extractDomain(macro);
            const domainMatch = domain && domain.toLowerCase().includes(query);

            return nameMatch || descMatch || domainMatch;
        });
    }

    if (options.author && options.author !== "all") {
        filtered = filtered.filter((macro) => macro.author === options.author);
    }

    if (options.domain && options.domain !== "all") {
        filtered = filtered.filter((macro) => {
            const domain = extractDomain(macro);
            return domain === options.domain;
        });
    }

    if (options.category && options.category !== "all") {
        filtered = filtered.filter((macro) => {
            const category = categorizeMacro(macro);
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
export function extractDomain(macro: StoredMacro): string | null {
    const pattern = macro.scope?.pattern || macro.urlPattern;
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
            normalizedPattern
                .replace(/\\/g, "\\\\") // Escape backslashes
                .replace(/\*/g, ".*")
                .replace(/\?/g, "\\?"),
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

export function categorizeMacro(macro: StoredMacro): MacroCategory {
    const text = `${macro.name} ${macro.description || ""}`.toLowerCase();

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

export function groupMacrosByDomain(
    macros: StoredMacro[],
): Map<string, StoredMacro[]> {
    const grouped = new Map<string, StoredMacro[]>();

    macros.forEach((macro) => {
        const domain = extractDomain(macro) || "unknown";
        if (!grouped.has(domain)) {
            grouped.set(domain, []);
        }
        grouped.get(domain)!.push(macro);
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

export function extractCategories(macros: StoredMacro[]): string[] {
    const categories = new Set<string>();

    macros.forEach((macro) => {
        categories.add(categorizeMacro(macro));
    });

    return Array.from(categories).sort();
}
