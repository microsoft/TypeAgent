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

        _handler.Handle("Volume", new JObject { ["targetVolume"] = targetVolume });

        _audioMock.Verify(a => a.SetVolume(targetVolume), Times.Once);
    }

    /// <summary>
    /// Verifies that setting volume reads and saves the current level before applying the new one.
    /// </summary>
    [Fact]
    public void Volume_SavesCurrentVolumeBeforeSetting()
    {
        _audioMock.Setup(a => a.GetVolume()).Returns(42);

        _handler.Handle("Volume", new JObject { ["targetVolume"] = 80 });

        _audioMock.Verify(a => a.GetVolume(), Times.Once);
    }

    /// <summary>
    /// Verifies that a missing targetVolume does not trigger a <see cref="IAudioService.SetVolume"/> call.
    /// </summary>
    [Fact]
    public void Volume_MissingTargetVolume_DoesNotCallSetVolume()
    {
        _handler.Handle("Volume", new JObject());

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

        _handler.Handle("Volume", new JObject { ["targetVolume"] = 20 });
        _audioMock.Invocations.Clear();

        _handler.Handle("RestoreVolume", new JObject());

        _audioMock.Verify(a => a.SetVolume(65), Times.Once);
    }

    /// <summary>
    /// Verifies that RestoreVolume defaults to zero when no prior volume change has been recorded.
    /// </summary>
    [Fact]
    public void RestoreVolume_WithoutPriorChange_RestoresZero()
    {
        _handler.Handle("RestoreVolume", new JObject());

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

        _handler.Handle("Volume", new JObject { ["targetVolume"] = 80 });
        _audioMock.Invocations.Clear();

        _handler.Handle("RestoreVolume", new JObject());

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
        _handler.Handle("Mute", new JObject { ["on"] = on });

        _audioMock.Verify(a => a.SetMute(on), Times.Once);
    }

    /// <summary>
    /// Verifies that a missing on parameter defaults to muting (false).
    /// </summary>
    [Fact]
    public void Mute_MissingOn_DefaultsToFalse()
    {
        _handler.Handle("Mute", new JObject());

        _audioMock.Verify(a => a.SetMute(false), Times.Once);
    }

    // --- Unknown key ---

    /// <summary>
    /// Verifies that an unknown command key does not invoke any audio service methods.
    /// </summary>
    [Fact]
    public void Handle_UnknownKey_DoesNothing()
    {
        _handler.Handle("UnknownAudioCmd", new JObject());

        _audioMock.VerifyNoOtherCalls();
    }
}
