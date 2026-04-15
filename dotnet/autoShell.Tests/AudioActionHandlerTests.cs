// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using autoShell.Handlers;
using autoShell.Services;
using Moq;

namespace autoShell.Tests;

public class AudioActionHandlerTests
{
    private readonly Mock<IAudioService> _audioMock = new();
    private readonly AudioActionHandler _handler;

    public AudioActionHandlerTests()
    {
        _handler = new AudioActionHandler(_audioMock.Object);
    }

    // --- Volume ---

    /// <summary>
    /// Verifies that valid integer percentage values are forwarded to <see cref="IAudioService.SetVolume"/>.
    /// </summary>
    [Theory]
    [InlineData(0)]
    [InlineData(50)]
    [InlineData(100)]
    public void Volume_ValidPercent_SetsVolume(int targetVolume)
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(75);

        _handler.Handle("Volume", JsonDocument.Parse($$"""{"targetVolume":{{targetVolume}}}""").RootElement);

        _audioMock.Verify(a => a.SetVolume(targetVolume), Times.Once);
    }

    /// <summary>
    /// Verifies that setting volume reads and saves the current level before applying the new one.
    /// </summary>
    [Fact]
    public void Volume_SavesCurrentVolumeBeforeSetting()
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(42);

        _handler.Handle("Volume", JsonDocument.Parse("""{"targetVolume":80}""").RootElement);

        // GetVolume should have been called to save the current level
        _audioMock.Verify(a => a.GetVolume(), Times.Once);
    }

    /// <summary>
    /// Verifies that a missing targetVolume defaults to zero (mute).
    /// The schema defines targetVolume as required, so the LLM always sends it.
    /// When missing, the typed parameter defaults to 0, resulting in mute.
    /// </summary>
    [Fact]
    public void Volume_MissingTargetVolume_SetsVolumeToZero()
    {
        _handler.Handle("Volume", JsonDocument.Parse("{}").RootElement);

        _audioMock.Verify(a => a.SetVolume(0), Times.Once);
    }

    // --- RestoreVolume ---

    /// <summary>
    /// Verifies that RestoreVolume restores the volume to the level saved before the last change.
    /// </summary>
    [Fact]
    public void RestoreVolume_AfterVolumeChange_RestoresSavedLevel()
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(65);

        _handler.Handle("Volume", JsonDocument.Parse("""{"targetVolume":20}""").RootElement);
        _audioMock.Invocations.Clear();

        _handler.Handle("RestoreVolume", JsonDocument.Parse("{}").RootElement);

        _audioMock.Verify(a => a.SetVolume(65), Times.Once);
    }

    /// <summary>
    /// Verifies that RestoreVolume defaults to zero when no prior volume change has been recorded.
    /// </summary>
    [Fact]
    public void RestoreVolume_WithoutPriorChange_RestoresZero()
    {
        _handler.Handle("RestoreVolume", JsonDocument.Parse("{}").RootElement);

        _audioMock.Verify(a => a.SetVolume(0), Times.Once);
    }

    /// <summary>
    /// Verifies that RestoreVolume uses the actual saved volume, not a hardcoded value,
    /// by using a different initial volume than the other RestoreVolume test.
    /// </summary>
    [Fact]
    public void RestoreVolume_DifferentInitialVolume_RestoresSavedLevel()
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(30);

        _handler.Handle("Volume", JsonDocument.Parse("""{"targetVolume":80}""").RootElement);
        _audioMock.Invocations.Clear();

        _handler.Handle("RestoreVolume", JsonDocument.Parse("{}").RootElement);

        _audioMock.Verify(a => a.SetVolume(30), Times.Once);
    }

    // --- Mute ---

    /// <summary>
    /// Verifies that the on parameter is forwarded to <see cref="IAudioService.SetMute"/>.
    /// </summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Mute_SetsMute(bool on)
    {
        _handler.Handle("Mute", JsonDocument.Parse($$"""{"on":{{on.ToString().ToLowerInvariant()}}}""").RootElement);

        _audioMock.Verify(a => a.SetMute(on), Times.Once);
    }

    /// <summary>
    /// Verifies that a missing on parameter defaults to muting (false).
    /// </summary>
    [Fact]
    public void Mute_MissingOn_DefaultsToFalse()
    {
        _handler.Handle("Mute", JsonDocument.Parse("{}").RootElement);

        _audioMock.Verify(a => a.SetMute(false), Times.Once);
    }

    // --- AdjustVolume ---

    /// <summary>
    /// Verifies that AdjustVolume "up" increases volume by the specified amount.
    /// </summary>
    [Fact]
    public void AdjustVolume_Up_IncreasesVolume()
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(50);

        var result = _handler.Handle("AdjustVolume", JsonDocument.Parse("""{"direction":"up","amount":15}""").RootElement);

        Assert.True(result.Success);
        _audioMock.Verify(a => a.SetVolume(65), Times.Once);
    }

    /// <summary>
    /// Verifies that AdjustVolume "down" decreases volume by the specified amount.
    /// </summary>
    [Fact]
    public void AdjustVolume_Down_DecreasesVolume()
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(50);

        var result = _handler.Handle("AdjustVolume", JsonDocument.Parse("""{"direction":"down","amount":20}""").RootElement);

        Assert.True(result.Success);
        _audioMock.Verify(a => a.SetVolume(30), Times.Once);
    }

    /// <summary>
    /// Verifies that AdjustVolume defaults to 10% when amount is omitted.
    /// </summary>
    [Fact]
    public void AdjustVolume_DefaultAmount_AdjustsBy10()
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(40);

        _handler.Handle("AdjustVolume", JsonDocument.Parse("""{"direction":"up"}""").RootElement);

        _audioMock.Verify(a => a.SetVolume(50), Times.Once);
    }

    /// <summary>
    /// Verifies that AdjustVolume clamps to 0-100 range.
    /// </summary>
    [Theory]
    [InlineData("up", 95, 30, 100)]   // 95 + 30 = 125, clamped to 100
    [InlineData("down", 10, 25, 0)]    // 10 - 25 = -15, clamped to 0
    public void AdjustVolume_ClampsToRange(string direction, int current, int amount, int expected)
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(current);

        _handler.Handle("AdjustVolume", JsonDocument.Parse($$"""{"direction":"{{direction}}","amount":{{amount}}}""").RootElement);

        _audioMock.Verify(a => a.SetVolume(expected), Times.Once);
    }

    /// <summary>
    /// Verifies that AdjustVolume saves the current volume before adjusting.
    /// </summary>
    [Fact]
    public void AdjustVolume_SavesCurrentVolume()
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(60);

        _handler.Handle("AdjustVolume", JsonDocument.Parse("""{"direction":"up","amount":10}""").RootElement);
        _audioMock.Invocations.Clear();

        _handler.Handle("RestoreVolume", JsonDocument.Parse("{}").RootElement);

        _audioMock.Verify(a => a.SetVolume(60), Times.Once);
    }

    // --- Unknown key ---

    /// <summary>
    /// Verifies that an unknown command key does not invoke any audio service methods.
    /// </summary>
    [Fact]
    public void Handle_UnknownKey_DoesNothing()
    {
        _handler.Handle("UnknownAudioCmd", JsonDocument.Parse("{}").RootElement);

        _audioMock.VerifyNoOtherCalls();
    }
}
