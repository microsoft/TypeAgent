// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DurableRecipeCatalog } from "@typeagent/copilot-macros/recipeCatalog";
import {
    recipeArtifact,
    recipeCapture,
    recipeJob,
    recipeScope,
} from "./recipeCatalogFixtures.js";

const [directory, operation, identity] = process.argv.slice(2);
const catalog = new DurableRecipeCatalog(directory);
try {
    if (operation === "crash") {
        const snapshot = await catalog.snapshot(recipeScope);
        await catalog.transact(recipeScope, snapshot.catalogRevision, (tx) => {
            tx.enqueueCapture(recipeCapture(identity), recipeJob(identity));
            process.exit(17);
        });
    } else {
        for (;;) {
            const snapshot = await catalog.snapshot(recipeScope);
            let claimed = false;
            const result = await catalog.transact(
                recipeScope,
                snapshot.catalogRevision,
                (tx) => {
                    if (operation === "enqueue")
                        tx.enqueueCapture(
                            recipeCapture(identity),
                            recipeJob(identity),
                        );
                    else if (operation === "publish") {
                        tx.enqueueCapture(
                            recipeCapture(identity),
                            recipeJob(identity),
                        );
                        const artifact = recipeArtifact(
                            "shared-recipe",
                            identity,
                        );
                        tx.putImmutable(artifact);
                        tx.publish(artifact, identity, "ready");
                    } else if (operation === "claim") {
                        claimed = Boolean(
                            tx.claimJob(
                                "job-capture",
                                identity,
                                new Date().toISOString(),
                                new Date(Date.now() + 60000).toISOString(),
                            ),
                        );
                    } else if (operation === "disable") {
                        tx.invalidate(JSON.parse(identity), "disabled");
                    } else throw new Error("Unknown test operation.");
                },
            );
            if (result.status === "conflict") continue;
            process.stdout.write(JSON.stringify({ claimed }));
            break;
        }
    }
} finally {
    catalog.close();
}
