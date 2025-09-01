// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parentPort, workerData } from "worker_threads";
import chalk from "chalk";
import { Result } from "typechat";
import { domains } from "./generateOpenCommandPhrasesSchema.js";
import { createTypeChat, loadSchema } from "typeagent";
import { ChatModelWithStreaming, CompletionSettings, openai } from "aiclient";
import { isPageAvailable } from "./common.js";

async function processDomains(domains: string[]) {
    // check to see if each domain is available and if it is not, remove it from the domains to process
    const availableDomains = await Promise.all(
        domains.map(async (domain) => {
            const isAvailable = await isPageAvailable(domain);

            if (!isAvailable) {
                console.warn(chalk.yellow(`Skipping domain: ${domain}`));
            }

            return isAvailable ? domain : null;
        }),
    );

    const filteredDomains = availableDomains.filter(
        (domain) => domain !== null,
    );

    if (filteredDomains.length > 0) {
        console.log(
            chalk.blue(`Processing domains: ${filteredDomains.join(", ")}`),
        );
        try {
            const response = await getTypeChatResponse(filteredDomains.join("\n"));
            if (response.success) {
                parentPort?.postMessage({
                    success: true,
                    domains: response.data.domains,
                });
            } else {
                parentPort?.postMessage({ success: false });
            }
        } catch (err: any) {
            parentPort?.postMessage({ success: false, error: err.message });
        }
    } else {
       console.log(
            chalk.cyan(`NO DOMAINS FOR PROCESSING!`),
        );
        parentPort?.postMessage({ success: true, domains: [] });
    }
}

// This script expects workerData to contain { domains, modulePath }
(async () => {
    await processDomains(workerData.domains);
})();

async function getTypeChatResponse(
    pageMarkdown: string,
): Promise<Result<domains>> {
    // Create Model instance
    let chatModel = createModel(false);

    // Create Chat History
    let maxContextLength = 8196;
    let maxWindowLength = 30;

    // create TypeChat object
    const chat = createTypeChat<domains>(
        chatModel,
        loadSchema(["generateOpenCommandPhrasesSchema.ts"], import.meta.url),
        "domains",
        `
There is a system that uses the command "Open" to open URLs in the browser.  You are helping me generate terms that I can cache such that when the user says "open apple" it goes to "https://apple.com".  You generate alternate terms/keywords/phrases/descriptions a user could use to invoke the same site. Avoid using statements that could actually refer to sub pages like (open ipad page). since those are technically different URLs.
Leave off "open" from the beginning of each phrase.

For example: apple.com could be:

- open apple
- open iphone maker
- open ipad maker
        `,
        [],
        maxContextLength,
        maxWindowLength,
    );

    // make the request
    const chatResponse = await chat.translate(pageMarkdown);

    return chatResponse;
}

function createModel(fastModel: boolean = true): ChatModelWithStreaming {
    let apiSettings: openai.ApiSettings | undefined;
    if (!apiSettings) {
        if (fastModel) {
            apiSettings = openai.localOpenAIApiSettingsFromEnv(
                openai.ModelType.Chat,
                undefined,
                openai.GPT_5_NANO,
                ["websiteAliases"],
            );
        } else {
            apiSettings = openai.localOpenAIApiSettingsFromEnv(
                openai.ModelType.Chat,
                undefined,
                openai.GPT_5,
                ["websiteAliases"],
            );
        }
    }

    let completionSettings: CompletionSettings = {
        temperature: 1.0,
        // Max response tokens
        max_tokens: 1000,
        // createChatModel will remove it if the model doesn't support it
        response_format: { type: "json_object" },
    };

    const chatModel = openai.createChatModel(
        apiSettings,
        completionSettings,
        undefined,
        ["websiteAliases"],
    );

    return chatModel;
}
