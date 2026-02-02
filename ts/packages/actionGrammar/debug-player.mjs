import { loadGrammarRules } from './dist/grammarLoader.js';
import { compileGrammarToNFA } from './dist/nfaCompiler.js';
import { matchNFA } from './dist/nfaInterpreter.js';
import * as fs from 'fs';

// Enable debug logging
process.env.DEBUG_NFA = '1';

const content = fs.readFileSync('../agents/player/src/agent/playerSchema.agr', 'utf8');
const grammar = loadGrammarRules('playerSchema.agr', content);
const nfa = compileGrammarToNFA(grammar, 'player');

console.log('=== Testing player grammar ===');
console.log('Accept states:', nfa.acceptingStates);

// Show states with actionValue
console.log('\n=== States with actionValue ===');
for (let i = 0; i < Math.min(30, nfa.states.length); i++) {
    const state = nfa.states[i];
    if (state.actionValue) {
        console.log(`State ${i}:`);
        console.log('  actionValue type:', state.actionValue?.type);
        if (state.actionValue?.type === 'action') {
            console.log('  actionName:', state.actionValue.actionName);
        }
        if (state.slotMap) {
            console.log('  slotMap:', [...state.slotMap.entries()]);
        }
    }
}

const testCases = [
    ['play', 'Hello', 'by', 'Adele'],
];

for (const tokens of testCases) {
    console.log(`\n=== Testing: "${tokens.join(' ')}" ===`);
    const result = matchNFA(nfa, tokens, true);
    console.log('  matched:', result.matched);
    console.log('  ruleIndex:', result.ruleIndex);
    console.log('  actionValue:', JSON.stringify(result.actionValue, null, 2));
    if (result.debugSlotMap) {
        console.log('  debugSlotMap:', [...result.debugSlotMap.entries()]);
    }
}
