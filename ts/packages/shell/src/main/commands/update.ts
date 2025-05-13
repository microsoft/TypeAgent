// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { ShellContext } from "../agent.js";
import { app } from "electron";
import { DefaultAzureCredential } from "@azure/identity";

import electronUpdater from "electron-updater";
import {
    displayResult,
    displayStatus,
    displaySuccess,
} from "@typeagent/agent-sdk/helpers/display";
import registerDebug from "debug";
import { getElapsedString } from "common-utils";
import { isProd } from "../index.js";

const { autoUpdater } = electronUpdater;

const debugShellUpdate = registerDebug("typeagent:shell:update");

autoUpdater.logger = {
    info: debugShellUpdate,
    warn: debugShellUpdate,
    error: debugShellUpdate,
    debug: debugShellUpdate,
};

type UpdateState = {
    id: number;
    currentCheck: Promise<void> | undefined;
    lastChecked: Date | undefined;
    updateInfo: electronUpdater.UpdateInfo | undefined;
    custom: boolean;
    stop: (() => boolean) | undefined;
};

const state: UpdateState = {
    id: 0,
    currentCheck: undefined,
    lastChecked: undefined,
    updateInfo: undefined,
    custom: false,
    stop: undefined,
};

let updateConfigPath: string | null = null;
export function setUpdateConfigPath(configPath: string) {
    updateConfigPath = configPath;
}

export function hasPendingUpdate() {
    return state.updateInfo !== undefined;
}

export function installAndRestart() {
    if (state.updateInfo) {
        autoUpdater.quitAndInstall(false, true);
    } else {
        app.relaunch();
        app.exit(0);
    }
}

let pendingUpdateCallback:
    | ((version: electronUpdater.UpdateInfo, background: boolean) => void)
    | undefined;
export function setPendingUpdateCallback(
    fn: (version: electronUpdater.UpdateInfo, background: boolean) => void,
) {
    pendingUpdateCallback = fn;
}

function isUpdaterEnabled(url?: string) {
    return app.isPackaged || updateConfigPath !== null || url !== undefined;
}

const minIntervalMs = 60 * 60 * 1000; // 1 hour
export function startBackgroundUpdateCheck(
    intervalMs: number,
    restart: boolean,
    initialIntervalMs: number,
) {
    const id = ++state.id;
    const debugBackgroundUpdate = registerDebug(
        `typeagent:shell:update:bg:${id}`,
    );
    const debugBackgroundUpdateError = registerDebug(
        `typeagent:shell:update:bg:${id}:error`,
    );
    if (!isUpdaterEnabled()) {
        debugBackgroundUpdateError(
            "Update check is only available in packaged builds, or with '--update' config path flag",
        );
        return;
    }
    if (state.custom) {
        debugBackgroundUpdateError(
            "Pending manual update with custom URL or channel already in progress.",
        );
        return;
    }
    stopBackgroundUpdateCheck();
    if (intervalMs < 0) {
        return;
    }

    debugBackgroundUpdate(`Starting`);
    let timer: NodeJS.Timeout | undefined;
    const controller = new AbortController();
    const f = async () => {
        timer = undefined;
        if (state.currentCheck) {
            debugBackgroundUpdate("Waiting for foreground update check.");
            await state.currentCheck;
        }
        if (controller.signal.aborted) {
            debugBackgroundUpdate("Stopped");
            return;
        }
        if (state.custom) {
            // Shouldn't be here. We should have been aborted.
            debugBackgroundUpdateError(
                "Custom update URL or channel specified, stop checking in the background",
            );
            debugBackgroundUpdate("Stopped");
            return;
        }
        await checkUpdateLock(async () => {
            debugBackgroundUpdate("Checking");
            try {
                const result = await checkUpdate(true);
                if (result?.isUpdateAvailable) {
                    debugBackgroundUpdate(
                        `Downloading: ${result.updateInfo.version}`,
                    );
                    await result.downloadPromise;
                    if (restart) {
                        debugBackgroundUpdate(
                            "Completed. Installing and restart.",
                        );
                        autoUpdater.quitAndInstall(false, true);
                        return;
                    }

                    debugBackgroundUpdate("Completed. Pending restart.");
                } else {
                    debugBackgroundUpdate("Completed. No updates found.");
                }
            } catch (e) {
                debugBackgroundUpdateError(
                    "Error checking for updates in background",
                    e,
                );
            }
        });

        if (controller.signal.aborted) {
            debugBackgroundUpdate("Stopped");
            return;
        }
        schedule(intervalMs);
    };

    const schedule = (intervalMs: number, initial: boolean = false) => {
        if (isProd && !initial && intervalMs < minIntervalMs) {
            // Guard against too small intervals unless we are in dev build.
            debugBackgroundUpdateError(
                `Interval too small.  Minimum is ${getElapsedString(minIntervalMs)}`,
            );
            intervalMs = minIntervalMs;
        }
        debugBackgroundUpdate(`Scheduled: ${getElapsedString(intervalMs)}`);
        timer = setTimeout(f, intervalMs);
    };
    schedule(initialIntervalMs, true);

    state.stop = () => {
        state.stop = undefined;
        controller.abort();
        if (timer) {
            clearTimeout(timer);
            debugBackgroundUpdate("Cancelled");
            return false;
        }
        debugBackgroundUpdate("Stopping");
        return true;
    };
}

function stopBackgroundUpdateCheck() {
    return state.stop?.();
}

async function getAzureBlobStorageToken() {
    try {
        const credential = new DefaultAzureCredential();
        const token = await credential.getToken("https://storage.azure.com");
        return token;
    } catch (error: any) {
        throw new Error(`Unable to get Azure Storage token.\n${error.message}`);
    }
}

// Always true.  Use autoDownload to control download.
autoUpdater.autoInstallOnAppQuit = true;

async function checkUpdate(
    install: boolean,
    background: boolean = true,
    url?: string,
    channel?: string,
) {
    const token = await getAzureBlobStorageToken();

    autoUpdater.forceDevUpdateConfig =
        !app.isPackaged && (updateConfigPath !== null || url !== undefined);

    if (url !== undefined) {
        autoUpdater.setFeedURL(url);
    } else {
        autoUpdater.updateConfigPath = updateConfigPath;
    }

    if (channel !== undefined) {
        autoUpdater.channel = `${channel}-${process.arch}`;
    } else {
        // https://github.com/electron-userland/electron-builder/issues/9078
        (autoUpdater as any)._channel = null;
        autoUpdater.allowDowngrade = false;
    }

    autoUpdater.autoDownload = install;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.requestHeaders = {
        Authorization: `Bearer ${token.token}`,
        "x-ms-version": "2020-04-08",
    };

    const result = await autoUpdater.checkForUpdates();

    if (install) {
        state.lastChecked = new Date();
        if (result !== null && result.isUpdateAvailable) {
            state.updateInfo = result.updateInfo;
            pendingUpdateCallback?.(result.updateInfo, background);
            if (url !== undefined || channel !== undefined) {
                stopBackgroundUpdateCheck();
                // If we have a custom update queued, don't check again.
                state.custom = true;
            }
        }
    }
    return result;
}

async function checkUpdateLock(fn: () => Promise<void>) {
    if (state.currentCheck) {
        throw new Error("Update check already in progress.");
    }
    const p = Promise.withResolvers<void>();
    state.currentCheck = p.promise;
    try {
        await fn();
    } finally {
        state.currentCheck = undefined;
        p.resolve();
    }
}

export class ShellUpdateCheckCommand implements CommandHandler {
    public readonly description = "Check for updates to the shell";
    public readonly parameters = {
        flags: {
            url: {
                description: "URL to check for updates",
                optional: true,
            },
            channel: {
                description: "The update channel to use",
                optional: true,
            },
            install: {
                description: "Install the update",
                default: false,
            },
            restart: {
                description: "Restart the app after downloading the update",
                default: false,
            },
            verbose: {
                description: "Enable verbose logging",
                default: false,
            },
        },
    } as const;
    public async run(
        context: ActionContext<ShellContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<void> {
        if (!isUpdaterEnabled(params.flags.url)) {
            throw new Error(
                "Shell update is only available in packaged builds, or --url is specified, or command line --update config path",
            );
        }

        if (state.currentCheck) {
            displayStatus("Waiting for background update check...", context);
            await state.currentCheck;
        }

        await checkUpdateLock(async () => {
            displayStatus("Checking for update", context);
            const result = await checkUpdate(
                params.flags.install,
                false,
                params.flags.url,
                params.flags.channel,
            );

            if (result === null || result.isUpdateAvailable !== true) {
                displayResult("No updates found.", context);
                return;
            }

            if (params.flags.verbose) {
                context.actionIO.appendDisplay({
                    type: "markdown",
                    content: `\`\`\`\n${JSON.stringify(result.updateInfo, undefined, 2)}\n\`\`\``,
                });
            }

            displayResult(
                [
                    `Current version: ${app.getVersion()}`,
                    `New version: ${result.updateInfo.version}`,
                ],
                context,
            );

            if (!result.downloadPromise) {
                displaySuccess(
                    "Update available.  Specify --install to install the update.",
                    context,
                );
                return;
            }
            displayStatus("Downloading update...", context);
            const downloadResult = await result.downloadPromise;

            displayResult(
                ["Download successful", ...downloadResult.map((f) => `  ${f}`)],
                context,
            );

            if (!params.flags.restart) {
                displaySuccess(
                    [
                        "Close the app, or restart the app with `@shell restart` to update.",
                    ],
                    context,
                );
                return;
            }
            displaySuccess("Installing and restarting app...", context);
            autoUpdater.quitAndInstall(false, true);
        });
    }
}

function displayUpdateState(context: ActionContext<ShellContext>) {
    const settings =
        context.sessionContext.agentContext.shellWindow.getUserSettings();
    displayResult(
        [
            `Background update is ${state.currentCheck ? "checking" : state.stop ? "scheduled" : "not running"}`,
            "Settings:",
            `  Interval: ${getElapsedString(settings.autoUpdate.intervalMs)}`,
            `  Initial: ${getElapsedString(settings.autoUpdate.initialIntervalMs)}`,
            `  Restart: ${settings.autoUpdate.restart}`,
        ],
        context,
    );
}
class ShellUpdateStatusCommand implements CommandHandlerNoParams {
    public readonly description = "Show update status";
    public async run(context: ActionContext<ShellContext>): Promise<void> {
        if (state.lastChecked) {
            displayResult(
                `Last checked: ${state.lastChecked.toLocaleString()}`,
                context,
            );
            if (state.updateInfo) {
                displayResult(
                    `Update pending: ${state.updateInfo.version}${state.custom ? " (custom)" : ""}`,
                    context,
                );
            } else {
                displayResult("No updates available", context);
            }
        } else {
            displayResult("No updates checked", context);
        }

        displayUpdateState(context);
    }
}

class ShellUpdateAutoCommand implements CommandHandler {
    public readonly description = "Enable/disable background update check";
    public readonly parameters = {
        flags: {
            interval: {
                description: "Interval in seconds.  -1 to disable.",
                default: 24 * 60 * 60, // 24 hours
            },
            restart: {
                description: "Restart the app after downloading the update",
                default: false,
            },
            initial: {
                description: "Initial interval in seconds",
                default: 60, // 1 minute
            },
        },
    } as const;
    public async run(
        context: ActionContext<ShellContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<void> {
        if (params.flags.initial < 0) {
            throw new Error("Initial interval must be >= 0");
        }
        const shellWindow = context.sessionContext.agentContext.shellWindow;

        const intervalMs =
            params.flags.interval < 0 ? -1 : params.flags.interval * 1000;

        const initialIntervalMs = params.flags.initial * 1000;
        shellWindow.setUserSettingValue("autoUpdate", {
            intervalMs,
            initialIntervalMs,
            restart: params.flags.restart,
        });
        if (intervalMs < 0) {
            if (stopBackgroundUpdateCheck() !== undefined) {
                displayResult("Background update check disabled", context);
            }
        } else {
            startBackgroundUpdateCheck(
                intervalMs,
                params.flags.restart,
                initialIntervalMs,
            );
        }
        displayUpdateState(context);
    }
}

export const updateHandlerTable: CommandHandlerTable = {
    description: "Shell update commands",
    defaultSubCommand: "check",
    commands: {
        check: new ShellUpdateCheckCommand(),
        status: new ShellUpdateStatusCommand(),
        auto: new ShellUpdateAutoCommand(),
    },
};
