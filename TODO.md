# TODO

This file collates all TODO comments found across the repository, organized by top-level directory.

> Auto-generated — do not edit manually. All assessment columns are evaluated by Claude Sonnet and may need manual review.

## .NET (`dotnet/`)

| File | Line | TODO | Effort | Feasibility | Scope | Recommendation | Needs Human? |
|------|------|------|--------|-------------|-------|----------------|--------------|
| `dotnet/autoShell/Services/WindowsDisplayService.cs` | 169 | better handle return value from change mode | Low | High | Local | Fix | No |
| `dotnet/autoShell/Services/WindowsVirtualDesktopService.cs` | 71 | proper HSTRING custom marshaling | Medium | Medium | Local | Fix | No |
| `dotnet/autoShell/Services/WindowsVirtualDesktopService.cs` | 300 | debug & get working | High | Low | Local | Fix | Yes |
| `dotnet/autoShell/Services/WindowsVirtualDesktopService.cs` | 328 | investigate. | High | Low | Local | No Fix | Yes |
| `dotnet/autoShell/Services/WindowsWindowService.cs` | 155 | Update this to account for UWP apps (e.g. calculator). UWPs are hosted by ApplicationFrameHost.exe | Medium | Medium | Local | Fix | No |
| `dotnet/autoShell/Services/WindowsWindowService.cs` | 195 | handle multiple monitors | Medium | High | Local | Fix | No |
| `dotnet/autoShell/Services/WindowsWindowService.cs` | 221 | handle left, top, right and nonexistent taskbars | Medium | High | Local | Fix | No |
| `dotnet/typeagent/examples/examplesLib/KnowProWriter.cs` | 57 | write tag | Low | High | Local | Fix | No |
| `dotnet/typeagent/examples/knowProConsole/Benchmarking/BenchmarkCommands.cs` | 1506 | make an extension method for this | Low | High | Local | Fix | No |
| `dotnet/typeagent/src/aiclient/AzureModelApiSettings.cs` | 97 | Load retry settings | Medium | Medium | Component | Fix | Yes |
| `dotnet/typeagent/src/aiclient/ITextEmbeddingModel.cs` | 12 | take IReadOnlyList as input | Low | High | Component | Fix | No |
| `dotnet/typeagent/src/aiclient/ITextEmbeddingModel.cs` | 18 | take IReadOnlyList as input | Low | High | Component | Fix | No |
| `dotnet/typeagent/src/aiclient/OpenAIChatModel.cs` | 76 | need a better way to handle required settings | Medium | Medium | Component | Fix | Yes |
| `dotnet/typeagent/src/aiclient/OpenAIChatModel.cs` | 136 | Add prompt_filter_results for content moderation results | Medium | High | Local | Fix | No |
| `dotnet/typeagent/src/aiclient/OpenAIChatModel.cs` | 137 | track other meta data? object, id, created, etc. | Low | Medium | Local | No Fix | Yes |
| `dotnet/typeagent/src/aiclient/OpenAIModelApiSettings.cs` | 54 | Load retry settings | Medium | Medium | Component | Fix | Yes |
| `dotnet/typeagent/src/conversationMemory/Podcast.cs` | 75 | add branching for other JSON formats | Medium | Medium | Local | Fix | Yes |
| `dotnet/typeagent/src/knowpro/ConversationAnswer.cs` | 27 | chunking not implemented yet | High | Low | Component | No Fix | Yes |
| `dotnet/typeagent/src/knowpro/ConversationExtensions.cs` | 44 | lower this method the collection | Low | High | Local | Fix | No |
| `dotnet/typeagent/src/knowpro/ConversationSearch.cs` | 12 | Handle cancellation in these APIS | Medium | High | Component | Fix | No |
| `dotnet/typeagent/src/knowpro/ConversationSearch.cs` | 13 | Add overloads on these APIS | Low | High | Component | Fix | Yes |
| `dotnet/typeagent/src/knowpro/ConversationSettings.cs` | 85 | migrate settings from current answer generator | Medium | Medium | Component | Fix | Yes |
| `dotnet/typeagent/src/knowpro/Facet.cs` | 44 | equality operators (including all IFacenValues) | Medium | High | Component | Fix | No |
| `dotnet/typeagent/src/knowpro/ITermToRelatedTermsIndex.cs` | 21 | consider IReadOnlyList | Low | High | Local | Fix | No |
| `dotnet/typeagent/src/knowpro/ITimestampToTextRangeIndex.cs` | 12 | Bulk operations | Medium | High | Component | Fix | Yes |
| `dotnet/typeagent/src/knowpro/PropertyToSemanticRefIndexer.cs` | 98 | Bulk operations | Medium | High | Component | Fix | No |
| `dotnet/typeagent/src/knowpro/PropertyToSemanticRefIndexer.cs` | 117 | Bulk operations | Medium | High | Component | Fix | No |
| `dotnet/typeagent/src/knowpro/PropertyToSemanticRefIndexer.cs` | 160 | Bulk operations | Medium | High | Component | Fix | No |
| `dotnet/typeagent/src/knowpro/Query/GroupByExpr.cs` | 23 | parallelize | Medium | Medium | Component | Fix | No |
| `dotnet/typeagent/src/knowpro/Query/GroupByExpr.cs` | 27 | SemanticRefs are cached during processing. | Low | High | Local | Fix | No |
| `dotnet/typeagent/src/knowpro/Query/LookupExtensions.cs` | 150 | avoid this double alloction | Low | High | Local | Fix | No |
| `dotnet/typeagent/src/knowpro/Query/MatchMessagesBooleanExpr.cs` | 60 | This can be done by directly retrieving text ranges from the semantic ref collection | Medium | Medium | Component | Fix | No |
| `dotnet/typeagent/src/knowpro/Query/MatchTermExpr.cs` | 58 | do this in parallel | Medium | Medium | Local | Fix | No |
| `dotnet/typeagent/src/knowpro/Query/MatchTermExpr.cs` | 179 | Do this in parallel | Medium | Medium | Local | Fix | No |
| `dotnet/typeagent/src/knowpro/Query/MessagesExpr.cs` | 40 | This can retrieve TextRanges only, not entire SemanticRefs. | Medium | Medium | Component | Fix | No |
| `dotnet/typeagent/src/knowpro/Query/QueryCompiler.cs` | 539 | refactor this logic | Medium | Medium | Component | Fix | Yes |
| `dotnet/typeagent/src/knowpro/Query/TextRangeCollection.cs` | 23 | Future: merge ranges | Medium | Medium | Local | Fix | No |
| `dotnet/typeagent/src/knowpro/SearchSelectExpr.cs` | 29 | pretty printer | Low | High | Local | Fix | No |
| `dotnet/typeagent/src/knowpro/SearchTermGroup.cs` | 82 | pretty printer | Low | High | Local | Fix | No |
| `dotnet/typeagent/src/knowpro/TermToSemanticRefIndexer.cs` | 10 | bulk operations | Medium | High | Component | Fix | No |
| `dotnet/typeagent/src/knowpro/TermToSemanticRefIndexer.cs` | 118 | Bulk operations | Medium | High | Component | Fix | No |
| `dotnet/typeagent/src/knowpro/WhenFilter.cs` | 24 | implement | High | Low | Component | No Fix | Yes |
| `dotnet/typeagent/src/knowproStorage/Sqlite/SqliteMessageCollection.cs` | 72 | Bulk operations | Medium | High | Component | Fix | No |
| `dotnet/typeagent/src/knowproStorage/Sqlite/SqliteMessageTextIndex.cs` | 248 | get rid of this conversion | Low | High | Local | Fix | No |
| `dotnet/typeagent/src/knowproStorage/Sqlite/SqliteSemanticRefCollection.cs` | 6 | update methods to use new wrappers and extension methods | Medium | High | Component | Fix | No |
| `dotnet/typeagent/src/knowproStorage/Sqlite/SqliteSemanticRefCollection.cs` | 66 | Bulk operations | Medium | High | Component | Fix | No |
| `dotnet/typeagent/src/knowproStorage/Sqlite/SqliteStorageProviderSchema.cs` | 65 | Normalize this. Split into Terms and Postings table | High | Medium | Component | Fix | No |
| `dotnet/typeagent/src/knowproStorage/Sqlite/SqliteTermToRelatedTerms.cs` | 63 | bulk operations | Medium | High | Component | Fix | No |
| `dotnet/typeagent/src/knowproStorage/Sqlite/SqliteTermToRelatedTermsFuzzy.cs` | 125 | Bulk operation | Medium | High | Component | Fix | No |
| `dotnet/typeagent/src/typechat.schema/TypescriptWriter.cs` | 201 | validation here to verify Begin & End match | Low | High | Local | Fix | No |
| `dotnet/typeagent/tests/typeChat.test/TestVocab.cs` | 59 | better checks for correctness | Medium | Medium | Local | Fix | Yes |

## TypeScript (`ts/`)

| File | Line | TODO | Effort | Feasibility | Scope | Recommendation | Needs Human? |
|------|------|------|--------|-------------|-------|----------------|--------------|
| `ts/examples/chat/src/codeChat/commandTransformer.ts` | 170 | the same for args (currently not used by code chat) | Low | Medium | Local | No Fix | Yes |
| `ts/examples/docuProc/src/pdfImporter.ts` | 210 | Try pre-computing embeddings in parallel to fill the embeddings cache (is that cache safe?) | Medium | Medium | Local | Fix | Yes |
| `ts/examples/docuProc/src/pdfQNAInteractiveApp.ts` | 1024 | Allow for multiple concurrent sessions. | High | Medium | Component | No Fix | Yes |
| `ts/examples/docuProc/src/pdfQNAInteractiveApp.ts` | 1031 | Cut off by total size, not count. | Low | High | Local | Fix | No |
| `ts/examples/docuProc/src/pdfQNAInteractiveApp.ts` | 1151 | limit how much we write per blob too (if there are multiple). | Low | High | Local | Fix | No |
| `ts/examples/docuProc/src/pdfQNAInteractiveApp.ts` | 1178 | Colorize code blocks. | Low | High | Local | Fix | No |
| `ts/examples/memoryProviders/src/sqlite/keyValueTable.ts` | 195 | support | Medium | Medium | Component | Fix | Yes |
| `ts/examples/memoryProviders/src/sqlite/textTable.ts` | 511 | optimize by lowering into DB if possible | Medium | Medium | Local | Fix | Yes |
| `ts/examples/memoryProviders/src/sqlite/textTable.ts` | 613 | Optimize | Medium | Medium | Local | Fix | Yes |
| `ts/examples/schemaStudio/src/schemaCommands.ts` | 94 | Generating settings command schemas... | Medium | Medium | Component | Fix | Yes |
| `ts/examples/spelunker/src/pythonImporter.ts` | 4 | Most of this is not Python specific; generalize to other languages. | High | Medium | Component | Fix | Yes |
| `ts/examples/spelunker/src/pythonImporter.ts` | 181 | Try pre-computing embeddings in parallel to fill the embeddings cache (is that cache safe?) | Medium | Medium | Local | Fix | Yes |
| `ts/examples/spelunker/src/queryInterface.ts` | 905 | Allow for multiple concurrent sessions. | High | Medium | Component | Fix | No |
| `ts/examples/spelunker/src/queryInterface.ts` | 912 | Cut off by total size, not count. | Low | High | Local | Fix | No |
| `ts/examples/spelunker/src/queryInterface.ts` | 1035 | limit how much we write per blob too (if there are multiple). | Low | High | Local | Fix | No |
| `ts/examples/spelunker/src/queryInterface.ts` | 1056 | Colorize code blocks. | Low | High | Local | Fix | No |
| `ts/examples/websiteAliases/src/pageContentKeywords.ts` | 284 | handle multi-modal content | High | Low | Component | No Fix | Yes |
| `ts/examples/websiteAliases/src/searchEngineKeywords.ts` | 284 | handle multi-modal content | High | Low | Component | No Fix | Yes |
| `ts/packages/actionGrammar/src/agentGrammarRegistry.ts` | 552 | Implement async DFA compilation | High | Medium | Component | Fix | No |
| `ts/packages/actionGrammar/src/environment.ts` | 406 | Spread elements are silently skipped: the current NFA | High | Medium | Component | Fix | Yes |
| `ts/packages/actionGrammar/src/grammarCompiler.ts` | 359 | Find a better way to discover entities instead of deriving them | Medium | Medium | Component | Fix | No |
| `ts/packages/actionGrammar/src/grammarCompiler.ts` | 953 | create regexp | Medium | High | Local | Fix | No |
| `ts/packages/actionGrammar/src/grammarRuleParser.ts` | 84 | Support nested instead of just Rule Ref | Medium | Medium | Component | Fix | No |
| `ts/packages/actionGrammar/src/grammarTypes.ts` | 174 | support optional string parts | Low | Medium | Local | Fix | No |
| `ts/packages/actionGrammar/src/grammarTypes.ts` | 177 | cache the regexp? | Low | High | Local | Fix | No |
| `ts/packages/actionGrammar/src/grammarValueTypeValidator.ts` | 1035 | look up entity return types from the entity registry instead of hard-coding | Medium | Medium | Component | Fix | No |
| `ts/packages/actionGrammar/src/nfaCompletion.ts` | 293 | The NFA path does not yet track wildcard-at-EOI states. | High | Medium | Component | Fix | No |
| `ts/packages/actionGrammar/test/dynamicGrammarLoader.spec.ts` | 423 | Re-enable after grammar imports and type declarations for converters are complete | Medium | Medium | Component | Fix | Yes |
| `ts/packages/actionGrammar/test/grammarCompletionKeywordSpacePunct.spec.ts` | 2334 | A planned non-exhaustive match mode that stops | High | Low | Component | No Fix | Yes |
| `ts/packages/actionGrammar/test/grammarCompletionKeywordSpacePunct.spec.ts` | 2635 | A planned non-exhaustive match mode that stops | High | Low | Component | No Fix | Yes |
| `ts/packages/actionGrammar/test/grammarMatcherSpacingNone.spec.ts` | 397 | Review the case item0xFFdone and see if we should make that work. | Medium | Medium | Local | Fix | Yes |
| `ts/packages/actionGrammar/test/nfaRealGrammars.spec.ts` | 85 | Value transformations (e.g., Ordinal -> number) not yet implemented in NFA | High | Medium | Component | Fix | No |
| `ts/packages/actionGrammar/test/nfaRealGrammars.spec.ts` | 92 | Value transformations not yet implemented | High | Medium | Component | Fix | No |
| `ts/packages/actionGrammar/test/nfaRealGrammars.spec.ts` | 113 | This doesn't match - need to investigate grammar structure | High | Low | Component | Fix | Yes |
| `ts/packages/actionGrammar/test/testUtils.ts` | 65 | Enable "nfa" and "dfa" variants once they match grammarMatcher behavior. | Medium | Medium | Component | Fix | No |
| `ts/packages/actionGrammar/test/testUtils.ts` | 162 | Enable "nfa" and "dfa" variants once they match grammarCompletion behavior. | Medium | Medium | Component | Fix | No |
| `ts/packages/actionSchema/src/jsonSchemaParser.ts` | 51 | resolve? | Medium | Medium | Component | Fix | Yes |
| `ts/packages/actionSchema/src/parser.ts` | 608 | Faithfully resolve intersection types | High | Medium | Component | Fix | No |
| `ts/packages/actionSchema/src/utils.ts` | 60 | doesn't work on union types yet. | Medium | Medium | Component | Fix | No |
| `ts/packages/agentRpc/src/client.ts` | 633 | Clean up the associated options. | Low | High | Local | Fix | No |
| `ts/packages/agentSdk/src/agentInterface.ts` | 57 | enable non-stringify pas content. | Medium | Medium | Cross-cutting | Fix | Yes |
| `ts/packages/agentSdk/src/agentInterface.ts` | 234 | only utf8 & base64 is supported for now. | Medium | Medium | Component | Fix | No |
| `ts/packages/agentSdkWrapper/src/webtask/tracing/types.ts` | 138 | Phase 2: Extract key elements from HTML | High | Low | Component | No Fix | Yes |
| `ts/packages/agents/browser/src/extension/views/extensionServiceBase.ts` | 579 | remove "type" from this dictionary. That will remove the need to wrap these values in a "parameters" object | Medium | Medium | Component | Fix | No |
| `ts/packages/agents/browser/src/extension/views/topicGraphView.ts` | 296 | Implement topic viewport neighborhood functionality | High | Medium | Component | Fix | Yes |
| `ts/packages/agents/calendar/src/calendarActionHandlerV3.ts` | 1120 | Implement sophisticated date parsing | Medium | High | Local | Fix | No |
| `ts/packages/agents/calendar/src/calendarActionHandlerV3.ts` | 1126 | Implement sophisticated time parsing | Medium | High | Local | Fix | No |
| `ts/packages/agents/desktop/src/connector.ts` | 127 | add shared agent storage or known storage location (requires permissions, trusted agents, etc.) | High | Low | Cross-cutting | No Fix | Yes |
| `ts/packages/agents/desktop/src/programNameIndex.ts` | 96 | Retry with back-off for 429 responses | Low | High | Local | Fix | No |
| `ts/packages/agents/greeting/src/greetingCommandHandler.ts` | 292 | personalize list based on user preferences | Medium | Medium | Component | Fix | Yes |
| `ts/packages/agents/list/src/listActionHandler.ts` | 386 | formalize the schema for activityContext | Medium | Medium | Component | Fix | Yes |
| `ts/packages/agents/montage/src/agent/montageActionHandler.ts` | 187 | tune? | Medium | Medium | Component | No Fix | Yes |
| `ts/packages/agents/montage/src/agent/montageActionHandler.ts` | 261 | allow the montage agent to switch between image indexes | Medium | Medium | Component | Fix | No |
| `ts/packages/agents/montage/src/agent/montageActionHandler.ts` | 262 | handle the case where the image index is locked | Medium | Medium | Component | Fix | No |
| `ts/packages/agents/montage/src/agent/montageActionHandler.ts` | 263 | handle image index that has been updated since we loaded it | Medium | Medium | Component | Fix | No |
| `ts/packages/agents/montage/src/agent/montageActionHandler.ts` | 357 | undo action? | Medium | Medium | Component | No Fix | Yes |
| `ts/packages/agents/montage/src/agent/montageActionHandler.ts` | 382 | Support updating non-active montages | Medium | Medium | Component | Fix | No |
| `ts/packages/agents/montage/src/agent/montageActionHandler.ts` | 477 | update project state with this action | Low | Medium | Component | Fix | No |
| `ts/packages/agents/montage/src/agent/montageActionHandler.ts` | 836 | implement | High | Low | Component | Fix | Yes |
| `ts/packages/agents/montage/src/agent/montageActionHandler.ts` | 840 | implement | High | Low | Component | Fix | Yes |
| `ts/packages/agents/montage/src/route/route.ts` | 99 | this will break on windows when the path exceeds 255 characters... | Medium | Medium | Component | Fix | No |
| `ts/packages/agents/montage/src/route/route.ts` | 153 | this will break on windows when the path exceeds 255 characters... | Medium | Medium | Component | Fix | No |
| `ts/packages/agents/player/src/client.ts` | 702 | Might want to use fuzzy matching here. | Medium | Medium | Component | Fix | No |
| `ts/packages/agents/player/src/client.ts` | 1318 | add filter validation to overall instance validation | Medium | Medium | Component | Fix | No |
| `ts/packages/agents/player/src/search.ts` | 253 | Might want to use fuzzy matching here. | Medium | Medium | Component | Fix | No |
| `ts/packages/agents/player/src/search.ts` | 561 | cache this. | Low | High | Component | Fix | No |
| `ts/packages/agents/player/src/trackFilter.ts` | 326 | year ranges | Medium | High | Local | Fix | No |
| `ts/packages/agents/player/src/userData.ts` | 301 | return names of playlists, sorted by timestamp | Low | High | Local | Fix | No |
| `ts/packages/agents/settings/src/settingsCommandHandler.ts` | 53 | apply this setting to the local system. '${action.parameters.originalRequest} | Medium | Medium | Component | Fix | Yes |
| `ts/packages/agents/spelunker/src/chunker.py` | 61 | dotted names | Medium | Medium | Local | Fix | No |
| `ts/packages/agents/spelunker/src/embeddings.ts` | 37 | Fix this | Medium | Medium | Local | Fix | Yes |
| `ts/packages/agents/spelunker/src/embeddings.ts` | 47 | tune | Medium | Medium | Local | No Fix | Yes |
| `ts/packages/agents/spelunker/src/embeddings.ts` | 186 | Fix this | Medium | Medium | Local | Fix | Yes |
| `ts/packages/agents/spelunker/src/eval.ts` | 27 | Read this from a file that can be edited before each run | Low | High | Local | Fix | No |
| `ts/packages/agents/spelunker/src/searchCode.ts` | 237 | tune | Medium | Medium | Local | No Fix | Yes |
| `ts/packages/agents/spelunker/src/searchCode.ts` | 238 | tune | Medium | Medium | Local | Fix | Yes |
| `ts/packages/agents/spelunker/src/searchCode.ts` | 268 | tune | Medium | Medium | Local | Fix | Yes |
| `ts/packages/agents/spelunker/src/searchCode.ts` | 287 | Prompt engineering | High | Medium | Local | Fix | Yes |
| `ts/packages/agents/spelunker/src/searchCode.ts` | 358 | Break into multiple functions. | Low | High | Local | Fix | No |
| `ts/packages/agents/spelunker/src/searchCode.ts` | 381 | Factor into simpler functions | Low | High | Local | Fix | No |
| `ts/packages/agents/spelunker/src/searchCode.ts` | 409 | Make this insert part of the transaction for this file | Medium | Medium | Local | Fix | No |
| `ts/packages/agents/spelunker/src/searchCode.ts` | 438 | Make this into its own function. | Low | High | Local | Fix | No |
| `ts/packages/agents/spelunker/src/searchCode.ts` | 439 | Numbers may look weird when long files are split by pythonChunker. | Medium | Medium | Local | Fix | Yes |
| `ts/packages/agents/spelunker/src/searchCode.ts` | 458 | Use appendDisplay (requires passing actionContext) | Low | Medium | Local | Fix | No |
| `ts/packages/agents/spelunker/src/spelunkerActionHandler.ts` | 89 | What other standard functions could be handy here? | Medium | Low | Component | No Fix | Yes |
| `ts/packages/agents/spelunker/src/summarizing.ts` | 42 | Prompt engineering | High | Medium | Local | Fix | Yes |
| `ts/packages/agents/spelunker/src/typescriptChunker.ts` | 198 | Move to caller? | Low | High | Local | Fix | No |
| `ts/packages/agents/video/src/videoActionHandler.ts` | 54 | dynamic duration | Medium | Medium | Local | Fix | Yes |
| `ts/packages/agents/weather/src/weatherActionHandler.ts` | 227 | Add more sophisticated validation: | Medium | High | Local | Fix | No |
| `ts/packages/aiclient/src/models.ts` | 31 | JsonSchemaType | Low | High | Local | Fix | No |
| `ts/packages/aiclient/src/models.ts` | 39 | JsonSchemaType | Low | High | Local | Fix | No |
| `ts/packages/aiclient/src/models.ts` | 176 | add support for videos | High | Medium | Component | Fix | Yes |
| `ts/packages/aiclient/src/openai.ts` | 580 | remove after API endpoint correctly handles this case | Low | Medium | Local | Fix | Yes |
| `ts/packages/aiclient/src/tokenCounter.ts` | 58 | intermittently cache these with the session | Medium | Medium | Component | Fix | Yes |
| `ts/packages/api/src/webDispatcher.ts` | 81 | expose executeAction so we can call that directly instead of running it through a command | Medium | Medium | Cross-cutting | Fix | Yes |
| `ts/packages/api/src/webDispatcher.ts` | 82 | bubble back any action results along with the command result | Medium | Medium | Cross-cutting | Fix | Yes |
| `ts/packages/api/src/webSocketServer.ts` | 49 | send agent greeting!? | Low | Medium | Local | Fix | Yes |
| `ts/packages/azure-ai-foundry/src/openPhraseGeneratorAgent.ts` | 150 | handle multi-modal content | High | Medium | Component | Fix | Yes |
| `ts/packages/azure-ai-foundry/src/urlResolver.ts` | 123 | handle multi-modal content | High | Medium | Component | Fix | No |
| `ts/packages/azure-ai-foundry/src/urlResolver.ts` | 344 | handle multi-modal content | High | Medium | Component | Fix | No |
| `ts/packages/azure-ai-foundry/src/urlResolver.ts` | 407 | implement | High | Low | Component | Fix | Yes |
| `ts/packages/azure-ai-foundry/src/urlResolverCache.ts` | 121 | make async | Low | High | Local | Fix | No |
| `ts/packages/azure-ai-foundry/src/websiteAliasExtraction.ts` | 65 | IMPLEMENT | High | Low | Component | Fix | Yes |
| `ts/packages/azure-ai-foundry/src/websiteAliasExtraction.ts` | 121 | handle multi-modal content | High | Medium | Component | Fix | No |
| `ts/packages/azure-ai-foundry/src/wikipedia.ts` | 102 | localization (e.g. en, de, fr, etc.) | Low | High | Local | Fix | No |
| `ts/packages/azure-ai-foundry/src/wikipedia.ts` | 125 | localization (e.g. en, de, fr, etc.) | Low | High | Local | Fix | No |
| `ts/packages/cache/src/cache/cache.ts` | 599 | Move this in the construction store | Medium | Medium | Component | Fix | Yes |
| `ts/packages/cache/src/cache/explainWorkQueue.ts` | 42 | check number too. | Low | High | Local | Fix | No |
| `ts/packages/cache/src/constructions/constructionCache.ts` | 420 | GC match sets | Medium | Medium | Component | Fix | No |
| `ts/packages/cache/src/constructions/constructionValue.ts` | 140 | Don't support multiple subphrase wildcard match for now. | Medium | Medium | Component | Fix | Yes |
| `ts/packages/cache/src/constructions/constructionValue.ts` | 156 | Only deal with exact match for now | Medium | Medium | Component | Fix | Yes |
| `ts/packages/cache/src/constructions/matchPart.ts` | 66 | non-diacritic match | Medium | Medium | Component | Fix | No |
| `ts/packages/cache/src/constructions/transforms.ts` | 208 | Better history matching heuristic. Currently it will just the first one in the list. | Medium | Medium | Component | Fix | No |
| `ts/packages/cache/src/explanation/typeChatAgent.ts` | 61 | probably most (all?) of these can be integrated into TypeChat | High | Low | Cross-cutting | No Fix | Yes |
| `ts/packages/cache/src/explanation/v5/explanationV5.ts` | 282 | consider to improve this for cases where different actions have the same parameters schema. | Medium | Medium | Component | Fix | No |
| `ts/packages/cache/src/explanation/v5/explanationV5.ts` | 645 | Don't use other synonyms or alternatives info for entities for now | Low | High | Local | No Fix | Yes |
| `ts/packages/cache/src/explanation/v5/propertyExplainationV5.ts` | 114 | fuzzy match | Medium | Medium | Component | Fix | No |
| `ts/packages/cache/src/explanation/validateExplanation.ts` | 91 | Is there a better typing | Low | High | Local | Fix | No |
| `ts/packages/cache/src/explanation/validateExplanation.ts` | 184 | better typing | Low | High | Local | Fix | No |
| `ts/packages/cache/src/explanation/validateExplanation.ts` | 209 | better typing | Low | High | Local | Fix | No |
| `ts/packages/cache/src/utils/language.ts` | 396 | initial implementation. Can be over-broad and incomplete. | Medium | Medium | Component | Fix | Yes |
| `ts/packages/cli/src/enhancedConsole.ts` | 655 | Not implemented | Medium | Medium | Component | Fix | Yes |
| `ts/packages/cli/src/enhancedConsole.ts` | 784 | Ignored | Low | High | Local | No Fix | Yes |
| `ts/packages/defaultAgentProvider/test/construction.spec.ts` | 74 | once MatchPart allow matches ignoring diacritical marks | Medium | Medium | Component | Fix | No |
| `ts/packages/defaultAgentProvider/test/construction.spec.ts` | 86 | Validating the lower case action | Low | High | Local | Fix | No |
| `ts/packages/defaultAgentProvider/test/construction.spec.ts` | 88 | needs fix these | Low | Medium | Local | Fix | Yes |
| `ts/packages/defaultAgentProvider/test/constructionCacheTestCommon.ts` | 240 | needs fix these | Low | Medium | Local | Fix | Yes |
| `ts/packages/defaultAgentProvider/test/grammar.spec.ts` | 93 | once MatchPart allow matches ignoring diacritical marks | Medium | Medium | Component | Fix | No |
| `ts/packages/defaultAgentProvider/test/schema.spec.ts` | 18 | mcpfilesystem schema can't be loaded without allowDirectory to start up the server. | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/context/appAgentManager.ts` | 1151 | Make this not hard coded | Low | High | Local | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/context/appAgentManager.ts` | 1182 | unload agent as well? | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/context/commandHandlerContext.ts` | 623 | instead of disabling this let's find a way to gracefully handle this | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/context/dispatcher/dispatcherAgent.ts` | 101 | formalize the schema for activityContext | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/context/dispatcher/dispatcherAgent.ts` | 190 | cache this? | Low | High | Local | Fix | No |
| `ts/packages/dispatcher/dispatcher/src/context/dispatcher/dispatcherAgent.ts` | 223 | This translation can probably more scoped based on the `actionName` field. | Medium | Medium | Component | Fix | No |
| `ts/packages/dispatcher/dispatcher/src/context/dispatcher/handlers/requestCommandHandler.ts` | 201 | This does not support activities. | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/context/dispatcher/handlers/requestCommandHandler.ts` | 328 | revisit | Low | Medium | Local | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/context/indexManager.ts` | 18 | add support to be able to "disable" an index | Medium | High | Component | Fix | No |
| `ts/packages/dispatcher/dispatcher/src/context/indexManager.ts` | 58 | find a good way to make a shared cache of .kr files and thumbnails for images | High | Medium | Cross-cutting | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/context/indexManager.ts` | 252 | get notification of when the index is rebuilt so that we can notify users that they could/should reload their index instances | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/context/memory.ts` | 236 | how about entities? | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/context/session.ts` | 220 | enable when it is ready. | Low | Low | Local | No Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/context/session.ts` | 225 | experimental. | Low | Low | Local | No Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/context/system/handlers/configCommandHandlers.ts` | 418 | implement in agent config/manifests | High | Medium | Cross-cutting | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/context/system/handlers/indexCommandHandler.ts` | 202 | implement | Medium | High | Component | Fix | No |
| `ts/packages/dispatcher/dispatcher/src/dispatcher.ts` | 279 | Note this doesn't prevent the function continue to be call if is saved. | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/execute/actionContext.ts` | 116 | Note this doesn't prevent the function continue to be call if is saved. | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/execute/activityContext.ts` | 16 | Support translator cache with activity? | High | Medium | Cross-cutting | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/execute/activityContext.ts` | 50 | validate activity context | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/execute/pendingActions.ts` | 150 | If there are multiple match, ignore for now. | Medium | Medium | Component | Fix | No |
| `ts/packages/dispatcher/dispatcher/src/execute/pendingActions.ts` | 318 | what if it is an literal type? | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/execute/pendingActions.ts` | 604 | use last access to get the latest one? | Low | Medium | Local | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/execute/pendingActions.ts` | 610 | More heuristics or clarification | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/helpers/console.ts` | 212 | Not implemented | Medium | High | Local | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/helpers/console.ts` | 226 | turn these in to dispatcher events | Medium | Medium | Cross-cutting | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/helpers/console.ts` | 266 | Ignored | Low | High | Local | No Fix | No |
| `ts/packages/dispatcher/dispatcher/src/helpers/console.ts` | 319 | Formalize the API | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/search/internet.ts` | 73 | other annotation types | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/search/internet.ts` | 344 | other annotation types | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/search/internet.ts` | 373 | handle multi-modal content | High | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/search/search.ts` | 125 | how about entities? | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/translation/actionSchemaFileCache.ts` | 66 | validate the json | Low | High | Local | Fix | No |
| `ts/packages/dispatcher/dispatcher/src/translation/actionTemplate.ts` | 79 | smarter about type unions. | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/translation/actionTemplate.ts` | 82 | need to handle circular references (or error on circular references) | Medium | High | Component | Fix | No |
| `ts/packages/dispatcher/dispatcher/src/translation/entityResolution.ts` | 139 | Should we use the index here? Probably need the translation to validate the index to match the name. | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/translation/entityResolution.ts` | 146 | Should we use the index here? Probably need the translation to validate the index to match the name. | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/translation/entityResolution.ts` | 153 | Should we use the index here? Probably need the translation to validate the index to match the name. | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/translation/requestCompletion.ts` | 128 | assuming the partial action doesn't change the possible values. | Low | Medium | Local | No Fix | No |
| `ts/packages/dispatcher/dispatcher/src/translation/translateRequest.ts` | 392 | streaming currently doesn't not support multiple actions | High | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/translation/translateRequest.ts` | 644 | What to do with attachments with multiple actions? | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/translation/translateRequest.ts` | 661 | What to do with attachments with multiple actions? | Medium | Medium | Component | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/translation/unknownSwitcher.ts` | 142 | this should be adjusted based on model used. | Low | High | Local | Fix | Yes |
| `ts/packages/dispatcher/dispatcher/src/translation/unknownSwitcher.ts` | 186 | we can parallelize this | Medium | High | Local | Fix | No |
| `ts/packages/dispatcher/dispatcher/src/utils/test/explanationTestData.ts` | 49 | Test data only support a single schema name for now. | Medium | Medium | Component | Fix | No |
| `ts/packages/dispatcher/types/src/clientIO.ts` | 92 | turn these in to dispatcher events | Medium | Medium | Cross-cutting | Fix | Yes |
| `ts/packages/dispatcher/types/src/clientIO.ts` | 121 | Formalize the API | High | Medium | Cross-cutting | Fix | Yes |
| `ts/packages/knowPro/src/collections.ts` | 94 | make this 2 methods: addExact and addRelated | Low | High | Component | Fix | No |
| `ts/packages/knowPro/src/collections.ts` | 260 | this should be minHitCount > 1 | Low | High | Local | Fix | No |
| `ts/packages/knowPro/src/conversationIndex.ts` | 269 | update: pass in TextLocation instead of messageOrdinal + chunkOrdinal | Medium | Medium | Component | Fix | No |
| `ts/packages/knowPro/src/conversationIndex.ts` | 409 | Should rename this to TermToSemanticRefIndex | Low | High | Component | Fix | No |
| `ts/packages/knowPro/src/index.ts` | 23 | mergeConcreteEntitiesEx avoids forcing the data to be lower case. | Medium | Medium | Component | Fix | Yes |
| `ts/packages/knowPro/src/interfaces.ts` | 671 | Move to dataFormats.ts | Low | High | Component | Fix | No |
| `ts/packages/knowPro/src/query.ts` | 66 | also require secondary indices, once we have removed non-index based retrieval to test | Medium | Medium | Component | Fix | Yes |
| `ts/packages/knowPro/src/query.ts` | 464 | Make property and timestamp indexes NON-OPTIONAL | Medium | Medium | Component | Fix | No |
| `ts/packages/knowPro/src/query.ts` | 465 | Move non-index based code to test | Medium | Medium | Component | Fix | No |
| `ts/packages/knowPro/src/searchLang.ts` | 907 | move hardcoded to a user configurable table | Medium | Medium | Component | Fix | Yes |
| `ts/packages/knowPro/src/serialization.ts` | 225 | Remove this temporary backward compat. All future files should have proper headers | Low | High | Local | Fix | No |
| `ts/packages/knowProTest/src/searchTest.ts` | 46 | convert this to use runBatch from common.ts | Low | High | Local | Fix | No |
| `ts/packages/knowledgeProcessor/src/conversation/actions.ts` | 223 | parallelize | Medium | High | Local | Fix | No |
| `ts/packages/knowledgeProcessor/src/conversation/answerContext.ts` | 101 | split entities, topics, actions | Medium | Medium | Component | Fix | Yes |
| `ts/packages/knowledgeProcessor/src/conversation/conversation.ts` | 407 | Migrate to file system storage provider | High | Medium | Cross-cutting | Fix | Yes |
| `ts/packages/knowledgeProcessor/src/conversation/conversation.ts` | 411 | what about topics at other levels? | Medium | Low | Component | No Fix | Yes |
| `ts/packages/knowledgeProcessor/src/conversation/entities.ts` | 273 | parallelize | Medium | High | Local | Fix | No |
| `ts/packages/knowledgeProcessor/src/conversation/topics.ts` | 638 | use aliases here for better matching | Medium | Medium | Component | Fix | Yes |
| `ts/packages/knowledgeProcessor/src/conversation/topics.ts` | 683 | combine this and the one below | Low | High | Local | Fix | No |
| `ts/packages/knowledgeProcessor/src/images/image.ts` | 147 | add actions for all extracted entities being photographed/contained by image | Medium | Medium | Component | Fix | Yes |
| `ts/packages/knowledgeProcessor/src/images/image.ts` | 195 | logged in user for now? | Low | Low | Local | No Fix | Yes |
| `ts/packages/knowledgeProcessor/src/setOperations.ts` | 587 | Optimize. | Medium | Medium | Local | Fix | Yes |
| `ts/packages/knowledgeProcessor/src/setOperations.ts` | 606 | Optimize. | Medium | Medium | Local | Fix | No |
| `ts/packages/knowledgeProcessor/src/storageProvider.ts` | 131 | implement this once conversation is cleaned up and message Index is also backed by storageProvider | High | Low | Cross-cutting | No Fix | Yes |
| `ts/packages/knowledgeProcessor/src/temporal.ts` | 187 | cache the time range. | Low | High | Local | Fix | No |
| `ts/packages/knowledgeProcessor/src/textIndex.ts` | 80 | rename to addUpdate | Low | High | Component | Fix | No |
| `ts/packages/knowledgeProcessor/src/textIndex.ts` | 86 | rename to addUpdateMultiple | Low | High | Component | Fix | No |
| `ts/packages/knowledgeProcessor/src/textIndex.ts` | 92 | rename to addUpdateSources | Low | High | Component | Fix | No |
| `ts/packages/knowledgeProcessor/src/textIndex.ts` | 323 | parallelize | Medium | Medium | Local | Fix | No |
| `ts/packages/knowledgeProcessor/test/searchProcessor.spec.ts` | 17 | this test is not enabled on all dev machines yet. Currently requires some private datasets and indexes | High | Low | Component | No Fix | Yes |
| `ts/packages/knowledgeVisualizer/src/route/visualizationNotifier.ts` | 433 | enumerate facets | Medium | Medium | Local | Fix | Yes |
| `ts/packages/memory/conversation/src/conversationMemory.ts` | 310 | Optionally, back up previous file and do a safe read write | Low | High | Local | Fix | No |
| `ts/packages/memory/conversation/src/memory.ts` | 224 | using mergeConcreteEntitiesEx to avoid forcing the data to be lower case. | Low | Medium | Local | No Fix | Yes |
| `ts/packages/memory/conversation/src/podcastMessage.ts` | 56 | Also create inverse actions | Medium | Medium | Component | Fix | No |
| `ts/packages/memory/image/src/imageCollection.ts` | 78 | select other Facets/meta data fields | Medium | Medium | Component | Fix | Yes |
| `ts/packages/memory/image/src/imageCollection.ts` | 79 | put everything in a single table? | High | Medium | Component | No Fix | Yes |
| `ts/packages/memory/image/src/imageCollection.ts` | 133 | add additional meta data tables | Medium | Medium | Component | Fix | Yes |
| `ts/packages/memory/image/src/imageMeta.ts` | 151 | image taker name | Low | High | Local | Fix | No |
| `ts/packages/memory/image/src/imageMeta.ts` | 356 | Ensure localization | Medium | Medium | Local | Fix | No |
| `ts/packages/memory/image/src/indexingService.ts` | 5 | add support for "monitoring" the indexed folder for changes | High | Medium | Component | Fix | No |
| `ts/packages/memory/image/src/indexingService.ts` | 23 | add token stats | Low | High | Local | Fix | No |
| `ts/packages/memory/image/src/indexingService.ts` | 132 | make this less chatty - maybe percentage based or something? | Low | High | Local | Fix | No |
| `ts/packages/memory/storage/src/azSearch/azQuery.ts` | 90 | handle related terms | Medium | Medium | Component | Fix | No |
| `ts/packages/memory/website/src/websiteCollection.ts` | 2646 | If we have access to Graphology graphs, compute more advanced metrics | High | Low | Component | No Fix | Yes |
| `ts/packages/memory/website/src/websiteCollection.ts` | 2709 | In a full implementation, this would: | High | Low | Component | No Fix | Yes |
| `ts/packages/shell/src/main/index.ts` | 143 | connected mode only needs the speech key. | Low | Medium | Component | Fix | Yes |
| `ts/packages/shell/src/main/shellWindow.ts` | 1260 | add logic for opening in external browser if a modifier key is pressed | Low | High | Local | Fix | No |
| `ts/packages/shell/src/renderer/src/main.ts` | 128 | wire up any other functionality (player agent?) | High | Low | Cross-cutting | No Fix | Yes |
| `ts/packages/shell/src/renderer/src/main.ts` | 196 | append data instead of replace | Low | High | Local | Fix | No |
| `ts/packages/shell/src/renderer/src/main.ts` | 311 | Design for toast notifications in shell | Medium | Medium | Component | Fix | Yes |
| `ts/packages/shell/src/renderer/src/messageContainer.ts` | 506 | Adjust this value. | Low | High | Local | Fix | Yes |
| `ts/packages/shell/src/renderer/src/webSocketAPI.ts` | 128 | Not implemented yet. | Medium | Medium | Component | Fix | Yes |
| `ts/packages/shell/src/renderer/src/webSocketAPI.ts` | 137 | Not implemented yet. | Medium | Medium | Component | Fix | Yes |
| `ts/packages/shell/test/configCommands.spec.ts` | 87 | Test action correction | Medium | Medium | Component | Fix | Yes |
| `ts/packages/shell/test/sessionCommands.spec.ts` | 194 | Test action correction | Medium | Medium | Component | Fix | Yes |
| `ts/packages/shell/test/testHelper.ts` | 236 | fix completion to not need this workaround | Medium | Medium | Local | Fix | No |
| `ts/packages/telemetry/src/logger/cosmosDBLoggerSink.ts` | 55 | add backoff/queuing logic for ENOTFOUND (no internet) | Medium | High | Local | Fix | No |
| `ts/packages/telemetry/src/logger/mongoLoggerSink.ts` | 41 | add backoff/queuing logic for ENOTFOUND (no internet) | Medium | High | Local | Fix | No |
| `ts/packages/typeagent/src/storage/embeddingFS.ts` | 158 | parallelize | Low | High | Local | Fix | No |
| `ts/packages/typeagent/src/vector/vectorIndex.ts` | 176 | batch operations | Medium | High | Local | Fix | No |
| `ts/packages/utils/typechatUtils/src/location.ts` | 138 | update any once @azure-rest/maps-search incorporates V1 return types | Low | Low | Local | No Fix | Yes |
| `ts/packages/utils/typechatUtils/src/location.ts` | 154 | handle more result types | Medium | Medium | Local | Fix | Yes |
| `ts/packages/utils/typechatUtils/src/location.ts` | 159 | if there are no POI, can we just send back the address? | Low | Medium | Local | Fix | Yes |
| `ts/packages/utils/typechatUtils/src/location.ts` | 201 | update any once @azure-rest/maps-search incorporates V1 return types | Low | Low | Local | No Fix | Yes |

