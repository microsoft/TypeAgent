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
        if (requested !== "plugin" && requested !== "off")
            throw new Error(
                "Recipe owner must be plugin or off. The TypeAgent owner was removed; re-record tasks in the plugin catalog.",
            );
        if (process.env.TYPEAGENT_RECIPE_OWNER !== undefined)
            throw new Error(
                "TYPEAGENT_RECIPE_OWNER overrides this setting. Change the launch environment and restart.",
            );
        const recipeOwner = requested as RecipeOwner;
        writeConfig({ ...(readConfig() ?? { mode: "direct" }), recipeOwner });
    }
    return `Recipe owner: ${getRecipeOwner()}. Close and restart the native Copilot session after changing this setting. Plugin owns the local workspace/profile catalog. Off disables recipe routing and learning; it never selects another owner. Completed effects are not rolled back.`;
}
