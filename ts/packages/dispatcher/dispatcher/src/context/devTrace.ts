// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import registerDebug from "debug";

const debugDevTrace = registerDebug("typeagent:devTrace");

export interface DevTraceState {
    // True when developer mode is on; when false, capture is a no-op.
    enabled: boolean;
    // Session directory to write captures under; undefined for ephemeral sessions.
    sessionDirPath: string | undefined;
    // Stringified request id used to name capture files.
    requestId: string | undefined;
}

/**
 * Records developer-mode debugging captures for translation requests.
 *
 * When developer mode is on, each translation writes a self-contained JSON
 * file under `<sessionDir>/dev-captures/` containing the request, the history
 * context, the resolved actions and the complete translation prompt(s) sent to
 * the model — enough to inspect (and later reconstruct) why a request
 * translated the way it did. A no-op when developer mode is off or the session
 * is ephemeral (no session directory).
 */
export class DevTrace {
    // Complete prompt(s) sent to the model during the current translation.
    // Multiple entries accumulate across the initial translation, schema switch
    // and selected-action passes for a single request.
    private prompts: unknown[] = [];

    constructor(private readonly getState: () => DevTraceState) {}

    public get enabled(): boolean {
        return this.getState().enabled;
    }

    /**
     * Start capturing prompts for a new translation request. Clears any prompts
     * left over from a previous request.
     */
    public beginTranslation(): void {
        this.prompts = [];
    }

    /**
     * Record a complete model request (the fully expanded translation prompt).
     * Called for every model completion during a translation. A no-op when
     * developer mode is off.
     */
    public recordPrompt(content: unknown): void {
        if (!this.getState().enabled) {
            return;
        }
        this.prompts.push(content);
    }

    /**
     * Persist a translation capture to `<sessionDir>/dev-captures/`. The prompts
     * recorded since `beginTranslation` are attached under the `prompts` key. A
     * no-op when developer mode is off or there is no session directory.
     */
    public async writeTranslationCapture(
        record: Record<string, unknown>,
    ): Promise<void> {
        const { enabled, sessionDirPath, requestId } = this.getState();
        const prompts = this.prompts;
        this.prompts = [];
        if (!enabled || sessionDirPath === undefined) {
            return;
        }
        try {
            const dir = path.join(sessionDirPath, "dev-captures");
            await fs.promises.mkdir(dir, { recursive: true });
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const safeRequestId = (requestId ?? "unknown").replace(
                /[^a-zA-Z0-9._-]/g,
                "_",
            );
            const file = path.join(
                dir,
                `translate-${timestamp}-${safeRequestId}.json`,
            );
            const data = {
                timestamp: new Date().toISOString(),
                requestId,
                ...record,
                prompts,
            };
            await fs.promises.writeFile(
                file,
                JSON.stringify(data, null, 2),
                "utf8",
            );
            debugDevTrace(`Wrote translation capture: ${file}`);
        } catch (e) {
            debugDevTrace(`Failed to write translation capture: ${e}`);
        }
    }
}
