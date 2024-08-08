// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TypeChatAgent } from "../typeChatAgent.js";
import {
    Conjunctions,
    MultiRequestExplanation,
    SimpleSentenceRequest,
} from "./multiRequestExplanationSchemaV5.js";
import { Action, IAction, RequestAction } from "../requestAction.js";
import { createJsonTranslatorFromFile } from "common-utils";
import { getPackageFilePath } from "../../utils/getPackageFilePath.js";
import {
    GenericExplanationResult,
    ProcessRequestActionResult,
} from "../../index.js";

// This is the format the cache would explain if it is a multi-action per simple request sentence.
export type CachedMultipleAction = {
    actionName: "simpleMultiple";
    parameters: {
        actions: IAction[];
    };
};

export const multiRequestExplainer = new TypeChatAgent(
    "multi-request explanation",
    () => {
        return createJsonTranslatorFromFile<MultiRequestExplanation>(
            "MultiRequestExplanation",
            getPackageFilePath(
                "./src/explanation/v5/multiRequestExplanationSchemaV5.ts",
            ),
        );
    },
    (requestAction: RequestAction) => {
        return (
            `The user request is translated into a an JSON array of actions.\n` +
            `Break the request into non-overlapping sentences and phrase connecting the sentences in between.\n` +
            `Keep it as one request with multiple actions for a single sentence.`
        );
    },
    (requestAction) => requestAction.toPromptString(false),
);

function isSimpleSentenceRequest(
    subphrase: SimpleSentenceRequest | Conjunctions,
): subphrase is SimpleSentenceRequest {
    return subphrase.hasOwnProperty("actionIndex");
}

export async function explainMultipleActions(
    requestAction: RequestAction,
    explainSubrequest: (
        subRequestAction: RequestAction,
    ) => Promise<ProcessRequestActionResult>,
): Promise<GenericExplanationResult> {
    const multiRequestExplanation =
        await multiRequestExplainer.run(requestAction);
    if (!multiRequestExplanation.success) {
        return multiRequestExplanation;
    }

    // TODO: wrong type
    const actions = requestAction.actions as any;
    const multiActionExplanation = multiRequestExplanation.data;
    const subExplanationsP: Promise<ProcessRequestActionResult>[] = [];
    const conjunctions: string[] = [];
    for (const subPhrase of multiActionExplanation.subPhrases) {
        if (isSimpleSentenceRequest(subPhrase)) {
            const subActions = subPhrase.actionIndex.map(
                (index) => actions.parameters.actions[index],
            );
            if (subActions.length === 0) {
                throw new Error("Empty sub-action index array");
            }
            const translatorName = subActions[0].translatorName;
            let subRequestAction: RequestAction;
            if (subActions.length === 1) {
                subRequestAction = RequestAction.create(
                    subPhrase.text,
                    new Action(subActions[0].action, translatorName),
                    requestAction.history,
                );
            } else {
                if (
                    subActions.some((a) => a.translatorName !== translatorName)
                ) {
                    throw new Error(
                        "NYI: Unable to cache multiple actions with different translators",
                    );
                }
                const subAction: any = {
                    actionName: "simpleMultiple",
                    parameters: { actions: subActions },
                };
                subRequestAction = RequestAction.create(
                    subPhrase.text,
                    new Action(subAction, translatorName),
                    requestAction.history,
                );
            }

            subExplanationsP.push(explainSubrequest(subRequestAction));
        } else {
            conjunctions.push(subPhrase.text);
        }
    }

    const subExplanations = await Promise.all(subExplanationsP);
    const success = subExplanations.every(
        (subExplanation) =>
            subExplanation.explanationResult.explanation.success,
    );
    return success
        ? {
              success,
              data: {
                  multiRequestExplanation,
                  subExplanations,
              },
          }
        : {
              success,
              message: "Some sub-explanations failed",
          };
}
