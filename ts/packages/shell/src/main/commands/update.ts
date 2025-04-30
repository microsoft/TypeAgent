// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
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

async function getAzureBlobStorageToken() {
    try {
        const credential = new DefaultAzureCredential();
        const token = await credential.getToken("https://storage.azure.com");
        return token;
    } catch (error: any) {
        throw new Error(`Unable to get Azure Storage token.\n${error.message}`);
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
        if (!app.isPackaged) {
            throw new Error(
                "Shell update is only available in packaged builds, unless update URL is specified.",
            );
        }

        const token = await getAzureBlobStorageToken();

        if (params.flags.url !== undefined) {
            autoUpdater.setFeedURL(params.flags.url);
        } else {
            autoUpdater.updateConfigPath = null;
        }
        if (params.flags.channel !== undefined) {
            autoUpdater.channel = params.flags.channel;
        } else {
            autoUpdater.channel = null;
            autoUpdater.allowDowngrade = false;
        }
        if (params.flags.download || params.flags.install) {
            autoUpdater.autoDownload = true;
            autoUpdater.autoInstallOnAppQuit = params.flags.install;
        } else {
            autoUpdater.autoDownload = false;
            autoUpdater.autoInstallOnAppQuit = false;
        }
        autoUpdater.disableWebInstaller = true;
        autoUpdater.forceDevUpdateConfig = false;
        autoUpdater.requestHeaders = {
            Authorization: `Bearer ${token.token}`,
            "x-ms-version": "2020-04-08",
        };
        const result = await autoUpdater.checkForUpdates();

        if (result === null || result.isUpdateAvailable !== true) {
            context.actionIO.appendDisplay("No updates found.");
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
                "Download successful.  Restart the app to update or specify --restart to auto install and restart.",
                context,
            );
            return;
        }
        displaySuccess(
            "Download successful. Installing and restarting app...",
            context,
        );
        autoUpdater.quitAndInstall(false, true);
    }
}

export const updateHandlerTable: CommandHandlerTable = {
    description: "Shell update commands",
    defaultSubCommand: "check",
    commands: {
        check: new ShellUpdateCheckCommand(),
    },
};
