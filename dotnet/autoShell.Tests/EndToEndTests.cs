// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using Newtonsoft.Json.Linq;

namespace autoShell.Tests;

/// <summary>
/// End-to-end tests that launch autoShell.exe as a child process and communicate
/// via the stdin/stdout JSON protocol. Tests the full pipeline including process
/// startup, JSON parsing, command dispatch, and response serialization.
/// </summary>
[Trait("Category", "E2E")]
public sealed class EndToEndTests : IDisposable
{
    private readonly AutoShellProcess _process;

    public EndToEndTests()
    {
        _process = AutoShellProcess.StartInteractive();
    }

    public void Dispose()
    {
        _process.Dispose();
    }

    // --- Query commands (assert JSON stdout) ---

    /// <summary>
    /// Verifies that ListAppNames returns a valid JSON array of app names via stdout.
    /// </summary>
    [Fact]
    public async Task ListAppNames_ReturnsJsonArray()
    {
        _process.SendCommand("""{"ListAppNames":""}""");

        string? response = await _process.ReadLineAsync();

        Assert.NotNull(response);
        var array = JArray.Parse(response);
        Assert.NotEmpty(array);
    }

    /// <summary>
    /// Verifies that ListThemes returns a valid JSON array of theme file paths via stdout.
    /// </summary>
    [Fact]
    public async Task ListThemes_ReturnsJsonArray()
    {
        _process.SendCommand("""{"ListThemes":""}""");

        // Theme scanning involves disk I/O; allow extra time
        string? response = await _process.ReadLineAsync(10000);

        Assert.NotNull(response);
        var array = JArray.Parse(response);
        Assert.NotEmpty(array);
    }

    /// <summary>
    /// Verifies that multiple sequential query commands each return a separate response.
    /// </summary>
    [Fact]
    public async Task MultipleQueries_EachReturnsResponse()
    {
        _process.SendCommand("""{"ListAppNames":""}""");
        string? response1 = await _process.ReadLineAsync();

        _process.SendCommand("""{"ListThemes":""}""");
        string? response2 = await _process.ReadLineAsync();

        Assert.NotNull(response1);
        Assert.NotNull(response2);
        JArray.Parse(response1);
        JArray.Parse(response2);
    }

    /// <summary>
    /// Verifies that ListResolutions returns a valid JSON string via stdout.
    /// </summary>
    [Fact]
    public async Task ListResolutions_ReturnsResponse()
    {
        _process.SendCommand("""{"ListResolutions":""}""");

        string? response = await _process.ReadLineAsync(10000);

        Assert.NotNull(response);
        Assert.NotEmpty(response);
    }

    /// <summary>
    /// Verifies that ListWifiNetworks returns a response via stdout.
    /// </summary>
    [Fact]
    public async Task ListWifiNetworks_ReturnsResponse()
    {
        _process.SendCommand("""{"ListWifiNetworks":""}""");

        string? response = await _process.ReadLineAsync(10000);

        Assert.NotNull(response);
        Assert.NotEmpty(response);
    }

    /// <summary>
    /// Verifies that SetScreenResolution with an invalid value produces a response without crashing.
    /// Uses an intentionally invalid resolution to avoid changing the actual display.
    /// </summary>
    [Fact]
    public async Task SetScreenResolution_InvalidValue_ReturnsResponse()
    {
        _process.SendCommand("""{"SetScreenResolution":"99999x99999"}""");

        // May produce an error message or status — just verify the process survives
        // and we can still send commands
        await _process.ReadLineAsync(5000);

        _process.SendCommand("""{"ListAppNames":""}""");
        string? response = await _process.ReadLineAsync();

        Assert.False(_process.HasExited);
        Assert.NotNull(response);
    }

    // --- Protocol edge cases ---

    /// <summary>
    /// Verifies that multiple commands in a single JSON object each produce stdout output.
    /// </summary>
    [Fact]
    public async Task MultiCommandObject_ProducesMultipleResponses()
    {
        _process.SendCommand("""{"ListAppNames":"", "ListThemes":""}""");

        string? response1 = await _process.ReadLineAsync();
        string? response2 = await _process.ReadLineAsync();

        Assert.NotNull(response1);
        Assert.NotNull(response2);
        // One should be app names, the other themes — both valid JSON arrays
        JArray.Parse(response1);
        JArray.Parse(response2);
    }

    /// <summary>
    /// Verifies that quit stops processing mid-batch. Commands after quit should not execute.
    /// </summary>
    [Fact]
    public async Task Quit_StopsMidBatch()
    {
        // ListAppNames produces output, quit should stop before ListThemes runs
        _process.SendCommand("""{"ListAppNames":"", "quit":"", "ListThemes":""}""");

        string? response1 = await _process.ReadLineAsync();
        Assert.NotNull(response1);
        JArray.Parse(response1);

        // Process should have exited — no second response
        _process.WaitForExit(10000);
        Assert.True(_process.HasExited);
    }

    /// <summary>
    /// Verifies that sending {"quit":""} causes the process to exit cleanly.
    /// </summary>
    [Fact]
    public void Quit_ProcessExits()
    {
        _process.SendQuit();

        Assert.True(_process.HasExited);
    }

    /// <summary>
    /// Verifies that malformed JSON does not crash the process.
    /// Sends invalid JSON followed by a valid query to confirm the process is still alive.
    /// </summary>
    [Fact]
    public async Task MalformedJson_ProcessSurvives()
    {
        _process.SendCommand("this is not json");

        // Process should still be alive — send a valid command to verify
        _process.SendCommand("""{"ListAppNames":""}""");
        string? response = await _process.ReadLineAsync();

        Assert.False(_process.HasExited);
        Assert.NotNull(response);
    }

    /// <summary>
    /// Verifies that an empty line does not crash the process.
    /// The error message goes to stdout (known protocol limitation), so we
    /// consume it before verifying the process is still responsive.
    /// </summary>
    [Fact]
    public async Task EmptyLine_ProcessSurvives()
    {
        _process.SendCommand("");
        // Consume the error message that goes to stdout
        await _process.ReadLineAsync();

        _process.SendCommand("""{"ListAppNames":""}""");
        string? response = await _process.ReadLineAsync();

        Assert.False(_process.HasExited);
        Assert.NotNull(response);
    }

    /// <summary>
    /// Verifies that an unknown command does not crash the process.
    /// </summary>
    [Fact]
    public async Task UnknownCommand_ProcessSurvives()
    {
        _process.SendCommand("""{"NonExistentCommand":"value"}""");

        _process.SendCommand("""{"ListAppNames":""}""");
        string? response = await _process.ReadLineAsync();

        Assert.False(_process.HasExited);
        Assert.NotNull(response);
    }

    /// <summary>
    /// Verifies that closing stdin (EOF) causes the process to exit cleanly.
    /// </summary>
    [Fact]
    public void StdinClosed_ProcessExits()
    {
        _process.CloseStdin();
        _process.WaitForExit(5000);

        Assert.True(_process.HasExited);
    }

    // --- Command-line mode ---

    /// <summary>
    /// Verifies that passing a single JSON command as a command-line argument
    /// executes it and exits (non-interactive mode).
    /// </summary>
    [Fact]
    public void CommandLineMode_SingleObject_ExecutesAndExits()
    {
        var (output, exitCode) = AutoShellProcess.RunWithArgs(
            """{"ListAppNames":""}""");

        Assert.Equal(0, exitCode);
        Assert.NotEmpty(output);
        JArray.Parse(output.Trim());
    }

    /// <summary>
    /// Verifies that passing a JSON array of commands as command-line arguments
    /// executes all of them and exits.
    /// </summary>
    [Fact]
    public void CommandLineMode_JsonArray_ExecutesAllAndExits()
    {
        var (output, exitCode) = AutoShellProcess.RunWithArgs(
            """[{"ListAppNames":""},{"ListThemes":""}]""");

        Assert.Equal(0, exitCode);
        Assert.NotEmpty(output);
    }
}
