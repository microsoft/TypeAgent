// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { registerBuiltInEntities } from "@typeagent/action-grammar";
import { registerNPEntity } from "./npEntity.js";
import { compile, runExample } from "./runner.js";
import {
    rateBookGrammar,
    bookRestaurantGrammar,
    playMusicGrammar,
} from "./grammar.js";

registerBuiltInEntities();
registerNPEntity();

function show(intent: string, text: string, build: (s: any) => string): void {
    const g = compile(intent, build("wildcard"), `${intent}_dbg`);
    const tokens = text.split(/\s+/);
    const r = runExample(tokens, [g], intent);
    console.log(`\n[${intent}] ${text}`);
    console.log("  matched:", r.matched, "action:", JSON.stringify(r.action));
}

show("RateBook", "rate this novel 5 stars", rateBookGrammar);
show("RateBook", "rate this series a 5", rateBookGrammar);
show("RateBook", "rate my current book 1 out of 6", rateBookGrammar);
show("BookRestaurant", "book a brasserie for one", bookRestaurantGrammar);
show("BookRestaurant", "book a spot for 3 in mt", bookRestaurantGrammar);
show(
    "BookRestaurant",
    "book a restaurant at sixteen o clock in sc",
    bookRestaurantGrammar,
);
show("PlayMusic", "play a chant by mj cole", playMusicGrammar);
