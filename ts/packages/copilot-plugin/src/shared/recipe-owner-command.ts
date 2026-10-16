// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getRecipeOwner,
    readConfig,
    writeConfig,
    type RecipeOwner,
} from "./plugin-config.js";

export function recipeOwnerSetting(input?: string): string {
    const requested = input?.trim().toLowerCase();
    if (requested) {
        if (!["plugin", "typeagent", "off"].includes(requested))
            throw new Error("Recipe owner must be plugin, typeagent, or off.");
        if (process.env.TYPEAGENT_RECIPE_OWNER !== undefined)
            throw new Error(
                "TYPEAGENT_RECIPE_OWNER overrides this setting. Change the launch environment and restart.",
            );
        const recipeOwner = requested as RecipeOwner;
        writeConfig({ ...(readConfig() ?? { mode: "direct" }), recipeOwner });
    }
    return `Recipe owner: ${getRecipeOwner()}. Close and restart the native Copilot session after changing owners. Plugin owns a separate local workspace/profile catalog; typeagent restores the Checkpoint B backend path. Off disables recipe routing and learning. Completed effects are not rolled back.`;
}
