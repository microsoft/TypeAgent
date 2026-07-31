// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Library entry point: the merged TypeAgent help grounding, exposed so the
// dispatcher's built-in `system.help` can reuse it (command lookup + capability
// checks + conceptual/setup explanation in one call) without duplicating the
// catalog/docs grounding. The describe-an-agent path is handled separately by
// the dispatcher's live describeCore, so it is not here.

export { runHelp } from "./selfHelpActionHandler.js";
