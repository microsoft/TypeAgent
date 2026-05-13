/**
 * Copilot CLI hook input/output types.
 */

export interface HookInput {
    sessionId: string;
    timestamp: number;
    cwd: string;
    prompt: string;
}

export interface HookOutput {
    modifiedPrompt?: string;
    additionalContext?: string;
    suppressOutput?: boolean;
    handled?: boolean;
    responseContent?: string;
    handledBy?: string;
}
