// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Threading;
using System.Threading.Tasks;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using TypeAgent.Common;
using TypeAgent.ConversationMemory;
using TypeAgent.KnowPro.Storage.Sqlite;
using Xunit.Sdk;
using Xunit;
using TypeAgent.KnowPro;

namespace TypeAgent.Tests.ConversationMemory;

public class PodcastTests
{
    DirectoryInfo _tempDir;
    private bool _disposedValue;

    /// <summary>
    /// Test setup including loading .ENV settings and creating temporary folder for sqlite DB
    /// </summary>
    public PodcastTests()
    {
        _tempDir = Directory.CreateTempSubdirectory();

        if (Dotenv.LoadIfExists(Dotenv.DEFAULT_DOT_ENV_LOCATION) == 0)
        {
            throw new Xunit.Sdk.SkipException();
        }
    }

    /// <summary>
    /// Cleans up test data
    /// </summary>
    ~PodcastTests()
    {
        Directory.Delete(_tempDir.FullName, true);
    }

    private class TestTranscriptInfo
    {
        public string filePath { get; set; } = string.Empty;
        public string name { get; set; } = string.Empty;
        public System.DateTime date { get; set; } = System.DateTime.Now;
        public uint length { get; set; } = 0;
        public uint? participantCount { get; set; } = null;
        public uint? messageCount { get; set; } = null;
    }

    private static TestTranscriptInfo GetTransscriptSmall()
    {
        return new TestTranscriptInfo()
        {
            filePath = "../../../../../../../ts/packages/memory/conversation/test/data/transcript_small.txt",
            name = "Test",
            date = System.DateTime.Parse("March 2024"),
            length = 15,
            messageCount = 7,
            participantCount = 5,
        };
    }


    [Fact]
    public async Task BuildIndexAsync()
    {
        Podcast podcast = await LoadTestPodcastAsync(GetTransscriptSmall(), true);

        Assert.Equal(7, await podcast.Messages.GetCountAsync());

        await podcast.BuildIndexAsync(CancellationToken.None);

        await podcast.BuildSecondaryIndexesAsync(CancellationToken.None);

        List<string> participants = [.. await podcast.GetParticipantsAsync()];
        participants.Sort();

        Assert.Equal(["hamlet", "lady bracknell", "macbeth", "richard", "sherlock holmes"], participants);

        var terms = await podcast.SemanticRefIndex.LookupTermAsync("misfortune");
        Assert.True(terms?.Count > 0);
    }

    private async Task<Podcast> LoadTestPodcastAsync(TestTranscriptInfo podcastDetails, bool online)
    {
        var provider = new SqliteStorageProvider<PodcastMessage, PodcastMessageMeta>(new KnowPro.ConversationSettings(), _tempDir.FullName, nameof(this.LoadTestPodcastAsync), true);

        Podcast podcast = new Podcast(new MemorySettings(), provider);

        await podcast.ImportTranscriptAsync(
            podcastDetails.filePath,
            podcastDetails.name,
            podcastDetails.date,
            (int?)podcastDetails.length
        );

        await podcast.BuildIndexAsync(CancellationToken.None);

        return podcast;
    }
}
