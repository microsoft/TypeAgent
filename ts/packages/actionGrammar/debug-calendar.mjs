import { loadGrammarRules } from './dist/grammarLoader.js';
import { compileGrammarToNFA } from './dist/nfaCompiler.js';
import { matchNFA } from './dist/nfaInterpreter.js';
import * as fs from 'fs';

const content = fs.readFileSync('../agents/calendar/src/calendarSchema.agr', 'utf8');
const grammar = loadGrammarRules('calendarSchema.agr', content);
const nfa = compileGrammarToNFA(grammar, 'calendar');

console.log('=== NFA State Info ===');
console.log('Accept states:', nfa.acceptingStates);

// Look at the first few states with actionValue
for (let i = 0; i < Math.min(20, nfa.states.length); i++) {
    const state = nfa.states[i];
    if (state.actionValue) {
        console.log(`\nState ${i} actionValue:`, JSON.stringify(state.actionValue, (k, v) => v instanceof Map ? [...v.entries()] : v, 2));
    }
    if (state.slotMap) {
        console.log(`State ${i} slotMap:`, [...state.slotMap.entries()]);
    }
}

console.log('\n=== Testing match ===');
const tokens = ['set', 'up', 'meeting', 'on', 'Monday', 'at', '3pm'];
console.log('Tokens:', tokens);

const result = matchNFA(nfa, tokens, true);
console.log('\nMatch result:');
console.log('  matched:', result.matched);
console.log('  ruleIndex:', result.ruleIndex);
console.log('  actionValue:', JSON.stringify(result.actionValue, null, 2));

if (result.debugSlotMap) {
    console.log('  debugSlotMap:', [...result.debugSlotMap.entries()]);
}
