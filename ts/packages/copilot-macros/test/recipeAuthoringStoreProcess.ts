// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const {
    DurableRecipeAuthoringContextStore,
    parseRecipeAuthoringEnvelope,
}: typeof import("../src/recipeAuthoringStore.js") = await import(
    new URL("../recipeAuthoringStore.js", import.meta.url).href
);

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
try {
    await new DurableRecipeAuthoringContextStore(process.argv[2]).put(
        parseRecipeAuthoringEnvelope(input),
    );
    process.stdout.write("stored");
} catch (error) {
    process.stderr.write(
        error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
}
