#!/usr/bin/env node
import { loadGrammarRules } from "../../actionGrammar/dist/grammarLoader.js";
import { compileGrammarToNFA } from "../../actionGrammar/dist/nfaCompiler.js";
import { matchGrammarWithNFA } from "../../actionGrammar/dist/nfaMatcher.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load grammar source and compile
const grammarPath = path.join(__dirname, "src/desktopSchema.agr");
const grammarText = fs.readFileSync(grammarPath, "utf-8");
const grammar = loadGrammarRules("desktopSchema.agr", grammarText);
const nfa = compileGrammarToNFA(grammar);

console.log("Testing schemaName output from grammar matcher...\n");

const testPhrases = [
    "show accent color on title bars",
    "enable transparency",
    "center the taskbar",
    "allow microphone access",
];

for (const phrase of testPhrases) {
    console.log(`\nPhrase: "${phrase}"`);
    const results = matchGrammarWithNFA(grammar, nfa, phrase);

    if (results.length > 0) {
        const match = results[0].match;
        console.log("  actionName:", match.actionName);
        console.log("  schemaName:", match.schemaName || "(not set)");
        console.log("  Full match:", JSON.stringify(match, null, 2));
    } else {
        console.log("  NO MATCH");
    }
}
