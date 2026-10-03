// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ProcedureVersion } from "@typeagent/memory-service";
import type { RunbookBindingSuggestion } from "@typeagent/browser-control-rpc/viewRpc";
import { invokeView } from "./viewClient";
import { validateRunbookBindingArguments } from "@typeagent/memory-service/agent-edition-validation";
import {
    rbButton,
    rbCheck,
    rbError,
    rbField,
    rbNode,
    rbSelect,
} from "./memoryHubRunbookUi";

function argumentsObject(text: string): Record<string, unknown> {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error("Binding arguments must be a JSON object.");
    return Object.fromEntries(Object.entries(value));
}
export function mountRunbookBinding(
    host: HTMLElement,
    options: {
        procedure: () => ProcedureVersion | undefined;
        dirty: () => boolean;
        onSaved: (procedure: ProcedureVersion) => Promise<void>;
        onError: (error: unknown) => void;
        onPendingChanged: (pending: boolean) => void;
    },
) {
    const dialog = rbNode("dialog", undefined, "runbook-dialog");
    dialog.setAttribute("aria-label", "Explicit binding acceptance");
    host.append(dialog);
    let sequence = 0;
    let disposed = false;
    let lastFocus: HTMLElement | null = null;
    let working = false;
    let dialogDirty = false;
    let lastStepId = "";
    function close() {
        if (
            dialogDirty &&
            !working &&
            !confirm(
                "Discard unaccepted binding choices and close this dialog?",
            )
        )
            return;
        if (
            working &&
            !confirm(
                "Close this binding dialog? The in-flight acceptance cannot be canceled and may still commit.",
            )
        )
            return;
        sequence++;
        dialog.close();
        restoreFocus();
    }
    function restoreFocus() {
        if (lastFocus?.isConnected) lastFocus.focus();
        else
            host
                .querySelector<HTMLButtonElement>(`[name="bind-${lastStepId}"]`)
                ?.focus();
    }
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        close();
    });
    async function open(stepId: string) {
        const procedure = options.procedure();
        if (!procedure) {
            options.onError(
                new Error(
                    "Save a procedure version before accepting a binding.",
                ),
            );
            return;
        }
        if (options.dirty()) {
            options.onError(
                new Error(
                    "Save or discard edits before accepting a binding. Unsaved edits will never be overwritten.",
                ),
            );
            return;
        }
        lastFocus =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
        const current = ++sequence;
        dialogDirty = false;
        lastStepId = stepId;
        const status = rbNode("p", "Loading real catalog suggestions…");
        status.setAttribute("role", "status");
        dialog.replaceChildren(
            rbNode("h2", `Bind step ${stepId}`),
            rbNode(
                "p",
                'Suggestions are not acceptance. Select an exact catalog target, or explicitly choose command/manual. No action is executed. Symbolic inputs use {"$input":"inputId"}; {"$literal":value} escapes a literal object. Strings remain literal and no templates are evaluated. Current catalog policy rejects secret input references and secret-input target schemas; keep those steps manual/unaccepted. Never store secret values.',
            ),
            status,
            rbButton("Close binding dialog", close),
        );
        dialog.showModal();
        try {
            const result = await invokeView("memoryHubSuggestBindings", {
                corpusId: procedure.corpusId,
                procedureId: procedure.procedureId,
                version: procedure.version,
                stepId,
            });
            if (disposed || current !== sequence || !dialog.open) return;
            status.textContent =
                result.warnings.join("\n") ||
                (result.suggestions.length
                    ? "Choose a real catalog suggestion explicitly."
                    : "No catalog suggestions returned. Explicit manual/command choices remain available.");
            render(procedure, stepId, result.suggestions, status);
        } catch (error) {
            if (disposed || current !== sequence) return;
            status.textContent = `Catalog suggestions unavailable: ${rbError(error)}. This is not an empty catalog success.`;
            options.onError(error);
            render(procedure, stepId, [], status);
        }
    }
    function render(
        procedure: ProcedureVersion,
        stepId: string,
        suggestions: RunbookBindingSuggestion[],
        status: HTMLElement,
    ) {
        let selected: RunbookBindingSuggestion | undefined;
        let mode: "catalog" | "command" | "manual" = "catalog";
        let command = "";
        let manualReason = "";
        const existingBinding = procedure.document.agentEdition?.steps.find(
            (step) => step.id === stepId,
        )?.binding;
        let argumentsText = JSON.stringify(
            existingBinding && "arguments" in existingBinding
                ? (existingBinding.arguments ?? {})
                : {},
            undefined,
            2,
        );
        let safety: "readOnly" | "changesData" | "unknown" = "unknown";
        let confirmed = false;
        const fields = rbNode("div");
        const choices = rbNode("div");
        for (const suggestion of suggestions) {
            const card = rbNode("article");
            const button = rbButton(`Select ${suggestion.name}`, () => {
                dialogDirty = true;
                selected = suggestion;
                safety = suggestion.safety;
                confirmed = false;
                renderFields();
            });
            card.append(
                rbNode(
                    "h3",
                    `${suggestion.name} · ${suggestion.kind} · score ${suggestion.score}`,
                ),
                rbNode("p", suggestion.description),
                rbNode("p", suggestion.reasons.join("\n")),
                rbNode(
                    "pre",
                    JSON.stringify(suggestion.inputSchema, undefined, 2),
                    "runbook-text",
                ),
                rbNode(
                    "p",
                    `Exact target ${suggestion.targetId} · version ${suggestion.version} · fingerprint ${suggestion.fingerprint}`,
                ),
                button,
            );
            choices.append(card);
        }
        const accept = rbButton(
            "Explicitly accept binding",
            () => {
                void submit();
            },
            "accept-binding",
        );
        function renderFields() {
            fields.replaceChildren();
            if (mode === "catalog")
                fields.append(
                    rbNode(
                        "p",
                        selected
                            ? `Selected exact target: ${selected.name} @ ${selected.version}`
                            : "No target selected. Nothing is accepted automatically.",
                    ),
                    rbField(
                        'Binding arguments JSON (symbolic {"$input":"inputId"}; strings are literal)',
                        argumentsText,
                        (value) => {
                            dialogDirty = true;
                            argumentsText = value;
                        },
                        { multiline: true, name: "binding-arguments" },
                    ),
                );
            if (mode === "command")
                fields.append(
                    rbField(
                        "Command text (not executed)",
                        command,
                        (value) => {
                            dialogDirty = true;
                            command = value;
                        },
                        { multiline: true, name: "binding-command" },
                    ),
                );
            if (mode === "manual")
                fields.append(
                    rbField(
                        "Manual step reason",
                        manualReason,
                        (value) => {
                            dialogDirty = true;
                            manualReason = value;
                        },
                        { multiline: true, name: "binding-manual-reason" },
                    ),
                );
            fields.append(
                rbSelect(
                    "Explicit safety choice",
                    safety,
                    ["readOnly", "changesData", "unknown"],
                    (value) => {
                        dialogDirty = true;
                        safety = value;
                        confirmed = false;
                        renderFields();
                    },
                    "binding-safety",
                ),
                rbCheck(
                    "I reviewed this exact binding and its safety; this grants no execution permission",
                    confirmed,
                    (value) => {
                        dialogDirty = true;
                        confirmed = value;
                    },
                    "binding-confirmed",
                ),
            );
        }
        const modeField = rbSelect(
            "Binding mode",
            mode,
            ["catalog", "command", "manual"],
            (value) => {
                dialogDirty = true;
                mode = value;
                confirmed = false;
                renderFields();
            },
            "binding-mode",
        );
        dialog.append(choices, modeField, fields, accept);
        renderFields();
        async function submit() {
            if (working) return;
            if (!confirmed) {
                status.textContent =
                    "Explicit safety confirmation is required.";
                return;
            }
            if (options.dirty()) {
                status.textContent =
                    "Unsaved edits must be saved or discarded first.";
                return;
            }
            const controls = [
                ...dialog.querySelectorAll<
                    | HTMLInputElement
                    | HTMLButtonElement
                    | HTMLSelectElement
                    | HTMLTextAreaElement
                >("input,button,select,textarea"),
            ].map((control) => ({ control, disabled: control.disabled }));
            try {
                if (mode === "catalog" && !selected)
                    throw new Error("Select an exact catalog target first.");
                if (mode === "command" && !command.trim())
                    throw new Error("Enter a command explicitly.");
                if (mode === "manual" && !manualReason.trim())
                    throw new Error("A manual reason is required.");
                const request = {
                    corpusId: procedure.corpusId,
                    procedureId: procedure.procedureId,
                    expectedVersion: procedure.version,
                    stepId,
                    safety,
                    safetyConfirmed: confirmed,
                };
                const argumentsValue =
                    mode === "catalog"
                        ? argumentsObject(argumentsText)
                        : undefined;
                if (argumentsValue)
                    validateRunbookBindingArguments(
                        argumentsValue,
                        procedure.document.agentEdition?.inputs,
                    );
                working = true;
                options.onPendingChanged(true);
                for (const { control } of controls) control.disabled = true;
                const saved = await invokeView("memoryHubAcceptBinding", {
                    ...request,
                    ...(mode === "catalog" && selected
                        ? {
                              targetId: selected.targetId,
                              fingerprint: selected.fingerprint,
                              targetVersion: selected.version,
                              arguments: argumentsValue,
                          }
                        : {}),
                    ...(mode === "command" ? { command } : {}),
                    ...(mode === "manual" ? { manualReason } : {}),
                });
                if (!disposed) {
                    sequence++;
                    dialog.close();
                    await options.onSaved(saved);
                    restoreFocus();
                }
            } catch (error) {
                if (!disposed) {
                    status.textContent = `Binding was not accepted: ${rbError(error)}. Draft and exact expected version are retained.`;
                    options.onError(error);
                }
            } finally {
                if (working) options.onPendingChanged(false);
                working = false;
                for (const { control, disabled } of controls)
                    if (control.isConnected) control.disabled = disabled;
            }
        }
    }
    return {
        open,
        dispose() {
            disposed = true;
            sequence++;
            dialog.remove();
        },
    };
}
