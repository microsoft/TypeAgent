// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    canonicalPowerShellJson,
    powerShellFingerprint,
    PowerShellIntegrityError,
} from "@typeagent/agent-flows/powershell/integrity";
import type {
    ScriptExecutionRequest,
    ScriptExecutionResult,
} from "./powershellRunner.mjs";

function invocationContent(request: ScriptExecutionRequest) {
    return {
        script: request.script,
        parameters: request.parameters,
        sandbox: request.sandbox,
        parameterRoles: request.parameterRoles ?? {},
        provenance: request.provenance,
        revisionHash: request.revisionHash ?? null,
        policyVersion: "appcontainer-v1",
        languageMode: "ConstrainedLanguage",
        workingDirectory:
            "Private sandbox scratch directory (created at launch)",
        activeProcessLimit: 1,
        maximumOutputBytes: 1024 * 1024,
    };
}

function invocationFailure(
    code: string,
    message: string,
): { failure: ScriptExecutionResult } {
    return {
        failure: {
            success: false,
            stdout: "",
            stderr: message,
            exitCode: -1,
            duration: 0,
            truncated: false,
            errorCode: `powershell.${code}`,
            cancelled: code === "cancelled",
        },
    };
}

function describeInvocation(
    snapshot: ReturnType<typeof invocationContent>,
    invocationHash: string,
): string {
    return [
        "Approve this PowerShell invocation only? Cancel is the default.",
        `Invocation SHA-256: ${invocationHash}`,
        `Revision SHA-256: ${snapshot.revisionHash ?? "unsaved candidate"}`,
        `Working directory: ${snapshot.workingDirectory}`,
        `Timeout: ${snapshot.sandbox.maxExecutionTime} seconds`,
        "Network: denied. External directories: none. External modules: none.",
        "Child processes: denied (one-process job). Language: ConstrainedLanguage.",
        "Windows AppContainer runtime/baseline access remains; this is not a directory-only allowlist.",
        `Allowed commands: ${JSON.stringify(snapshot.sandbox.allowedCmdlets)}`,
        `Resolved arguments (literal JSON; no parent environment expansion): ${canonicalPowerShellJson(snapshot.parameters)}`,
        "Exact script begins below:",
        snapshot.script,
        "End of script. Approval does not authorize a retry, repair, or future invocation.",
    ].join("\n");
}

export async function approveInvocation(
    request: ScriptExecutionRequest,
): Promise<
    | { failure: ScriptExecutionResult }
    | {
          snapshot: ReturnType<typeof invocationContent>;
          invocationHash: string;
      }
> {
    if (!request.requestApproval) {
        return invocationFailure(
            "approvalRequired",
            "Dynamic PowerShell requires interactive approval for this invocation. Headless execution is not approved.",
        );
    }
    let serialized: string;
    try {
        serialized = canonicalPowerShellJson(invocationContent(request));
    } catch (error) {
        if (!(error instanceof PowerShellIntegrityError)) throw error;
        return invocationFailure("integrityFailure", error.message);
    }
    // This private JSON snapshot is never exposed as mutable approval state.
    const snapshot: ReturnType<typeof invocationContent> =
        JSON.parse(serialized);
    const invocationHash = powerShellFingerprint(serialized);
    let answer: number;
    try {
        answer = await request.requestApproval(
            describeInvocation(snapshot, invocationHash),
        );
    } catch (error) {
        return invocationFailure(
            "approvalRequired",
            `PowerShell approval interaction failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (request.abortSignal?.aborted) {
        return invocationFailure(
            "cancelled",
            "PowerShell invocation was cancelled before launch.",
        );
    }
    if (answer !== 1) {
        return invocationFailure(
            "approvalDenied",
            "PowerShell invocation was not approved. No code was executed.",
        );
    }
    try {
        await request.assertCurrent?.();
        if (request.abortSignal?.aborted) {
            return invocationFailure(
                "cancelled",
                "PowerShell invocation was cancelled before launch.",
            );
        }
        if (
            canonicalPowerShellJson(invocationContent(request)) !== serialized
        ) {
            return invocationFailure(
                "stalePlan",
                "PowerShell invocation changed while approval was pending. Review a new invocation.",
            );
        }
    } catch (error) {
        if (!(error instanceof PowerShellIntegrityError)) throw error;
        return invocationFailure("stalePlan", error.message);
    }
    return { snapshot, invocationHash };
}
