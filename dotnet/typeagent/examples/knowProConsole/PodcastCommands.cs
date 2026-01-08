// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Threading.Tasks;
using TypeAgent.ConversationMemory;
using TypeAgent.KnowPro;
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
            PodcastImportIndexDef(),
            PodcastBuildIndexDef(),
            PocastBulkImportDef(),
            PodcastUnloadDef()
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

    private Command PodcastUnloadDef()
    {
        Command cmd = new("kpPodcastUnload", "Unload the current podcast")
        {
        };
        string name = _podcast is not null ? _podcast.Name : string.Empty;
        cmd.SetAction((ParseResult _) => UnloadCurrent());

        if (string.IsNullOrEmpty(name))
        {
            KnowProWriter.WriteLine(ConsoleColor.Red, $"No podcast loaded.");
        }
        else
        {
            KnowProWriter.WriteLine(ConsoleColor.Yellow, $"Unloaded podcast '{name}'");
        }

        return cmd;
    }

    private Command PocastBulkImportDef()
    {
        Command cmd = new("kpPodcastBulkImport", "Index and import multipe podcasts from a folder")
        {
            Args.Arg<string>("dir", "The folder from which to import all podcasts (local files only, not recursive)"),
            Options.Arg<bool>("buildIndex", "Also build index", true)
        };
        cmd.SetAction(this.PodcastBulkImportAsync);
        return cmd;
    }

    private async Task<Task> PodcastBulkImportAsync(ParseResult args)
    {
        NamedArgs namedArgs = new(args);
        string path = namedArgs.GetRequired("path");
        var files = Directory.GetFiles(path, "*.txt");

        foreach (var file in files)
        {
            string ext = Path.GetExtension(file);
            string podcastName = Path.GetFileNameWithoutExtension(file);
            KnowProWriter.WriteLine(ConsoleColor.Yellow, $"Importing {podcastName} from {file}");
            if (ext.Equals("json", StringComparison.OrdinalIgnoreCase))
            {
                await ImportExistingIndexAsync(namedArgs, file, podcastName, CancellationToken.None);
            }
            else
            {
                await ImportTranscriptAsync(namedArgs, file, podcastName, CancellationToken.None);
            }
        }
        return Task.CompletedTask;
    }

    private Command PodcastLoadDef()
    {
        Command cmd = new("kpPodcastLoad", "Load existing podcast index")
        {
            Args.Arg<string>("name", "Name of existing podcast index"),
        };
        cmd.SetAction(this.PodcastLoadAsync);
        return cmd;
    }

    private async Task<Task> PodcastLoadAsync(ParseResult args)
    {
        NamedArgs namedArgs = new(args);
        string name = namedArgs.GetRequired("name");

        UnloadCurrent();

        _kpContext.Stopwatch.Restart();

        var podcast = CreatePodcast(name, false);

        _kpContext.Stopwatch.Stop();

        KnowProWriter.WriteTiming(_kpContext.Stopwatch, "Load podcast");

        SetCurrent(podcast);
        KnowProWriter.Write(ConsoleColor.White, "Loaded ");
        KnowProWriter.Write(ConsoleColor.Cyan, $"{name} ");
        KnowProWriter.WriteLine(ConsoleColor.DarkGray, $"[{await podcast.Messages.GetCountAsync()} messages]");

        var timeRange = await podcast.GetStartTimestampRangeAsync().ConfigureAwait(false);
        if (timeRange is not null)
        {
            KnowProWriter.WriteLine(ConsoleColor.White, $"Time Range: Started: {timeRange.Value.StartTimestamp}\nEnded: {timeRange.Value.EndTimestamp}");
        }

        var participants = await podcast.GetParticipantsAsync().ConfigureAwait(false);
        if (participants is not null)
        {
            KnowProWriter.WriteLine(ConsoleColor.White, $"Participants: {string.Join(", ", participants)}");
        }

        return Task.CompletedTask;
    }

    private Command PodcastImportIndexDef()
    {
        Command cmd = new("kpPodcastImport", "Import a podcast transcript as Podcast memory")
        {
            Args.Arg<string>("filePath", "Path to existing podcast index"),
            Options.Arg<string>("startAt", "ISO date: When the podcast occurred"),
            Options.Arg<int?>("length", "In minutes", null),
            Options.Arg<bool>("buildIndex", "Also build index", true)
        };
        cmd.SetAction(this.PodcastImportIndexAsync);
        return cmd;
    }

    private async Task PodcastImportIndexAsync(ParseResult args, CancellationToken cancellationToken)
    {
        NamedArgs namedArgs = new(args);
        string? filePath = namedArgs.Get("filePath");
        if (string.IsNullOrEmpty(filePath))
        {
            return;
        }
        string ext = Path.GetExtension(filePath);
        string podcastName = Path.GetFileNameWithoutExtension(filePath);
        if (ext.Equals("json", StringComparison.OrdinalIgnoreCase))
        {
            await ImportExistingIndexAsync(namedArgs, filePath, podcastName, cancellationToken);
        }
        else
        {
            await ImportTranscriptAsync(namedArgs, filePath, podcastName, cancellationToken);
        }
    }

    private async Task ImportTranscriptAsync(NamedArgs namedArgs, string filePath, string podcastName, CancellationToken cancellationToken)
    {
        UnloadCurrent();
        Podcast podcast = CreatePodcast(podcastName, true);
        SetCurrent(podcast);

        string? startAt = namedArgs.Get<string>("startAt");
        DateTimeOffset? startDate = !string.IsNullOrEmpty(startAt) ? DateTimeOffset.Parse(startAt) : null;

        await podcast.ImportTranscriptAsync(
            filePath,
            podcastName,
            startDate,
            namedArgs.Get<int?>("length")
        );

        KnowProWriter.WriteLine($"{podcast.Name}");
        KnowProWriter.WriteLine($"{await podcast.Messages.GetCountAsync(cancellationToken)} messages.");
        KnowProWriter.WriteLine($"Participants: {(await podcast.GetParticipantsAsync()).Join(", ")}");

        if (namedArgs.Get<bool>("buildIndex"))
        {
            KnowProWriter.WriteLine("Building Index...");
            await podcast.BuildIndexAsync(cancellationToken);
        }
    }

    private Command PodcastBuildIndexDef()
    {
        Command cmd = new("kpPodcastBuildIndex", "Build the index for the loaded podcast.")
        {
        };
        cmd.SetAction(this.PodcastBuildIndexAsync);
        return cmd;
    }

    private async Task PodcastBuildIndexAsync(ParseResult args, CancellationToken cancellationToken)
    {
        if (this._podcast is null)
        {
            KnowProWriter.WriteError("NO podcast loaded.");
            return;
        }

        await this._podcast.BuildIndexAsync(cancellationToken);
    }

    private async Task ImportExistingIndexAsync(NamedArgs namedArgs, string filePath, string podcastName, CancellationToken cancellationToken)
    {
        var data = ConversationJsonSerializer.ReadFromFile<PodcastMessage>(filePath!);
        if (data is null)
        {
            KnowProWriter.WriteError("NO data in file");
            return;
        }
        KnowProWriter.WriteDataFileStats(data);

        UnloadCurrent();

        KnowProWriter.WriteLine(ConsoleColor.Cyan, $"Importing {podcastName}");
        var podcast = CreatePodcast(podcastName, true);
        SetCurrent(podcast);
        try
        {
            int count = await podcast.ImportMessagesAsync(data.Messages, cancellationToken);
            KnowProWriter.WriteLine($"{count} message imported");

            KnowProWriter.WriteLine($"{data.SemanticRefs.Length} semantic refs");
            count = await podcast.ImportSemanticRefsAsync(data.SemanticRefs, cancellationToken);
            KnowProWriter.WriteLine($"{count} semantic Refs imported");

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

            await podcast.UpdateMessageIndexAsync(false, cancellationToken);
            await podcast.BuildSecondaryIndexesAsync(cancellationToken);            
        }
        catch
        {
            podcast.Dispose();
            throw;
        }
    }

    private Podcast CreatePodcast(string name, bool createNew)
    {
        MemorySettings settings = new MemorySettings();
        var provider = _kpContext.CreateStorageProvider<PodcastMessage, PodcastMessageMeta>(
            settings.ConversationSettings,
            name,
            createNew
        );

        var podcast = new Podcast(settings, provider);
        podcast.Name = name;
        return podcast;
    }

    private void UnloadCurrent()
    {
        _kpContext.UnloadCurrent();
        if (_podcast is not null)
        {
            _podcast.Dispose();
            _podcast = null;
        }
    }

    private void SetCurrent(Podcast? podcast)
    {
        UnloadCurrent();
        if (podcast is not null)
        {
            _podcast = podcast;
            _kpContext.SetCurrent(podcast);
        }
    }
}
