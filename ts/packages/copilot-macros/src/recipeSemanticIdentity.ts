// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { recipeDigest } from "./recipeCore.js";

// Canonical JSON comparisons also work across isolated host/VM realms, unlike
// prototype-sensitive deep equality.
export function recipeSemanticContractIdentity(value: unknown): string {
    return recipeDigest(
        JSON.stringify(value, (_key, item: unknown) =>
            item !== null && typeof item === "object" && !Array.isArray(item)
                ? Object.fromEntries(
                      Object.entries(item).sort(([left], [right]) =>
                          left < right ? -1 : left > right ? 1 : 0,
                      ),
                  )
                : item,
        ),
    );
}
