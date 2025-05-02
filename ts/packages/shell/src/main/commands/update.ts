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
    stop: (() => void) | undefined;
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

function isUpdaterEnabled(url?: string) {
    return app.isPackaged || updateConfigPath !== null || url !== undefined;
}

const minInterval = 60 * 60 * 1000; // 1 hour
export function startBackgroundUpdateCheck(
    interval: number,
    restart: boolean,
    initialInterval?: number,
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
    if (interval < 0) {
        return;
    }
    if (app.isPackaged && interval < minInterval) {
        debugBackgroundUpdateError(
            `Interval too small.  Minimum is ${minInterval}ms`,
        );
        interval = minInterval;
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
        debugBackgroundUpdate(`Scheduled: ${interval}s`);
        timer = setTimeout(f, interval * 1000);
    };

    const startInterval = initialInterval ?? interval;
    debugBackgroundUpdate(`Scheduled: ${startInterval}s`);
    timer = setTimeout(f, startInterval * 1000);

    state.stop = () => {
        controller.abort();
        if (timer) {
            clearTimeout(timer);
            debugBackgroundUpdate("Cancelled");
        } else {
            debugBackgroundUpdate("Stopping");
        }
    };
}

function stopBackgroundUpdateCheck() {
    state.stop?.();
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

async function checkUpdate(
    install: boolean,
    download: boolean = false,
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
        autoUpdater.channel = channel;
    } else {
        // https://github.com/electron-userland/electron-builder/issues/9078
        (autoUpdater as any)._channel = null;
        autoUpdater.allowDowngrade = false;
    }
    if (download || install) {
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = install;
    } else {
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = false;
    }
    autoUpdater.disableWebInstaller = true;
    autoUpdater.requestHeaders = {
        Authorization: `Bearer ${token.token}`,
        "x-ms-version": "2020-04-08",
    };

    const result = await autoUpdater.checkForUpdates();

    if (result !== null && result.isUpdateAvailable && install) {
        state.lastChecked = new Date();
        state.updateInfo = result.updateInfo;
        if (url !== undefined || channel !== undefined) {
            stopBackgroundUpdateCheck();
            // If we have a custom update queued, don't check again.
            state.custom = true;
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
            download: {
                description: "Download the update",
                default: false,
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
                params.flags.download,
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

            if (!params.flags.install) {
                displaySuccess(
                    `Download successful. Please install manually. Files:\n- ${downloadResult.join("\n= ")}`,
                    context,
                );
                return;
            }
            if (!params.flags.restart) {
                displaySuccess(
                    [
                        "Download successful.  Update pending.",
                        "Restart the app, or specify --restart to auto install and restart.",
                    ],
                    context,
                );
                return;
            }
            displaySuccess(
                "Download successful. Installing and restarting app...",
                context,
            );
            autoUpdater.quitAndInstall(false, true);
        });
    }
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

        const settings =
            context.sessionContext.agentContext.shellWindow.getUserSettings();
        displayResult(
            [
                "",
                "Settings:",
                `  Interval: ${settings.autoUpdate}`,
                `  Restart: ${settings.autoRestart}`,
                "",
                `Background update ${state.currentCheck ? "checking" : state.stop ? "scheduled" : "not running"}`,
            ],
            context,
        );
    }
}

class ShellUpdateAutoCommand implements CommandHandler {
    public readonly description = "Enable/disable background update check";
    public readonly parameters = {
        flags: {
            interval: {
                description: "Interval in milliseconds.  -1 to disable.",
                default: 24 * 60 * 60, // 24 hours
            },
            restart: {
                description: "Restart the app after downloading the update",
                default: false,
            },
        },
    } as const;
    public async run(
        context: ActionContext<ShellContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<void> {
        const shellWindow = context.sessionContext.agentContext.shellWindow;
        shellWindow.setUserSettingValue("autoUpdate", params.flags.interval);
        shellWindow.setUserSettingValue("autoRestart", params.flags.restart);
        if (params.flags.interval === -1) {
            stopBackgroundUpdateCheck();
            displayResult("Background update check disabled", context);
            return;
        }
        startBackgroundUpdateCheck(params.flags.interval, params.flags.restart);
        displayResult(
            [
                "Background update check enabled.",
                `Interval: ${params.flags.interval}s`,
                `Restart: ${params.flags.restart}`,
            ],
            context,
        );
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
