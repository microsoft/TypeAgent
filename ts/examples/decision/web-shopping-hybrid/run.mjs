import { pathToFileURL } from "node:url";
import { main, options, runDemo } from "../web-shopping-generative/run.mjs";
import { selectHybrid } from "./selection.mjs";

export function runHybrid(values = options()) {
    return runDemo(values, {
        kind: "hybrid",
        select: selectHybrid,
        outputDirectory: new URL("./", import.meta.url),
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    main(runHybrid);
