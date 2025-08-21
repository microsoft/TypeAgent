// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandler, CommandHandlerNoParams, CommandHandlerTable } from "@typeagent/agent-sdk/helpers/command";
import { BrowserActionContext, saveSettings } from "../browserActions.mjs";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { displayError, displayResult } from "@typeagent/agent-sdk/helpers/display";
import { SearchProvider } from "../../common/browserControl.mjs";

export class SearchProviderCommandHandlerTable implements CommandHandlerTable {
    public readonly description = "List search providers";
    public readonly defaultSubCommand = "list";
    public readonly commands = {
        list: new ListCommandHandler(),
        set: new SetCommandHandler(),
        show: new ShowCommandHandler(),
        add: new AddCommandHandler(),
        remove: new RemoveCommandHandler(),
        import: new ImportCommandHandler(),
    }
}

export class ListCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Lists browser agent search providers";
    public async run(context: ActionContext<BrowserActionContext>): Promise<void> {
        const searchProviders: SearchProvider[] = context.sessionContext.agentContext.searchProviders;
        const activeSearchProvider: SearchProvider = context.sessionContext.agentContext.activeSearchProvider;

        searchProviders.forEach(provider => {
            if (provider.name.toLowerCase() === activeSearchProvider.name.toLowerCase()) {
                displayResult(`* ${provider.name} (active)`, context);
            } else {
                displayResult(`  ${provider.name}`, context);
            }
        });
    }
}

export class SetCommandHandler implements CommandHandler {
    public readonly description = "Sets the active search provider";
    public readonly parameters = {
        args: {
            provider: {
                description: "The name of the search provider to set as active."
            },
        },
    } as const;
    public async run(context: ActionContext<BrowserActionContext>, params: ParsedCommandParams<typeof this.parameters>,): Promise<void> {
        const searchProviders: SearchProvider[] = context.sessionContext.agentContext.searchProviders;

        let bFound: boolean = false;
        searchProviders.forEach(provider => {
            if (provider.name.toLowerCase() === params.args.provider.toLowerCase()) {
                context.sessionContext.agentContext.activeSearchProvider = provider;
                displayResult(`${provider.name} is now the active search provider.`, context);
                bFound = true;

                // save the updated settings
                saveSettings(context.sessionContext);

                return;
            }
        });

        if (!bFound) {
            displayError(`Search provider '${params.args.provider}' not found.`, context);
        }
    }
}

export class ShowCommandHandler implements CommandHandler {
    public readonly description = "Shows the details of the selected search provider";
    public readonly parameters = {
        args: {
            provider: {
                description: "The name of the search provider to show details for."
            },
        },
    } as const;
    public async run(context: ActionContext<BrowserActionContext>, params: ParsedCommandParams<typeof this.parameters>,): Promise<void> {
        const searchProviders: SearchProvider[] = context.sessionContext.agentContext.searchProviders;

        let bFound: boolean = false;
        searchProviders.forEach(provider => {
            if (provider.name.toLowerCase() === params.args.provider.toLowerCase()) {
                displayResult(JSON.stringify(provider, null, 2), context);
                bFound = true;
                return;
            }
        });

        if (!bFound) {
            displayError(`Search provider '${params.args.provider}' not found.`, context);
        }
    }
}

export class AddCommandHandler implements CommandHandler {
    public readonly description = "Adds a new search provider";
    public readonly parameters = {
        args: {
            provider: {
                description: "The name of the search provider to add."
            },
            url: {
                description: "The URL of the search provider to add. '%s' will be replaced with the search parameter."
            }
        },
    } as const;
    public async run(context: ActionContext<BrowserActionContext>, params: ParsedCommandParams<typeof this.parameters>,): Promise<void> {
        const searchProviders: SearchProvider[] = context.sessionContext.agentContext.searchProviders;

        // make sure the URL has a search parameter place holder
        if (params.args.url.indexOf("%s") === -1) {
            displayError(`The URL must contain '%s' as a placeholder for the search parameter.`, context);
            return;
        }

        // does a provider with this name already exist?
        const idx = searchProviders.findIndex(provider => provider.name.toLowerCase() === params.args.provider.toLowerCase());
        if (idx !== -1) {
            displayError(`A search provider with the name '${params.args.provider}' already exists.`, context);
        } else {
            // Provider does not exist, add a new one
            context.sessionContext.agentContext.searchProviders.push({
                name: params.args.provider,
                url: params.args.url.replace("%s", params.args.url)
            });

            // save the updated settings
            saveSettings(context.sessionContext);

            displayResult(`Added search provider '${params.args.provider}'.`, context);
        }
    }
}

export class RemoveCommandHandler implements CommandHandler {
    public readonly description = "Removes the selected search provider";
    public readonly parameters = {
        args: {
            provider: {
                description: "The name of the search provider to remove."
            },
        },
    } as const;
    public async run(context: ActionContext<BrowserActionContext>, params: ParsedCommandParams<typeof this.parameters>,): Promise<void> {
        const searchProviders: SearchProvider[] = context.sessionContext.agentContext.searchProviders;

        const providerCount: number = searchProviders.length;
        const newSearchProviders = searchProviders.filter(value => value.name.toLowerCase() !== params.args.provider.toLowerCase());

        if (providerCount > newSearchProviders.length) {

            if (newSearchProviders.length === 0) {
                displayError("You cannot delete the search provider.  There must be at least one search provider.", context);
                return;
            }

            context.sessionContext.agentContext.searchProviders = newSearchProviders;

            // if we are deleting the active search provider we should replace it with something else
            if (context.sessionContext.agentContext.activeSearchProvider.name.toLowerCase() === params.args.provider.toLowerCase()) {                
                context.sessionContext.agentContext.activeSearchProvider = newSearchProviders[0];
                displayResult(`Search provider '${params.args.provider}' was the active search provider. New active search provider: ${newSearchProviders[0].name}`, context);
            }

            // save the updated settings
            saveSettings(context.sessionContext);

            displayResult(`Search provider '${params.args.provider}' removed.`, context);
        } else {
            displayError(`Search provider '${params.args.provider}' not found.`, context);
        }
    }
}

export class ImportCommandHandler implements CommandHandler {
    public readonly description = "Imports the search providers from the specified browser";
    public readonly parameters = {
        args: {
            browser: {
                description: "The name of the browser to import search providers from: [Edge | Chrome]."
            },
        },
    } as const;
    public async run(context: ActionContext<BrowserActionContext>, params: ParsedCommandParams<typeof this.parameters>,): Promise<void> {
        // TODO: implement import from chrome/edge
        displayError(`This feature is NOT implemented yet!`, context);
    }
}