// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Storage;

namespace KnowProConsole;

public class PodcastCommands : ICommandModule
{
    KnowProConsoleContext _kpContext;
    Podcast? _podcast; // Currently loaded podcast, if any

    public PodcastCommands(KnowProConsoleContext context)
    {
        _kpContext = context;
    }

    public IList<Command> GetCommands()
    {
        return [
            PodcastLoadDef(),
            PodcastImportIndexDef()
        ];
    }

    private Command TestDef()
    {
        Command cmd = new("test")
        {
            Args.Arg<string>("name", "Name"),
        };
        cmd.TreatUnmatchedTokensAsErrors = false;
        cmd.SetAction(Test);
        return cmd;
    }

    private void Test(ParseResult args)
    {
        foreach (var token in args.UnmatchedTokens)
        {
            Console.WriteLine(token);
        }
    }

    private Command PodcastLoadDef()
    {
        Command cmd = new("kpPodcastLoad", "Load existing podcast index")
        {
            Args.Arg<string>("name", "Name of existing podcast index"),
        };
        cmd.SetAction(this.PodcastLoad);
        return cmd;
    }

    private void PodcastLoad(ParseResult args)
    {
        NamedArgs namedArgs = new(args);
        string name = namedArgs.GetRequired("name");

        UnloadCurrent();

        _kpContext.Stopwatch.Restart();

        var podcast = new Podcast(CreateStorageProvider(name, false));
        _kpContext.Stopwatch.Stop();
        KnowProWriter.WriteTiming(_kpContext.Stopwatch);

        SetCurrent(podcast);
        KnowProWriter.WriteLine(ConsoleColor.Cyan, $"Loaded {name}");
    }

    private Command PodcastImportIndexDef()
    {
        Command cmd = new("kpPodcastImportIndex", "Import existing podcast memory index")
        {
            Args.Arg<string>("filePath", "Path to existing podcast index"),
        };
        cmd.SetAction(this.PodcastImportIndexAsync);
        return cmd;
    }

    private async Task PodcastImportIndexAsync(ParseResult args, CancellationToken cancellationToken)
    {
        NamedArgs namedArgs = new(args);
        string? filePath = namedArgs.Get("filePath");
        var data = ConversationJsonSerializer.ReadFromFile<PodcastMessage>(filePath!);
        if (data is null)
        {
            KnowProWriter.WriteError("NO data in file");
            return;
        }
        KnowProWriter.WriteDataFileStats(data);

        UnloadCurrent();

        string? podcastName = Path.GetFileNameWithoutExtension(filePath) ?? throw new NotSupportedException();
        KnowProWriter.WriteLine(ConsoleColor.Cyan, $"Importing {podcastName}");
        var podcast = new Podcast(
            CreateStorageProvider(podcastName, true)
        );
        try
        {
            int count = await podcast.ImportMessagesAsync(data.Messages, cancellationToken);
            KnowProWriter.WriteLine($"{count} message imported");

            KnowProWriter.WriteLine($"{data.SemanticRefs.Length} semantic refs");
            count = await podcast.ImportSemanticRefsAsync(data.SemanticRefs, cancellationToken);
            KnowProWriter.WriteLine($"{count    } semantic Refs imported");

            IList<ScoredSemanticRefOrdinal>? matches;
            if (data.SemanticIndexData is not null)
            {
                await podcast.ImportTermToSemanticRefIndexAsync(data.SemanticIndexData.Items, cancellationToken);
                count = await podcast.SemanticRefIndex.GetCountAsync(cancellationToken);
                KnowProWriter.WriteLine($"{count} index entries imported");

                matches = await podcast.SemanticRefIndex.LookupTermAsync("Children of Time", cancellationToken);
                KnowProWriter.WriteLine($"{matches?.Count ?? 0} matches");
            }

            count = await podcast.ImportPropertyIndexAsync(data.SemanticRefs, cancellationToken);
            KnowProWriter.WriteLine($"{count} properties imported");

            SetCurrent(podcast);
        }
        catch
        {
            podcast.Dispose();
            throw;
        }
        /*
        var messages = await podcast.Messages.GetAsync([1, 2, 3, 4], cancellationToken);
        KnowProWriter.WriteJson(messages);

        await KnowProWriter.WriteSemanticRefsAsync(podcast);

        IList<ScoredSemanticRefOrdinal>? matches;
        if (data.SemanticIndexData is not null)
        {
            await podcast.ImportTermToSemanticRefIndexAsync(data.SemanticIndexData.Items, cancellationToken);
            count = await podcast.SemanticRefIndex.GetCountAsync(cancellationToken);
            KnowProWriter.WriteLine($"{count} index entries imported");

            matches = await podcast.SemanticRefIndex.LookupTermAsync("Children of Time", cancellationToken);
            KnowProWriter.WriteLine($"{matches?.Count ?? 0} matches");
        }

        count = await podcast.ImportPropertyIndexAsync(data.SemanticRefs, cancellationToken);
        KnowProWriter.WriteLine($"{count} properties imported");
        matches = await podcast.SecondaryIndexes.PropertyToSemanticRefIndex.LookupPropertyAsync(
            KnowledgePropertyName.EntityName,
            "Children of Time",
            cancellationToken
        );
        KnowProWriter.WriteLine($"{matches.Count} matches");
        */
    }

    private SqliteStorageProvider<PodcastMessage, PodcastMessageMeta> CreateStorageProvider(
        string name,
        bool createNew
    )
    {
        return new SqliteStorageProvider<PodcastMessage, PodcastMessageMeta>(
            new ConversationSettings(
                new TextEmbeddingModel(AzureModelApiSettings.EmbeddingSettingsFromEnv())
            ),
            _kpContext.DotnetPath,
            name,
            createNew
        );
    }

    private void UnloadCurrent()
    {
        _podcast?.Dispose();
        _podcast = null;
        _kpContext.Conversation = null;
    }

    private void SetCurrent(Podcast? podcast)
    {
        UnloadCurrent();
        if (podcast is not null)
        {
            _podcast = podcast;
            _kpContext.Conversation = podcast;
        }
    }
}
