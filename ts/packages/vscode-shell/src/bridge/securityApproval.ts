// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import type * as vscode from "vscode";
import type { SecurityApprovalRequest } from "@typeagent/agent-sdk";

type ApprovalApi = Pick<
    typeof vscode,
    "workspace" | "window" | "Uri" | "ViewColumn"
>;
type ApprovalChoice = vscode.QuickPickItem & { index: number };

export async function showSecurityApproval(
    api: ApprovalApi,
    { message, choices, defaultId }: SecurityApprovalRequest,
): Promise<number> {
    if (
        !Number.isInteger(defaultId) ||
        defaultId < 0 ||
        defaultId >= choices.length
    ) {
        throw new Error(
            "Security approval requires a valid cancellation default.",
        );
    }

    // Content-provider documents are read-only. Keep the entire snapshot out
    // of Quick Pick's single-line placeholder and out of temporary disk files.
    const scheme = `typeagent-security-review-${randomUUID()}`;
    const uri = api.Uri.parse(`${scheme}:/PowerShell-approval.txt`);
    const provider = api.workspace.registerTextDocumentContentProvider(scheme, {
        provideTextDocumentContent: () => message,
    });
    let picker: vscode.QuickPick<ApprovalChoice> | undefined;
    const subscriptions: vscode.Disposable[] = [];
    try {
        const document = await api.workspace.openTextDocument(uri);
        await api.window.showTextDocument(document, {
            preview: true,
            viewColumn: api.ViewColumn.Active,
        });
        const input = api.window.createQuickPick<ApprovalChoice>();
        picker = input;
        const items = choices.map((label, index) => ({ label, index }));
        input.title = "Authorize local PowerShell (not sandboxed)";
        input.placeholder =
            "Review the read-only document before approving. Cancel is selected.";
        input.ignoreFocusOut = true;
        input.canSelectMany = false;
        input.items = items;
        input.activeItems = [items[defaultId]];

        return await new Promise<number>((resolve) => {
            subscriptions.push(
                input.onDidAccept(() => {
                    const selected =
                        input.selectedItems[0] ?? input.activeItems[0];
                    resolve(
                        selected && items.includes(selected)
                            ? selected.index
                            : defaultId,
                    );
                }),
                input.onDidHide(() => resolve(defaultId)),
            );
            input.show();
        });
    } finally {
        for (const subscription of subscriptions) subscription.dispose();
        picker?.dispose();
        provider.dispose();
    }
}
