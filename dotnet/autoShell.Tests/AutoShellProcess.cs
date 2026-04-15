// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;

namespace autoShell.Tests;

/// <summary>
/// Manages an autoShell.exe child process with redirected stdin/stdout
/// for end-to-end testing of the JSON command protocol.
/// </summary>
internal sealed class AutoShellProcess : IDisposable
{
    private static readonly string s_exePath = Path.Combine(AppContext.BaseDirectory, "autoShell.exe");

    private readonly Process _process;

    private AutoShellProcess(Process process)
    {
        _process = process;
    }

    /// <summary>
    /// Starts autoShell.exe in interactive (stdin) mode with redirected I/O.
    /// </summary>
    public static AutoShellProcess StartInteractive()
    {
        var psi = new ProcessStartInfo
        {
            FileName = s_exePath,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        var process = Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to start autoShell.exe");

        return new AutoShellProcess(process);
    }

    /// <summary>
    /// Starts autoShell.exe with command-line arguments (non-interactive mode).
    /// Returns stdout content and exit code after the process completes.
    /// </summary>
    public static (string Output, int ExitCode) RunWithArgs(string args, int timeoutMs = 10000)
    {
        var psi = new ProcessStartInfo
        {
            FileName = s_exePath,
            Arguments = args,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        using var process = Process.Start(psi)!;
        string output = process.StandardOutput.ReadToEnd();
        bool exited = process.WaitForExit(timeoutMs);

        if (!exited)
        {
            process.Kill();
            throw new TimeoutException($"autoShell.exe did not exit within {timeoutMs}ms");
        }

        return (output, process.ExitCode);
    }

    /// <summary>
    /// Sends a JSON command string to stdin, terminated with \r\n.
    /// </summary>
    public void SendCommand(string json)
    {
        _process.StandardInput.WriteLine(json);
        _process.StandardInput.Flush();
    }

    /// <summary>
    /// Reads a single line of stdout with a timeout.
    /// Returns null if the timeout expires before a line is available.
    /// Uses a lock to prevent concurrent reads on the same stream.
    /// </summary>
    private readonly SemaphoreSlim _readLock = new(1, 1);

    public async Task<string?> ReadLineAsync(int timeoutMs = 5000)
    {
        await _readLock.WaitAsync();
        try
        {
            using var cts = new CancellationTokenSource(timeoutMs);
            return await _process.StandardOutput.ReadLineAsync(cts.Token).AsTask();
        }
        catch (OperationCanceledException)
        {
            return null;
        }
        finally
        {
            _readLock.Release();
        }
    }

    /// <summary>
    /// Sends a quit command and waits for the process to exit.
    /// </summary>
    public void SendQuit(int timeoutMs = 5000)
    {
        SendCommand("""{"actionName":"quit","parameters":{}}""");
        _process.WaitForExit(timeoutMs);
    }

    /// <summary>
    /// Returns true if the process has exited.
    /// </summary>
    public bool HasExited => _process.HasExited;

    /// <summary>
    /// Closes the stdin stream (sends EOF).
    /// </summary>
    public void CloseStdin()
    {
        _process.StandardInput.Close();
    }

    /// <summary>
    /// Waits for the process to exit within the given timeout.
    /// </summary>
    public bool WaitForExit(int timeoutMs)
    {
        return _process.WaitForExit(timeoutMs);
    }

    public void Dispose()
    {
        try
        {
            if (!_process.HasExited)
            {
                _process.Kill();
                _process.WaitForExit(3000);
            }
        }
        catch { }
        _process.Dispose();
    }
}
