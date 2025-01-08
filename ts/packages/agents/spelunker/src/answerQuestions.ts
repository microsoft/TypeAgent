// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionResultSuccess } from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";

import { SpelunkerContext } from "./spelunkerActionHandler.js";

export function answerQuestion(
    context: SpelunkerContext,
    input: string,
): ActionResultSuccess {
    const displayText = `TODO: Answer question "${input}"`;
    return createActionResultFromTextDisplay(displayText, displayText);
}
