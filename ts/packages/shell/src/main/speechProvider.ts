// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { dialog } from "electron";
import type { ActionContext } from "@typeagent/agent-sdk";
import type { CommandHandlerTable } from "@typeagent/agent-sdk/helpers/command";
import {
    displayStatus,
    displaySuccess,
} from "@typeagent/agent-sdk/helpers/display";
import type { ShellContext } from "./agent.js";
import { getShellWindow } from "./instance.js";
import {
    closeLocalWhisper,
    ensureLocalWhisper,
} from "./localWhisperCommandHandler.js";
import { localAsrHost } from "./localAsrHost.js";
import type { SpeechProvider } from "../preload/localAsrTypes.js";

let switching = false;

export function getSpeechProvider(): SpeechProvider {
    const provider =
        getShellWindow()?.getUserSettings().speechProvider ?? "azure";
    if (
        provider !== "azure" &&
        provider !== "whisper" &&
        provider !== "nemotron"
    ) {
        throw new Error(
            `Invalid speech provider '${provider}'. Use @shell speechProvider azure, whisper, or nemotron.`,
        );
    }
    return provider;
}

export async function selectSpeechProvider(
    context: ActionContext<ShellContext>,
    provider: SpeechProvider,
) {
    if (switching)
        throw new Error("A speech provider change is already in progress.");
    if (localAsrHost.isRecording())
        throw new Error(
            "Stop the active recording before switching speech providers.",
        );
    const shellWindow = context.sessionContext.agentContext.shellWindow;
    switching = true;
    try {
        if (provider === "nemotron") {
            if (process.platform !== "win32" || process.arch !== "x64") {
                throw new Error(
                    "The Nemotron prototype currently supports Windows x64 only. Azure and Whisper are unchanged.",
                );
            }
            const dialogClosed = new AbortController();
            let finished = false;
            let canceled = false;
            let cancelFailure: Error | undefined;
            const cancelDialog = dialog
                .showMessageBox({
                    type: "info",
                    title: "Preparing local speech",
                    message: "Preparing Nemotron speech recognition",
                    detail: "Missing model files will be downloaded and cached on this device. Progress appears in chat. Cancel to keep the current speech provider.",
                    buttons: ["Cancel"],
                    signal: dialogClosed.signal,
                })
                .then(async () => {
                    if (!finished) {
                        canceled = true;
                        try {
                            await localAsrHost.cancelSetup();
                        } catch (error) {
                            cancelFailure =
                                error instanceof Error
                                    ? error
                                    : new Error(String(error));
                        }
                    }
                });
            try {
                let lastProgress = "";
                await localAsrHost.prepare(true, (message, percent) => {
                    const text =
                        percent === undefined
                            ? message
                            : `${message} ${Math.floor(percent)}%`;
                    if (text !== lastProgress) {
                        displayStatus(text, context);
                        lastProgress = text;
                    }
                });
            } finally {
                finished = true;
                dialogClosed.abort();
                await cancelDialog;
            }
            if (cancelFailure) throw cancelFailure;
            if (canceled)
                throw new Error(
                    "Nemotron setup canceled; the previous speech provider is unchanged.",
                );
        } else if (provider === "whisper") {
            displayStatus("Starting local Whisper...", context);
            await ensureLocalWhisper();
        }
        shellWindow.setUserSettingValue("speechProvider", provider);
        shellWindow.chatView.webContents.send("speech-provider-changed");
        if (provider !== "whisper") closeLocalWhisper();
        if (provider !== "nemotron") await localAsrHost.dispose();
        displaySuccess(`Speech provider: ${provider}.`, context);
    } finally {
        switching = false;
    }
}

export function getSpeechProviderCommandHandlers(): CommandHandlerTable {
    const select = (provider: SpeechProvider) => ({
        description: `Use ${provider} speech recognition`,
        run: (context: ActionContext<ShellContext>) =>
            selectSpeechProvider(context, provider),
    });
    return {
        description:
            "Select the speech provider (downloads Nemotron on first use)",
        commands: {
            azure: select("azure"),
            whisper: select("whisper"),
            nemotron: select("nemotron"),
        },
    };
}
