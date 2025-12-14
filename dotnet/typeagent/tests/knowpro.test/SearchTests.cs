// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections;
using System.Collections.Generic;
using System.CommandLine;
using System.ComponentModel.Design;
using System.Linq;
using System.Reflection;
using System.Runtime.Intrinsics.X86;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using KnowProConsole;
using TypeAgent.AIClient;
using TypeAgent.ConversationMemory;
using TypeAgent.ExamplesLib.CommandLine;
using TypeAgent.KnowPro;
using TypeAgent.KnowPro.Answer;
using TypeAgent.KnowPro.Lang;
using TypeAgent.KnowPro.Query;
using TypeAgent.KnowPro.Storage.Sqlite;
using TypeAgent.Vector;
using static System.Runtime.InteropServices.JavaScript.JSType;

namespace TypeAgent.Tests.KnowPro;

public class SearchTests : TestWithData
{
    private bool _disposedValue;

    /// <summary>
    /// Create temporary folder but and load .ENV file
    /// </summary>
    public SearchTests() : base(true, true)
    {
    }

    [Fact]
    public async Task TestLookupAsync()
    {
        var results = await _podcast.SemanticRefIndex.LookupTermAsync("book");

        Assert.NotNull(results);
        Assert.True(results.Count > 0);
    }

    [Fact]
    public async Task TestSearchKnowledge_AndAsync()
    {
        var termGroup = new SearchTermGroup(SearchTermBooleanOp.And, [new SearchTerm("book"), new SearchTerm("movie")]);
        var matches = await SearchKnowledgeAsync(this._podcast, termGroup, KnowledgeType.Entity, true, 3, 2);

        Assert.True(await matches.HasEntityMatchesWithNameAsync("The Circle", this._podcast.SemanticRefs));

        var noResultsTermGroup = new SearchTermGroup(SearchTermBooleanOp.And, [new SearchTerm("book"), new SearchTerm("spider")]);
        await SearchKnowledgeAsync(this._podcast, noResultsTermGroup, KnowledgeType.Entity, false);
    }

    [Fact]
    public async Task TestSearchKnowledge_AndOrAsync()
    {
        var orGroup = new SearchTermGroup(SearchTermBooleanOp.Or, new SearchTerm("Children of Time"), new SearchTerm("The Circle"));
        var andOrGroup = new SearchTermGroup(SearchTermBooleanOp.And, orGroup, new SearchTerm("movie", true));

        var matches = await SearchKnowledgeAsync(this._podcast, andOrGroup, KnowledgeType.Entity, true);

        var entities = await matches.GetEntitiesAsync(this._podcast.SemanticRefs);

        Assert.Single(matches[KnowledgeType.Entity].SemanticRefMatches);
        Assert.Single(entities);
        Assert.True(await matches.HasEntityMatchesWithNameAsync("The Circle", this._podcast.SemanticRefs));
        Assert.False(await matches.HasEntityMatchesWithNameAsync("Children of Time", this._podcast.SemanticRefs));
    }

    [Fact]
    public async Task TestSearchKnowledge_OrAsync()
    {
        var orGroup = new SearchTermGroup(SearchTermBooleanOp.Or, new SearchTerm("book"), new SearchTerm("movie"), new SearchTerm("spider"));

        var matches = await SearchKnowledgeAsync(this._podcast, orGroup, KnowledgeType.Entity, true);

        Assert.True(await matches.HasEntitiesAsync(["The Circle", "Children of Time", "spider", "spiders", "Portids"], this._podcast.SemanticRefs));
    }

    [Fact]
    public async Task TestSearchAsync_OrMaxAsync()
    {
        // OrMax
        SearchTermGroup stg = new SearchTermGroup(SearchTermBooleanOp.OrMax, [new SearchTerm("person"), new SearchTerm("spider")]);
        var results = await this._podcast!.SearchAsync(new SearchSelectExpr(stg), null, null);
        Assert.NotNull(results);
        Assert.True(results.HasResults);
        Assert.True(results.KnowledgeMatches.Count > 0);
        Assert.True(results.MessageMatches.Count > 0);
    }

    [Fact]
    public async Task TestSearchAsync()
    {
        SearchTermGroup stg = new SearchTermGroup(SearchTermBooleanOp.Or, [new SearchTerm("57862")]);

        LangSearchOptions options = new LangSearchOptions()
        {

        };

        LangSearchFilter filter = new LangSearchFilter()
        {

        };

        LangSearchDebugContext context = new LangSearchDebugContext()
        {

        };

        // search with results
        var results = await this._podcast!.SearchAsync("book", options, filter, context, CancellationToken.None);
        Assert.NotNull(results);
        Assert.True(results.Count > 0);
        Assert.True(results.First().HasResults);
        Assert.True(results.First().KnowledgeMatches.Count > 0);
        Assert.True(results.First().MessageMatches.Count > 0);

        // search with no result (uses fallback query)
        results = await this._podcast!.SearchAsync("aslifjsdflksdfjsdl", options, filter, context, CancellationToken.None);
        Assert.NotNull(results);
        Assert.Single(results);
        Assert.False(results.First().HasResults);
        Assert.Empty(results.First().KnowledgeMatches);
        Assert.Empty(results.First().MessageMatches);
    }

    [Fact]
    public void CompileWhenTest()
    {
        LangSearchOptions options = new LangSearchOptions()
        {
            CompilerSettings = new()
            {
                ExactScope = true
            }
        };

        LangSearchFilter filter = new LangSearchFilter()
        {
            KnowledgeType = KnowledgeType.Action,
            ScopeDefiningTerms = new SearchTermGroup(SearchTermBooleanOp.And, [new SearchTerm("created"), new SearchTerm("published")]),
            Tags = ["t1", "t2"],
            ThreadDescription = "Adrian"
        };

        SearchQueryCompiler sqc = new SearchQueryCompiler(this._podcast!, options, filter);
        SearchExpr searchExpr = new SearchExpr()
        {
            Filters = [
                new SearchFilter()
                {
                    ActionSearchTerm = new ActionTerm()
                    {
                         ActionVerbs = new VerbsTerm()
                         {
                             Words = ["created", "published"],
                             Tense = VerbsTermTense.Past
                         },
                         AdditionalEntities = [
                             new EntityTerm()
                             {
                                  Type = ["tag"],
                                  Name = "t1"
                             }
                         ]
                    },
                    EntitySearchTerms = [
                        new EntityTerm()
                        {
                             Name = "Adrian"
                        }
                    ],
                    TimeRange = new DateTimeRange()
                    {
                         StartDate = new TypeAgent.KnowPro.DateTime()
                         {
                            Date = new DateVal()
                            {
                                 Day = 1,
                                 Month = 1,
                                 Year = 2000
                            }
                         },
                         StopDate = new TypeAgent.KnowPro.DateTime()
                         {
                            Date = new DateVal()
                            {
                                 Day = 31,
                                 Month = 12,
                                 Year = 2025
                            }
                         }
                    }
                }
            ]
        };

        var query = sqc.CompileSearchExpr(searchExpr);

        Assert.Single(query.SelectExpressions);
        Assert.NotNull(query.SelectExpressions.First().When);
    }

    [Fact(Timeout = 60000)]
    public async Task SearchQueriesAsync()
    {
        List<string> testQueries = QueryUtils.LoadTestQueries("../../../../../../../ts/packages/knowPro/test/data/Episode_53_query.txt");

        IChatModel model = ModelUtils.CreateTestChatModel(nameof(SearchQueriesAsync));

        // simulate console commands
        RootCommand cmds = [];
        TestCommands testCmds = new TestCommands(new KnowProConsoleContext());
        cmds.AddModule(new PodcastCommands(new KnowProConsoleContext()));
        cmds.AddModule(new MemoryCommands(new KnowProConsoleContext()));
        cmds.AddModule(testCmds);

        foreach (string query in testQueries)
        {
            var space = query.IndexOf(' ');
            var cmdLine = new string[] { "kpTestSearchTerms", query[..space], query[space..] };

            var parseResult = cmds.Parse(cmdLine);

            var results = await this._podcast!.SearchKnowledgeAsync(
                TestCommands.SearchSeletExpressionFromCommandArgs(parseResult, await this._podcast!.GetStartTimestampRangeAsync()),
                null,
                CancellationToken.None
            );

            Assert.NotNull(results);
            Assert.True(results.Count > 0);
        }
    }

    internal static async Task<IDictionary<KnowledgeType, SemanticRefSearchResult>> SearchKnowledgeAsync(IConversation? conversation, SearchTermGroup searchTermGroup, KnowledgeType knowledgeType, bool expectMatches, int? semanticRefMatches = null, int? termMatches = null)
    {
        ArgumentVerify.ThrowIfNull(conversation, nameof(conversation));

        var select = new SearchSelectExpr(searchTermGroup);
        var matches = await conversation.SearchKnowledgeAsync(select, null, new CancellationToken());

        if (expectMatches)
        {
            Assert.NotNull(matches);
            Assert.True(matches.Count >= 0);

            Assert.True(semanticRefMatches is null || matches[knowledgeType].SemanticRefMatches.Count == semanticRefMatches);
            Assert.True(termMatches is null || matches[knowledgeType].TermMatches.Count == termMatches);
        }

        return matches!;
    }
}
