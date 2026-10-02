// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type NotificationType = "success" | "error" | "warning" | "info";

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

export async function showConfirmationDialog(message: string): Promise<boolean> {
    return new Promise((resolve) => {
        const confirmed = confirm(message);
        resolve(confirmed);
    });
}
