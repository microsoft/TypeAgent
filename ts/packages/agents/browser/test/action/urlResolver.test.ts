// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import fs from "fs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:test:urlResolver");

// describe("URL Resolver Tests", () => {

//     const resolver = require("../../src/agent/resolveURL");
//     const urls = fs.readFileSync("test/data/urls.txt", "utf-8").split("\n"); 
//     urls.shift(); // Remove the first line which is a comment

//     it("should resolve URLs correctly", async () => {        
//         for (const url of urls) {
//             const temp = url.split("\t"); 
//             const utterance = temp[0].trim();
//             const site = temp[1].trim();

//             //console.warn(actionModule);
//             const resolved = await resolver.resolveURLWithSearch(utterance);


//             debug(`URL site mismatch for ${utterance} to ${site}, resolved to: ${resolved}`);
//             expect(resolved).toEqual(site);
//         }
//     });
// });