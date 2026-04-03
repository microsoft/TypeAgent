// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers;
using autoShell.Services;
using Moq;
using Newtonsoft.Json.Linq;

namespace autoShell.Tests;

public class AudioCommandHandlerTests
{
    private readonly Mock<IAudioService> _audioMock = new();
    private readonly AudioCommandHandler _handler;

    public AudioCommandHandlerTests()
    {
        _handler = new AudioCommandHandler(_audioMock.Object);
    }

    /// <summary>
    /// Verifies that the handler exposes exactly the Volume, Mute, and RestoreVolume commands.
    /// </summary>
    [Fact]
    public void SupportedCommands_ContainsExpectedCommands()
    {
        var commands = _handler.SupportedCommands.ToList();
        Assert.Contains("Volume", commands);
        Assert.Contains("Mute", commands);
        Assert.Contains("RestoreVolume", commands);
        Assert.Equal(3, commands.Count);
    }

    // --- Volume ---

    /// <summary>
    /// Verifies that valid integer percentage values are forwarded to SetVolume.
    /// </summary>
    [Theory]
    [InlineData("0", 0)]
    [InlineData("50", 50)]
    [InlineData("100", 100)]
    public void Volume_ValidPercent_SetsVolume(string input, int expected)
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(75);

        Handle("Volume", input);

        _audioMock.Verify(a => a.SetVolume(expected), Times.Once);
    }

    /// <summary>
    /// Verifies that setting volume reads and saves the current level before applying the new one.
    /// </summary>
    [Fact]
    public void Volume_SavesCurrentVolumeBeforeSetting()
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(42);

        Handle("Volume", "80");

        // GetVolume should have been called to save the current level
        _audioMock.Verify(a => a.GetVolume(), Times.Once);
    }

    /// <summary>
    /// Verifies that non-integer input does not trigger a SetVolume call.
    /// </summary>
    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("12.5")]
    public void Volume_InvalidInput_DoesNotCallSetVolume(string input)
    {
        Handle("Volume", input);

        _audioMock.Verify(a => a.SetVolume(It.IsAny<int>()), Times.Never);
    }

    // --- RestoreVolume ---

    /// <summary>
    /// Verifies that RestoreVolume restores the volume to the level saved before the last change.
    /// </summary>
    [Fact]
    public void RestoreVolume_AfterVolumeChange_RestoresSavedLevel()
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(65);

        // First set volume (saves 65)
        Handle("Volume", "20");
        _audioMock.Invocations.Clear();

        // Then restore
        Handle("RestoreVolume", "");

        _audioMock.Verify(a => a.SetVolume(65), Times.Once);
    }

    /// <summary>
    /// Verifies that RestoreVolume defaults to zero when no prior volume change has been recorded.
    /// </summary>
    [Fact]
    public void RestoreVolume_WithoutPriorChange_RestoresZero()
    {
        Handle("RestoreVolume", "");

        _audioMock.Verify(a => a.SetVolume(0), Times.Once);
    }

    // --- Mute ---

    /// <summary>
    /// Verifies that valid boolean string values are forwarded to SetMute.
    /// </summary>
    [Theory]
    [InlineData("true", true)]
    [InlineData("True", true)]
    [InlineData("false", false)]
    [InlineData("False", false)]
    public void Mute_ValidBool_SetsMute(string input, bool expected)
    {
        Handle("Mute", input);

        _audioMock.Verify(a => a.SetMute(expected), Times.Once);
    }

    /// <summary>
    /// Verifies that non-boolean input does not trigger a SetMute call.
    /// </summary>
    [Theory]
    [InlineData("")]
    [InlineData("yes")]
    [InlineData("1")]
    [InlineData("on")]
    public void Mute_InvalidInput_DoesNotCallSetMute(string input)
    {
        Handle("Mute", input);

        _audioMock.Verify(a => a.SetMute(It.IsAny<bool>()), Times.Never);
    }

    // --- Unknown key ---

    /// <summary>
    /// Verifies that an unknown command key does not invoke any audio service methods.
    /// </summary>
    [Fact]
    public void Handle_UnknownKey_DoesNothing()
    {
        Handle("UnknownAudioCmd", "value");

        _audioMock.VerifyNoOtherCalls();
    }

    private void Handle(string key, string value)
    {
        _handler.Handle(key, value, JToken.FromObject(value));
    }
}
