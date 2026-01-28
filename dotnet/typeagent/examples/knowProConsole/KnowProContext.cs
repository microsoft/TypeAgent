// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;

namespace KnowProConsole;

public class KnowProContext
{
    public KnowProContext(string? basePath = null)
    {
        this.BasePath = basePath ?? "/data/testChat/knowpro";
        this.DotnetPath = Path.Join(this.BasePath, "dotnet");
        Directory.CreateDirectory(this.BasePath);
        Directory.CreateDirectory(this.DotnetPath);

        this.Stopwatch = new Stopwatch();
    }

    /// <summary>
    /// The base path for storing data files.
    /// </summary>
    public string BasePath { get; set; }

    /// <summary>
    /// The path for storing .NET related data files.
    /// </summary>
    public string DotnetPath { get; set; }

    /// <summary>
    /// The model suffix to use for this context.
    /// </summary>
    public string ModelSuffix { get; set; } = string.Empty;

    /// <summary>
    /// A reusable stopwatch for timing.
    /// </summary>
    public Stopwatch Stopwatch { get; }

    /// <summary>
    /// The current conversation.
    /// </summary>
    public IConversation? Conversation { get; set; }

    /// <summary>
    /// Creates a new SQLite storage provider.
    /// </summary>
    /// <typeparam name="TMessage">The message type.</typeparam>
    /// <typeparam name="TMeta">The metadata type</typeparam>
    /// <param name="settings">Storage provider settings.</param>
    /// <param name="name">The name of the database file.</param>
    /// <param name="createNew">Flag indicating if a new db should be created or existing one reused.</param>
    /// <returns></returns>
    public SqliteStorageProvider<TMessage, TMeta> CreateStorageProvider<TMessage, TMeta>(
        ConversationSettings settings,
        string name,
        bool createNew
    )
        where TMessage : class, IMessage, new()
        where TMeta : IMessageMetadata, new()
    {
        var provider = new SqliteStorageProvider<TMessage, TMeta>(
            settings,
            DotnetPath,
            name,
            createNew
        );

        return provider;
    }

}
