// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import "./memoryHubImports.css";
import { WebsiteImportManager } from "./websiteImportManager";
import { createExtensionService } from "./knowledgeUtilities";
import type {
    FolderImportOptions,
    ImportOptions,
    ImportProgress,
    ImportResult,
} from "./importTypes/websiteImport.types";

type ImportKind = "browser" | "folder";

export interface MemoryHubImportOptions {
    targetLabel: string;
    onError: (error: unknown) => void;
    onComplete: () => Promise<void>;
    onOpenJobs?: () => void;
}

function field<T extends HTMLElement>(root: HTMLElement, name: string): T {
    const element = root.querySelector<T>(`[name="${name}"]`);
    if (!element) throw new Error(`Missing import field: ${name}`);
    return element;
}

function browserOptions(root: HTMLElement): ImportOptions {
    const type = field<HTMLSelectElement>(root, "type").value;
    return {
        source:
            field<HTMLSelectElement>(root, "source").value === "edge"
                ? "edge"
                : "chrome",
        type: type === "history" ? "history" : "bookmarks",
        mode: "content",
        limit: Number(field<HTMLInputElement>(root, "browserLimit").value),
        days:
            type === "history"
                ? Number(field<HTMLInputElement>(root, "days").value)
                : undefined,
        folder:
            type === "bookmarks"
                ? field<HTMLInputElement>(
                      root,
                      "bookmarkFolder",
                  ).value.trim() || undefined
                : undefined,
        maxConcurrent: Number(
            field<HTMLInputElement>(root, "concurrent").value,
        ),
        contentTimeout:
            Number(field<HTMLInputElement>(root, "timeout").value) * 1000,
    };
}

function folderOptions(root: HTMLElement): FolderImportOptions {
    return {
        folderPath: field<HTMLInputElement>(root, "folderPath").value.trim(),
        mode: "content",
        recursive: field<HTMLInputElement>(root, "recursive").checked,
        preserveStructure: field<HTMLInputElement>(root, "preserveStructure")
            .checked,
        skipHidden: field<HTMLInputElement>(root, "skipHidden").checked,
        fileTypes: Array.from(
            root.querySelectorAll<HTMLInputElement>(
                '[name="fileType"]:checked',
            ),
            (input) => input.value,
        ),
        limit: Number(field<HTMLInputElement>(root, "folderLimit").value),
        maxFileSize:
            Number(field<HTMLInputElement>(root, "maxSize").value) *
            1024 *
            1024,
    };
}

function resultText(result: ImportResult): string {
    const summary = result.summary;
    return [
        result.success ? "Import completed." : "Import failed.",
        `Import ID: ${result.importId}`,
        `Items: ${result.itemCount}; duration: ${(result.duration / 1000).toFixed(1)} seconds`,
        `Processed: ${summary.totalProcessed}; imported: ${summary.successfullyImported}`,
        `Knowledge: ${summary.knowledgeExtracted}; entities: ${summary.entitiesFound}; topics: ${summary.topicsIdentified}; actions: ${summary.actionsDetected}`,
        ...result.errors.map((error) => `${error.type}: ${error.message}`),
    ].join("\n");
}

export function mountMemoryHubImports(
    host: HTMLElement,
    options: MemoryHubImportOptions,
): {
    openBrowserImport(): void;
    openFolderImport(): void;
    dispose(): void;
} {
    const manager = new WebsiteImportManager();
    const service = createExtensionService();
    const dialog = document.createElement("dialog");
    dialog.className = "hub-import-dialog";
    dialog.setAttribute("aria-label", "Import browser memories");
    dialog.innerHTML = `
        <h2>Import browser memories</h2>
        <p><strong name="target"></strong></p>
        <p class="hub-import-warning">These imports always write to the fixed browser-owned corpus.
        The current Memory Hub corpus selector does not change that target.</p>
        <p>Cancellation unavailable: the import API does not support cancellation.
        Closing this dialog does not cancel an import. Reopen it to view progress.</p>
        <form>
            <fieldset name="browserFields">
                <legend>Bookmarks or history from the agent host</legend>
                <p>Close the source browser if its data files are locked.</p>
                <label>Browser <select name="source"><option value="chrome">Chrome</option><option value="edge">Microsoft Edge</option></select></label>
                <label>Import <select name="type"><option value="bookmarks">Bookmarks</option><option value="history">History</option></select></label>
                <label>Item limit <input name="browserLimit" type="number" min="1" max="50000" step="1" value="1000" required></label>
                <label name="historyLabel" hidden>History days <input name="days" type="number" min="1" max="365" step="1" value="30"></label>
                <label name="bookmarkLabel">Bookmark folder (optional) <input name="bookmarkFolder" type="text"></label>
                <label>Concurrent requests <input name="concurrent" type="number" min="1" max="20" step="1" value="5" required></label>
                <label>Content timeout (seconds) <input name="timeout" type="number" min="5" max="120" step="1" value="30" required></label>
            </fieldset>
            <fieldset name="folderFields" hidden disabled>
                <legend>HTML folder on the agent host</legend>
                <p>This is a server-side path, not a folder upload from this device.</p>
                <label>Folder path <input name="folderPath" type="text" maxlength="260" required></label>
                <label>File limit <input name="folderLimit" type="number" min="1" max="10000" step="1" value="1000" required></label>
                <label>Maximum file size (MB) <input name="maxSize" type="number" min="0.0009765625" max="500" step="any" value="50" required></label>
                <label><input name="recursive" type="checkbox" checked> Include subfolders</label>
                <label><input name="preserveStructure" type="checkbox" checked> Preserve folder structure</label>
                <label><input name="skipHidden" type="checkbox" checked> Skip hidden files</label>
                <div>File types (choose at least one)</div>
                <label><input name="fileType" type="checkbox" value=".html" checked> .html</label>
                <label><input name="fileType" type="checkbox" value=".htm" checked> .htm</label>
                <label><input name="fileType" type="checkbox" value=".mhtml" checked> .mhtml</label>
            </fieldset>
            <button name="start" type="submit">Start import</button>
        </form>
        <pre name="status" role="status" aria-live="polite"></pre>
        <p name="connection" role="alert"></p>
        <p>Individual import job IDs are not returned by these adapters. The jobs link opens the fixed browser corpus, not an import-specific job.</p>
        <button name="jobs" type="button">View browser-corpus ingestion jobs</button>
        <button name="close" type="button">Close dialog</button>`;
    host.append(dialog);
    field(dialog, "target").textContent =
        `Import target: ${options.targetLabel}`;
    const jobs = field<HTMLButtonElement>(dialog, "jobs");
    jobs.hidden = !options.onOpenJobs;
    jobs.addEventListener("click", () => {
        if (!options.onOpenJobs) return;
        dialog.close();
        options.onOpenJobs();
    });
    const form = dialog.querySelector("form")!;
    const status = field(dialog, "status");
    const connection = field(dialog, "connection");
    const start = field<HTMLButtonElement>(dialog, "start");
    let kind: ImportKind = "browser";
    let active = false;
    let disposed = false;
    let importId: string | undefined;
    let progressLost = false;

    function updateFields(): void {
        const browser = field<HTMLFieldSetElement>(dialog, "browserFields");
        const folder = field<HTMLFieldSetElement>(dialog, "folderFields");
        browser.hidden = kind !== "browser";
        folder.hidden = kind !== "folder";
        browser.disabled = active || kind !== "browser";
        folder.disabled = active || kind !== "folder";
        start.disabled = active;
        const history =
            field<HTMLSelectElement>(dialog, "type").value === "history";
        field(dialog, "historyLabel").hidden = !history;
        field<HTMLInputElement>(dialog, "days").disabled = !history;
        field(dialog, "bookmarkLabel").hidden = history;
        field<HTMLInputElement>(dialog, "bookmarkFolder").disabled = history;
    }

    function progress(value: ImportProgress): void {
        importId = value.importId;
        if (disposed) return;
        status.textContent = [
            `Stage: ${value.phase}`,
            `Items processed: ${value.processedItems} / ${value.totalItems}`,
            value.currentItem,
            value.itemDetails?.currentAction,
            value.itemDetails?.url,
            value.itemDetails?.filename,
            ...value.errors.map((error) => error.message),
            "Awaiting the authoritative import result.",
        ]
            .filter(Boolean)
            .join("\n");
    }

    function report(error: unknown): void {
        if (disposed) return;
        status.textContent = `Import error: ${error instanceof Error ? error.message : String(error)}`;
        options.onError(error);
    }

    async function finish(result: ImportResult): Promise<void> {
        if (disposed) return;
        status.textContent = resultText(result);
        if (progressLost) {
            connection.textContent =
                "Progress connection lost during import. Some updates may be missing because durable polling/replay is unavailable. The import response is shown above.";
        }
        if (!result.success) {
            options.onError(
                new Error(
                    result.errors.map((error) => error.message).join("\n") ||
                        "Import failed without error details.",
                ),
            );
            return;
        }
        try {
            await options.onComplete();
        } catch (error) {
            if (disposed) return;
            status.textContent += `\nImport completed, but refreshing Memory Hub failed: ${error instanceof Error ? error.message : String(error)}`;
            options.onError(error);
        }
    }

    async function run(): Promise<void> {
        if (active || disposed || !form.reportValidity()) return;
        const browser = browserOptions(dialog);
        const folder = folderOptions(dialog);
        const validation =
            kind === "browser"
                ? manager.validateImportOptions(browser)
                : manager.validateFolderImportOptions(folder);
        if (kind === "folder" && !folder.fileTypes?.length)
            validation.errors.push("Choose at least one HTML file type.");
        if (validation.errors.length) {
            report(new Error(validation.errors.join("\n")));
            return;
        }
        active = true;
        progressLost = false;
        connection.textContent = "";
        status.textContent = [
            "Checking import service…",
            ...validation.warnings,
        ].join("\n");
        updateFields();
        try {
            const health = await service.checkWebSocketConnection();
            if (disposed) return;
            if (!health.connected)
                throw new Error(
                    "Import service is offline. No import was started.",
                );
            manager.onProgressUpdate(progress);
            const result =
                kind === "browser"
                    ? await manager.startWebActivityImport(browser)
                    : await manager.startFolderImport(folder);
            await finish(result);
        } catch (error) {
            report(error);
        } finally {
            manager.onProgressUpdate(() => {});
            if (importId) service.removeImportProgress(importId);
            importId = undefined;
            active = false;
            if (!disposed) updateFields();
        }
    }

    function streamError(): void {
        if (!active || disposed || progressLost) return;
        progressLost = true;
        const message =
            "Progress connection lost. Progress may be missing: durable polling/replay is unavailable. The import may still be running; do not start another import. Waiting for its result.";
        connection.textContent = message;
        options.onError(new Error(message));
    }

    function open(requestedKind: ImportKind): void {
        if (disposed) return;
        if (!active) kind = requestedKind;
        updateFields();
        if (!dialog.open) dialog.showModal();
    }

    form.onsubmit = (event) => {
        event.preventDefault();
        void run();
    };
    field<HTMLSelectElement>(dialog, "type").onchange = updateFields;
    field<HTMLButtonElement>(dialog, "close").onclick = () => dialog.close();
    window.addEventListener("viewServiceError", streamError);
    updateFields();
    return {
        openBrowserImport: () => open("browser"),
        openFolderImport: () => open("folder"),
        dispose: () => {
            if (disposed) return;
            disposed = true;
            window.removeEventListener("viewServiceError", streamError);
            manager.onProgressUpdate(() => {});
            if (importId) service.removeImportProgress(importId);
            form.onsubmit = null;
            field<HTMLSelectElement>(dialog, "type").onchange = null;
            field<HTMLButtonElement>(dialog, "close").onclick = null;
            if (dialog.open) dialog.close();
            dialog.remove();
        },
    };
}
