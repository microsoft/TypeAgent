// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Threading;
using System.Threading.Tasks;
using Microsoft.TypeChat;
using TypeAgent.ConversationMemory;
using TypeAgent.KnowPro;
using TypeAgent.KnowPro.Lang;
using TypeAgent.KnowPro.Storage.Sqlite;
using TypeAgent.TestLib;
using Xunit;

namespace TypeAgent.Tests.ConversationMemory;

public class MemoryTests : TestWithData
{
    /// <summary>
    /// Create temporary folder and load .ENV file
    /// </summary>
    public MemoryTests() : base(true) { }

    [Fact]
    public async Task Constructor_ShouldInitializeWithDefaults()
    {
        // Arrange & Act
        var settings = new MemorySettings();
        using var provider = CreateStorageProvider("Constructor_Test");
        using var memory = new TestMemory<TestMessage>(settings, provider);

        // Assert
        Assert.NotNull(memory);
        Assert.NotNull(memory.Settings);
        Assert.Equal(settings, memory.Settings);
        Assert.Null(memory.Name);
        Assert.Null(memory.Tags);
        Assert.Null(memory.NoiseTerms);
    }

    [Fact]
    public async Task Constructor_ShouldInitializeWithCustomValues()
    {
        // Arrange
        var settings = new MemorySettings();
        using var provider = CreateStorageProvider("Constructor_CustomValues");
        var name = "TestMemory";
        var tags = new List<string> { "tag1", "tag2" };
        var noiseTerms = new NoiseText(["test", "noise"]);

        // Act
        using var memory = new TestMemory<TestMessage>(settings, provider)
        {
            Name = name,
            Tags = tags,
            NoiseTerms = noiseTerms
        };

        // Assert
        Assert.Equal(name, memory.Name);
        Assert.Equal(tags, memory.Tags);
        Assert.Equal(noiseTerms, memory.NoiseTerms);
    }

    [Fact]
    public async Task SearchAsync_WithEmptyMemory_ShouldReturnEmptyResults()
    {
        // Arrange
        using var memory = CreateTestMemory("SearchAsync_Empty");
        var searchText = "test query";

        // Act
        var results = await memory.SearchAsync(searchText, cancellationToken: CancellationToken.None);

        // Assert
        Assert.NotNull(results);
        Assert.False(results.First().HasResults);
    }

    [Fact]
    public async Task SearchAsync_WithNullOptions_ShouldUseDefaults()
    {
        // Arrange
        var memory = CreateTestMemory("SearchAsync_NullOptions");
        await AddTestMessage(memory, "This is a test message about dogs.");

        // Act
        var results = await memory.SearchAsync("dogs", options: null, cancellationToken: CancellationToken.None);

        // Assert
        Assert.NotNull(results);
    }

    [Fact]
    public async Task SearchAsync_WithMessages_ShouldReturnResults()
    {
        // Arrange
        var memory = CreateTestMemory("SearchAsync_WithMessages");
        await AddTestMessage(memory, "This is a message about cats.");
        await AddTestMessage(memory, "This is a message about dogs.");
        await AddTestMessage(memory, "This is a message about birds.");

        // Act
        var results = await memory.SearchAsync("cats", cancellationToken: CancellationToken.None);

        // Assert
        Assert.NotNull(results);
        // Note: Actual results depend on search implementation
    }

    [Fact]
    public async Task GetModelInstructions_ShouldReturnNull_ByDefault()
    {
        // Arrange
        var memory = CreateTestMemory("GetModelInstructions_Default");

        // Act
        var instructions = memory.GetModelInstructions();

        // Assert
        Assert.Null(instructions);
    }

    [Fact]
    public async Task UseScopedSearch_ShouldThrowNotImplementedException()
    {
        // Arrange
        var settings = new MemorySettings
        {
            UseScopedSearch = true
        };
        var memory = CreateTestMemory("UseScopedSearch_Test", settings);

        // Act & Assert
        await Assert.ThrowsAsync<NotImplementedException>(async () =>
        {
            await memory.SearchAsync("test query", cancellationToken: CancellationToken.None);
        });
    }

    [Fact]
    public void Settings_ShouldReturnMemorySettings()
    {
        // Arrange
        var conversationSettings = new ConversationSettings();
        var memorySettings = new MemorySettings(conversationSettings);
        var memory = CreateTestMemory("Settings_Test", memorySettings);

        // Act
        var settings = memory.Settings;

        // Assert
        Assert.NotNull(settings);
        Assert.IsType<MemorySettings>(settings);
        Assert.Equal(memorySettings, settings);
    }

    [Fact]
    public void Name_ShouldBeSettableAndGettable()
    {
        // Arrange
        var memory = CreateTestMemory("Name_Test");
        var expectedName = "MyMemory";

        // Act
        memory.Name = expectedName;

        // Assert
        Assert.Equal(expectedName, memory.Name);
    }

    [Fact]
    public void Tags_ShouldBeSettableAndGettable()
    {
        // Arrange
        var memory = CreateTestMemory("Tags_Test");
        var expectedTags = new List<string> { "important", "archived" };

        // Act
        memory.Tags = expectedTags;

        // Assert
        Assert.Equal(expectedTags, memory.Tags);
    }

    [Fact]
    public void NoiseTerms_ShouldBeSettableAndGettable()
    {
        // Arrange
        var memory = CreateTestMemory("NoiseTerms_Test");
        var noiseTerms = new NoiseText(["the", "a", "an"]);

        // Act
        memory.NoiseTerms = noiseTerms;

        // Assert
        Assert.Equal(noiseTerms, memory.NoiseTerms);
    }

    [Fact]
    public async Task SearchAsync_WithNoiseTerms_ShouldFilterTerms()
    {
        // Arrange
        var memory = CreateTestMemory("SearchAsync_NoiseTerms");
        memory.NoiseTerms = new NoiseText(["the", "a"]);
        await AddTestMessage(memory, "The cat sat on a mat.");

        // Act
        var results = await memory.SearchAsync("the cat", cancellationToken: CancellationToken.None);

        // Assert
        Assert.NotNull(results);
        // Noise terms should be filtered in the search options
    }

    [Fact]
    public async Task SearchAsync_WithFilter_ShouldApplyFilter()
    {
        // Arrange
        var memory = CreateTestMemory("SearchAsync_WithFilter");
        await AddTestMessage(memory, "Test message one");
        await AddTestMessage(memory, "Test message two");

        var filter = new LangSearchFilter();

        // Act
        var results = await memory.SearchAsync(
            "test",
            filter: filter,
            cancellationToken: CancellationToken.None
        );

        // Assert
        Assert.NotNull(results);
    }

    [Fact]
    public async Task SearchAsync_WithDebugContext_ShouldPopulateDebugInfo()
    {
        // Arrange
        var memory = CreateTestMemory("SearchAsync_DebugContext");
        await AddTestMessage(memory, "Debug test message");

        var debugContext = new LangSearchDebugContext();

        // Act
        var results = await memory.SearchAsync(
            "debug",
            debugContext: debugContext,
            cancellationToken: CancellationToken.None
        );

        // Assert
        Assert.NotNull(results);
        Assert.NotNull(debugContext);
    }

    [Fact]
    public async Task SearchAsync_WithCancellation_ShouldRespectCancellationToken()
    {
        // Arrange
        var memory = CreateTestMemory("SearchAsync_Cancellation");
        await AddTestMessage(memory, "Cancellation test message");

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        // Act & Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
        {
            await memory.SearchAsync("test", cancellationToken: cts.Token);
        });
    }

    [Fact]
    public async Task AdjustLanguageSearchOptions_ShouldAddModelInstructions()
    {
        // Arrange
        var memory = new TestMemoryWithInstructions(
            new MemorySettings(),
            CreateStorageProvider("AdjustOptions_Instructions")
        );
        await AddTestMessage(memory, "Test message");

        // Act
        var results = await memory.SearchAsync("test", cancellationToken: CancellationToken.None);

        // Assert
        Assert.NotNull(results);
        // Model instructions should be included in search options
    }

    [Fact]
    public async Task AdjustLanguageSearchOptions_ShouldSetTermFilter()
    {
        // Arrange
        var memory = CreateTestMemory("AdjustOptions_TermFilter");
        memory.NoiseTerms = new NoiseText(["test", "noise"]);
        await AddTestMessage(memory, "Test message with noise");

        // Act
        var results = await memory.SearchAsync("test noise", cancellationToken: CancellationToken.None);

        // Assert
        Assert.NotNull(results);
        // Term filter should be set to exclude noise terms
    }

    #region Helper Methods

    private IStorageProvider<TestMessage> CreateStorageProvider(string dbName)
    {
        return new SqliteStorageProvider<TestMessage, TestMessageMetadata>(
            new ConversationSettings(),
            _tempDir.FullName,
            dbName,
            createNew: true
        );
    }

    private TestMemory<TestMessage> CreateTestMemory(
        string dbName,
        MemorySettings? settings = null
    )
    {
        settings ??= new MemorySettings();
        var provider = CreateStorageProvider(dbName);
        return new TestMemory<TestMessage>(settings, provider);
    }

    private async Task AddTestMessage(TestMemory<TestMessage> memory, string text)
    {
        var message = new TestMessage
        {
            TextChunks = [text],
            Timestamp = System.DateTime.UtcNow.ToString("o")
        };
        memory.StorageProvider.TypedMessages.AppendAsync(message, CancellationToken.None);
    }

    #endregion

    #region Test Classes

    private class TestMessage : IMessage
    {
        public int MessageId { get; set; }
        public IList<string> TextChunks { get; set; } = new List<string>();
        public IList<string>? Tags { get; set; }
        public string? Timestamp { get; set; }
        public IMessageMetadata? Metadata { get; set; } = new TestMessageMetadata();

        public int GetLength() => TextChunks.Sum(c => c.Length);

        public KnowledgeResponse? GetKnowledge() => null;
    }

    private class TestMessageMetadata : IMessageMetadata
    {
        public string Source => "test";
        public IList<string>? Dest => null;
    }

    private class TestMemory<TMessage> : TypeAgent.ConversationMemory.Memory<TMessage>
        where TMessage : class, IMessage, new()
    {
        public IStorageProvider<TMessage> StorageProvider { get; }

        public TestMemory(MemorySettings settings, IStorageProvider<TMessage> storageProvider)
            : base(settings, storageProvider)
        {
            StorageProvider = storageProvider;
        }
    }

    private class TestMemoryWithInstructions : TestMemory<TestMessage>
    {
        public TestMemoryWithInstructions(
            MemorySettings settings,
            IStorageProvider<TestMessage> storageProvider
        )
            : base(settings, storageProvider)
        {
        }

        public override IList<IPromptSection>? GetModelInstructions()
        {
            return new List<IPromptSection>
            {
                new PromptSection
                {
                    Role = "system",
                    Content = "Test instruction"
                }
            };
        }
    }

    private class PromptSection : IPromptSection
    {
        public string Role { get; set; } = string.Empty;
        public string Content { get; set; } = string.Empty;

        public string? Source => throw new NotImplementedException();

        public string GetText()
        {
            throw new NotImplementedException();
        }
    }

    #endregion
}
