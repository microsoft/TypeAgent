// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslator, MultimodalPromptContent } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { openai as ai } from "aiclient";
import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "./browserActions.mjs";

import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:crossword:schema");

// Crossword schema types
export interface CrosswordClue {
    number: number;
    text: string;
    cssSelector: string;
}

export interface Crossword {
    across: CrosswordClue[];
    down: CrosswordClue[];
}

interface CrosswordPresence {
    crossWordPresent: boolean;
}

type HtmlFragments = {
    frameId: string;
    content: string;
    text?: string;
    cssSelector?: string;
};

// Schema definitions as strings for TypeChat
const CROSSWORD_SCHEMA = `
export interface CrosswordClue {
    number: number;
    text: string;
    cssSelector: string;
}

export interface Crossword {
    across: CrosswordClue[];
    down: CrosswordClue[];
}
`;

const PRESENCE_SCHEMA = `
export interface CrosswordPresence {
    crossWordPresent: boolean;
}
`;

function createModel() {
    const apiSettings = ai.azureApiSettingsFromEnv(
        ai.ModelType.Chat,
        undefined,
        "GPT_5_MINI",
    );
    return ai.createChatModel(apiSettings, { temperature: 1 }, undefined, [
        "crossword",
    ]);
}

async function checkIsCrosswordOnPage(
    fragments: HtmlFragments[],
): Promise<boolean> {
    const model = createModel();
    const validator = createTypeScriptJsonValidator<CrosswordPresence>(
        PRESENCE_SCHEMA,
        "CrosswordPresence",
    );
    const translator = createJsonTranslator(model, validator);
    translator.createRequestPrompt = () => "";

    const htmlContent = JSON.stringify(
        fragments.map((f) => f.content),
        undefined,
        2,
    );

    const promptSections = [
        {
            type: "text",
            text: "You are a virtual assistant that can help users to complete requests by interacting with the UI of a webpage.",
        },
        {
            type: "text",
            text: `Here are HTML fragments from the page:\n'''\n${htmlContent}\n'''`,
        },
        {
            type: "text",
            text: `Use the layout information provided to generate a "CrosswordPresence" response using the typescript schema below:\n'''\n${PRESENCE_SCHEMA}\n'''\nThe following is the COMPLETE JSON response object with 2 spaces of indentation:`,
        },
    ];

    const response = await translator.translate("", [
        { role: "user", content: promptSections as MultimodalPromptContent[] },
    ]);

    return (
        response.success &&
        (response.data as CrosswordPresence).crossWordPresent
    );
}

async function extractCluesWithSelectors(
    fragments: HtmlFragments[],
): Promise<Crossword | undefined> {
    const model = createModel();
    const validator = createTypeScriptJsonValidator<Crossword>(
        CROSSWORD_SCHEMA,
        "Crossword",
    );
    const translator = createJsonTranslator(model, validator);
    translator.createRequestPrompt = () => "";

    const htmlContent = JSON.stringify(
        fragments.map((f) => f.content),
        undefined,
        2,
    );

    const promptSections = [
        {
            type: "text",
            text: "You are a virtual assistant that can help users to complete requests by interacting with the UI of a webpage.",
        },
        {
            type: "text",
            text: `Here are HTML fragments from the page:\n'''\n${htmlContent}\n'''`,
        },
        {
            type: "text",
            text: `Use the layout information provided to generate a "Crossword" response using the typescript schema below. This MUST include all the clues in the crossword.\n'''\n${CROSSWORD_SCHEMA}\n'''\nThe following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:`,
        },
    ];

    const response = await translator.translate("", [
        { role: "user", content: promptSections as MultimodalPromptContent[] },
    ]);

    if (response.success) {
        const data = response.data as Crossword;
        if (data.across.length > 3 && data.down.length > 3) {
            return data;
        }
    }

    return undefined;
}

export async function extractCrosswordSchema(
    context: SessionContext<BrowserActionContext>,
    targetClientId?: string,
): Promise<Crossword | undefined> {
    const agentContext = context.agentContext;
    if (!agentContext.browserControl) {
        throw new Error("No connection to browser session.");
    }

    const extractionStart = performance.now();

    // R4: Removed redundant server-side awaitPageLoad — client already waits
    // via awaitPageReady() before issuing this RPC call.
    const htmlFragments = await agentContext.browserControl.getHtmlFragments();
    const fragmentsElapsed = (performance.now() - extractionStart).toFixed(0);
    debug(
        `Found ${htmlFragments.length} HTML fragments in ${fragmentsElapsed}ms`,
    );

    // Filter to candidate fragments that might contain crossword
    const candidateFragments: HtmlFragments[] = [];
    const checkPromises: Promise<boolean>[] = [];

    for (const fragment of htmlFragments) {
        if (!fragment.content || fragment.content.length < 500) {
            continue;
        }
        checkPromises.push(checkIsCrosswordOnPage([fragment]));
    }

    const presenceStart = performance.now();
    const checkResults = await Promise.all(checkPromises);
    const presenceElapsed = (performance.now() - presenceStart).toFixed(0);
    debug(`Presence detection completed in ${presenceElapsed}ms`);

    let fragmentIndex = 0;
    for (const fragment of htmlFragments) {
        if (!fragment.content || fragment.content.length < 500) {
            continue;
        }
        if (checkResults[fragmentIndex]) {
            candidateFragments.push({
                frameId: fragment.frameId,
                content: fragment.content,
            });
        }
        fragmentIndex++;
    }

    if (candidateFragments.length === 0) {
        debug("No crossword fragments found on the page.");
        return undefined;
    }

    debug(
        `Found ${candidateFragments.length} candidate fragments for crossword.`,
    );

    // R3: Extract clues from all candidates in parallel, return first valid result
    const clueStart = performance.now();
    const extractionResults = await Promise.all(
        candidateFragments.map((fragment) =>
            extractCluesWithSelectors([fragment]),
        ),
    );
    const clueElapsed = (performance.now() - clueStart).toFixed(0);
    debug(`Clue extraction completed in ${clueElapsed}ms`);

    const validResult = extractionResults.find((r) => r !== undefined);
    if (validResult) {
        const totalElapsed = (performance.now() - extractionStart).toFixed(0);
        debug(`Successfully extracted crossword schema in ${totalElapsed}ms`);
        return validResult;
    }

    debug("No valid crossword clues found on the page.");
    return undefined;
}
