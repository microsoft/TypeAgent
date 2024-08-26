// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DispatcherAgentContext,
    TurnImpression,
    createTurnImpressionFromLiteral,
} from "@typeagent/agent-sdk";
import { CorrectionAction } from "../translation/correctionActionsSchema.js";

export async function executeCorrectionAction(
    action: CorrectionAction,
    context: DispatcherAgentContext<undefined>,
): Promise<TurnImpression> {
    const { correctionRequest } = action.parameters;
    return createTurnImpressionFromLiteral(
        `Ok I have corrected the previous request.`,
    );
}
