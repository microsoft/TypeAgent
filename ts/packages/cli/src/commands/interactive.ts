// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { createDispatcher, Dispatcher } from "agent-dispatcher";
import {
    getCacheFactory,
    getAllActionConfigProvider,
} from "agent-dispatcher/internal";
import { getClientId, getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
    getDefaultAppAgentInstaller,
    getIndexingServiceRegistry,
} from "default-agent-provider";
import inspector from "node:inspector";
import { getChatModelNames } from "aiclient";
import {
    getConsolePrompt,
    processCommands,
    withConsoleClientIO,
} from "agent-dispatcher/helpers/console";
import { getStatusSummary } from "agent-dispatcher/helpers/status";
import {
    ChatRpcServer,
    CliHostAdapter,
    ProtocolRequestManager,
    createProtocolClientIOWrapper,
} from "chat-rpc-server";
import registerDebug from "debug";
import { getFsStorageProvider } from "dispatcher-node-providers";

const debugInteractive = registerDebug("typeagent:cli:interactive");

const modelNames = await getChatModelNames();
const instanceDir = getInstanceDir();
const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
const { schemaNames } = await getAllActionConfigProvider(
    defaultAppAgentProviders,
);
export default class Interactive extends Command {
    static description = "Interactive mode";
    static flags = {
        agent: Flags.string({
            description: "Schema names",
            options: schemaNames,
            multiple: true,
        }),
        explainer: Flags.string({
            description:
                "Explainer name (defaults to the explainer associated with the translator)",
            options: getCacheFactory().getExplainerNames(),
        }),
        model: Flags.string({
            description: "Translation model to use",
            options: modelNames,
        }),
        debug: Flags.boolean({
            description: "Enable debug mode",
            default: false,
        }),
        memory: Flags.boolean({
            description: "In memory session",
            default: false,
        }),
        exit: Flags.boolean({
            description: "Exit after processing input file",
            default: true,
            allowNo: true,
        }),
        port: Flags.integer({
            description: "Port for protocol server for external clients",
            default: 3100,
            char: "p",
        }),
    };
    static args = {
        input: Args.file({
            description:
                "A text input file containing one interactive command per line",
            exists: true,
        }),
    };
    async run(): Promise<void> {
        const { args, flags } = await this.parse(Interactive);

        if (flags.debug) {
            inspector.open(undefined, undefined, true);
        }

        // Create protocol request manager if port is specified
        const requestManager = flags.port
            ? new ProtocolRequestManager()
            : undefined;
        let protocolServer: ChatRpcServer | undefined;

        await withConsoleClientIO(async (consoleClientIO) => {
            // Wrap ClientIO to route protocol requests to WebSocket if port specified
            const clientIO = requestManager
                ? createProtocolClientIOWrapper(consoleClientIO, requestManager)
                : consoleClientIO;

            const persistDir = !flags.memory ? instanceDir : undefined;
            const dispatcher = await createDispatcher("cli interactive", {
                appAgentProviders: defaultAppAgentProviders,
                agentInstaller: getDefaultAppAgentInstaller(instanceDir),
                agents: flags.agent,
                translation: { model: flags.model },
                explainer: { name: flags.explainer },
                persistSession: !flags.memory,
                persistDir,
                storageProvider:
                    persistDir !== undefined
                        ? getFsStorageProvider()
                        : undefined,
                clientIO,
                dblogging: true,
                indexingServiceRegistry:
                    await getIndexingServiceRegistry(persistDir),
                clientId: getClientId(),
                constructionProvider: getDefaultConstructionProvider(),
            });

            // Start protocol server if port specified
            if (flags.port && requestManager) {
                debugInteractive(
                    `Starting protocol server on port ${flags.port}`,
                );
                protocolServer = new ChatRpcServer({ port: flags.port });
                const adapter = new CliHostAdapter(dispatcher, requestManager);
                protocolServer.attachHost(adapter);
                await protocolServer.start();
                console.log(
                    `Chat RPC server started on port ${flags.port} for external clients`,
                );
            }

            try {
                if (args.input) {
                    await dispatcher.processCommand(`@run ${args.input}`);
                    if (flags.exit) {
                        return;
                    }
                }

                await processCommands(
                    async (dispatcher: Dispatcher) =>
                        getConsolePrompt(
                            getStatusSummary(await dispatcher.getStatus(), {
                                showPrimaryName: false,
                            }),
                        ),
                    (command: string, dispatcher: Dispatcher) =>
                        dispatcher.processCommand(command),
                    dispatcher,
                );
            } finally {
                if (protocolServer) {
                    debugInteractive("Stopping protocol server");
                    await protocolServer.stop();
                }
                if (requestManager) {
                    requestManager.clear();
                }
                if (dispatcher) {
                    await dispatcher.close();
                }
            }
        });

        // Some background network (like mongo) might keep the process live, exit explicitly.
        process.exit(0);
    }
}
