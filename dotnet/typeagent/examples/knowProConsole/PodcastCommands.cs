// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Storage;

namespace KnowProConsole;

public class PodcastCommands : ICommandModule
{
    KnowProConsoleContext _kpContext;

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

    private Command PodcastLoadDef()
    {
        Command cmd = new("podcastLoad", "Load existing podcast memory index")
        {
            Args.Arg<string>("filePath", "Path to existing podcast index"),
        };
        cmd.SetAction(this.PodcastLoadAsync);
        return cmd;
    }

    private Task PodcastLoadAsync(ParseResult args, CancellationToken cancellationToken)
    {
        NamedArgs namedArgs = new(args);
        string? filePath = namedArgs.Get("filePath");
        var data = ConversationJsonSerializer.ReadFromFile<PodcastMessage>(filePath!);
        return Task.CompletedTask;
    }

    private Command PodcastImportIndexDef()
    {
        Command cmd = new("podcastImportIndex", "Import existing podcast memory index")
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

        using var provider = new SqliteStorageProvider<PodcastMessage, PodcastMessageMeta>(_kpContext.DotnetPath, "podcast", true);
        var podcast = new Podcast(provider);

        int count = await podcast.ImportMessagesAsync(data.Messages, cancellationToken);
        KnowProWriter.WriteLine($"{count} message imported");
        // Read all
        for (int i = 0; i < count; ++i)
        {
            var message = await podcast.Messages.GetAsync(i, cancellationToken);
            var json = Json.Stringify(message);
            KnowProWriter.WriteLine(json);
        }

        KnowProWriter.WriteLine($"{data.SemanticRefs.Length} semantic refs");
        count = await podcast.ImportSemanticRefsAsync(data.SemanticRefs, cancellationToken);
        KnowProWriter.WriteLine($"{count} semantic Refs imported");
        for (int i = 0; i < count; ++i)
        {
            var semanticRef = await podcast.SemanticRefs.GetAsync(i, cancellationToken);
            var json = Serializer.ToJsonIndented(semanticRef);
            KnowProWriter.WriteLine(json);
        }

        if (data.SemanticIndexData is not null)
        {
            await podcast.ImportTermToSemanticRefIndexAsync(data.SemanticIndexData.Items, cancellationToken);
            count = await podcast.SemanticRefIndex.GetCountAsync(cancellationToken);
            KnowProWriter.WriteLine($"{count} index entries imported");

            var matches = await podcast.SemanticRefIndex.LookupTermAsync("Children of Time", cancellationToken);
            KnowProWriter.WriteLine($"{matches.Count} matches");
        }
    }
}
