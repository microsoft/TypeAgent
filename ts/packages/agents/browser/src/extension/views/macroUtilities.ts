// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface FilterOptions {
    searchQuery?: string;
    author?: string;
    domain?: string;
    category?: string;
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

async function sendToServiceWorker<T>(message: any): Promise<T> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response: any) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response);
        });
    });
}

export async function getAllWebFlows(): Promise<any[]> {
    const response = await sendToServiceWorker<any>({
        type: "getAllWebFlows",
    });
    return response?.actions || response || [];
}

export async function deleteWebFlow(
    name: string,
): Promise<{ success: boolean; error?: string }> {
    return await sendToServiceWorker<{ success: boolean; error?: string }>({
        type: "deleteWebFlow",
        name,
    });
}

export function filterMacros(macros: any[], options: FilterOptions): any[] {
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
export function extractDomain(macro: any): string | null {
    // WebFlow scope format
    if (macro.scope?.domains?.length > 0) {
        return macro.scope.domains[0];
    }
    // Legacy StoredMacro format
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

export function categorizeMacro(macro: any): MacroCategory {
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

export function groupMacrosByDomain(macros: any[]): Map<string, any[]> {
    const grouped = new Map<string, any[]>();

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

export function extractCategories(macros: any[]): string[] {
    const categories = new Set<string>();

    macros.forEach((macro) => {
        categories.add(categorizeMacro(macro));
    });

    return Array.from(categories).sort();
}
