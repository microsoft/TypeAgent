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
        var matches = await SearchKnowledgeAsync(termGroup, KnowledgeType.Entity, true, 3, 2);

        Assert.True(await matches.HasEntityMatchesWithNameAsync("The Circle", this._podcast.SemanticRefs));

        var noResultsTermGroup = new SearchTermGroup(SearchTermBooleanOp.And, [new SearchTerm("book"), new SearchTerm("spider")]);
        await SearchKnowledgeAsync(noResultsTermGroup, KnowledgeType.Entity, false);
    }

    [Fact]
    public async Task TestSearchKnowledge_AndOrAsync()
    {
        var orGroup = new SearchTermGroup(SearchTermBooleanOp.Or, new SearchTerm("Children of Time"), new SearchTerm("The Circle"));
        var andOrGroup = new SearchTermGroup(SearchTermBooleanOp.And, orGroup, new SearchTerm("movie", true));

        var matches = await SearchKnowledgeAsync(andOrGroup, KnowledgeType.Entity, true);

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

        var matches = await SearchKnowledgeAsync(orGroup, KnowledgeType.Entity, true);

        Assert.True(await matches.HasEntitiesAsync(["The Circle", "Children of Time", "spider", "spiders", "Portids"], this._podcast.SemanticRefs));
    }

    [Fact]
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

            SearchTermGroup stg = new SearchTermGroup(SearchTermBooleanOp.Or);

            // TODO: finish validating results

            var results = await this._podcast!.SearchKnowledgeAsync(
                new SearchSelectExpr(stg),
                null,
                CancellationToken.None
            );
        }
    }

    private async Task<IDictionary<KnowledgeType, SemanticRefSearchResult>> SearchKnowledgeAsync(SearchTermGroup searchTermGroup, KnowledgeType knowledgeType, bool expectMatches, int? semanticRefMatches = null, int? termMatches = null)
    {
        var select = new SearchSelectExpr(searchTermGroup);
        var matches = await this._podcast.SearchKnowledgeAsync(select, null, new CancellationToken());

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
