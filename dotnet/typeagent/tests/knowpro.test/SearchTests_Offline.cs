// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.ComponentModel.Design;
using System.Linq;
using System.Reflection;
using System.Runtime.Intrinsics.X86;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using TypeAgent.ConversationMemory;
using TypeAgent.KnowPro;
using TypeAgent.KnowPro.Storage.Sqlite;
using TypeAgent.Vector;
using static System.Runtime.InteropServices.JavaScript.JSType;

namespace TypeAgent.Tests.KnowPro;

/// <summary>
/// These tests are designed to run offline.
/// They ONLY use terms for which we already have embeddings in the test data conversation index
/// This allows us to run fuzzy matching entirely offline
/// </summary>
public class SearchTests_Offline : TestWithTemporaryFiles, IDisposable
{
    SqliteStorageProvider<PodcastMessage, PodcastMessageMeta> _sqliteDB;
    Podcast _podcast;
    private bool _disposedValue;

    /// <summary>
    /// Create temporary folder but don't load .ENV file
    /// </summary>
    public SearchTests_Offline() : base(true)
    {
        // Load the test conversation database
        this._sqliteDB = new SqliteStorageProvider<PodcastMessage, PodcastMessageMeta>(new ConversationSettings(), Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)!, "episode_53_adriantchaikovsky", false);
        this._podcast = new Podcast(new MemorySettings(), this._sqliteDB);
    }

    [Fact]
    public async Task TestLookupAsync()
    {
        var results = await _podcast.SemanticRefIndex.LookupTermAsync("book");

        Assert.NotNull(results);
        Assert.True(results.Count > 0);
    }

    [SkippableFact]
    public async Task TestSearchKnowledge_And()
    {
        //test(
        //    "searchKnowledge.and",
        //    async () => {
        //        let termGroup = createAndTermGroup(
        //            createSearchTerm("book"),
        //            createSearchTerm("movie"),

        //        );
        //        let matches = await runSearchKnowledge(termGroup, "entity");
        //        if (matches)
        //        {
        //            const semanticRefs = resolveAndVerifySemanticRefs(
        //                conversation,
        //                matches,

        //            );
        //            expectHasEntities(semanticRefs, "Starship Troopers");
        //            expectDoesNotHaveEntities(semanticRefs, "Children of Time");
        //        }
        //        termGroup = createAndTermGroup(
        //            createSearchTerm("book"),
        //            createSearchTerm("spider"),

        //        );
        //        matches = await runSearchKnowledge(termGroup, "entity", false);
        //    },
        //    testTimeout,

        //);

        var termGroup = new SearchTermGroup(SearchTermBooleanOp.And, [new SearchTerm("book"), new SearchTerm("movie")]);
        SearchKnowledgeAsync(termGroup, KnowledgeType.Entity);

    }

    private async void SearchKnowledgeAsync(SearchTermGroup searchTermGroup, KnowledgeType knowledgeType, bool expectMatches = true)
    {
        var select = new SearchSelectExpr(searchTermGroup);
        var matches = await this._podcast.SearchKnowledgeAsync(select, null, new CancellationToken());

        if (expectMatches)
        {
            Assert.NotNull(matches);
            Assert.True(matches.Count > 0);
        }

    //    async function runSearchKnowledge(
    //        termGroup: SearchTermGroup,
    //    knowledgeType: KnowledgeType,
    //    expectMatches: boolean = true,
    //): Promise < SemanticRefSearchResult | undefined > {
    //        const matches = await searchConversationKnowledge(
    //            conversation,
    //            termGroup,
    //        { knowledgeType },
    //        createSearchOptions(),
    //    );
    //        if (expectMatches)
    //        {
    //            expect(matches).toBeDefined();
    //            if (matches)
    //            {
    //                expect(matches.size).toEqual(1);
    //                const entities = matches.get(knowledgeType);
    //                verifySemanticRefResult(entities);
    //                return entities;
    //            }
    //        }
    //        else
    //        {
    //            if (matches)
    //            {
    //                expect(matches.size).toEqual(0);
    //            }
    //        }
    //        return undefined;
    //    }
    //});
    }

    #region IDisposable
    protected virtual void Dispose(bool disposing)
    {
        if (!_disposedValue)
        {
            if (disposing)
            {
                this._sqliteDB.Dispose();
            }

            _disposedValue = true;
        }
    }

    public void Dispose()
    {
        // Do not change this code. Put cleanup code in 'Dispose(bool disposing)' method
        Dispose(disposing: true);
        GC.SuppressFinalize(this);
    }
    #endregion IDisposable
}
