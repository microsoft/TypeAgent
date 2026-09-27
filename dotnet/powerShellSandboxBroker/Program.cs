// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace TypeAgent.PowerShellSandboxBroker;

internal static class Program
{
    private static async Task<int> Main()
    {
        var stopwatch = Stopwatch.StartNew();
        FileStream? executionLock = null;
        try
        {
            executionLock = await AcquireExecutionLockAsync();
            var input = await ReadRequestAsync();
            var request = BrokerProtocol.ParseAndValidate(input);
            var scriptHostPath = Path.Combine(
                AppContext.BaseDirectory,
                "scriptHost.ps1");
            if (!File.Exists(scriptHostPath))
            {
                throw new BrokerPolicyException(
                    "broker.hostMissing",
                    "The PowerShell broker host is unavailable.");
            }

            var hostRequestJson = JsonSerializer.Serialize(
                new HostRequest(
                    BrokerProtocol.CurrentVersion,
                    request.Script,
                    request.Parameters.GetRawText(),
                    request.AllowedCommands,
                    request.TimeoutSeconds),
                BrokerJsonContext.Default.HostRequest);

            var (process, _) = AppContainerProcess.Start(
                scriptHostPath,
                hostRequestJson);
            BrokerResponse response;
            using (process)
            {
                response = await process.WaitAsync(
                    request.TimeoutSeconds,
                    request.MaxOutputBytes);
            }
            await WriteResponseAsync(response);
            return response.Success ? 0 : 1;
        }
        catch (BrokerPolicyException error)
        {
            stopwatch.Stop();
            await WriteResponseAsync(
                new BrokerResponse(
                    false,
                    "",
                    error.Message,
                    -1,
                    stopwatch.ElapsedMilliseconds,
                    false,
                    false,
                    error.ErrorCode));
            return 2;
        }
        catch (Exception)
        {
            stopwatch.Stop();
            await WriteResponseAsync(
                new BrokerResponse(
                    false,
                    "",
                    "PowerShell broker initialization failed.",
                    -1,
                    stopwatch.ElapsedMilliseconds,
                    false,
                    false,
                    "broker.initializationFailed"));
            return 3;
        }
        finally
        {
            executionLock?.Dispose();
        }
    }

    private static async Task<string> ReadRequestAsync()
    {
        using var input = Console.OpenStandardInput();
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        while (true)
        {
            var count = await input.ReadAsync(chunk);
            if (count == 0)
            {
                break;
            }
            if (buffer.Length + count > BrokerProtocol.MaximumRequestBytes)
            {
                throw new BrokerPolicyException(
                    "broker.requestTooLarge",
                    "The broker request exceeds the size limit.");
            }
            await buffer.WriteAsync(chunk.AsMemory(0, count));
        }
        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    private static async Task<FileStream> AcquireExecutionLockAsync()
    {
        var directory = Path.Combine(
            Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData),
            "TypeAgent");
        Directory.CreateDirectory(directory);
        var lockPath = Path.Combine(
            directory,
            "PowerShellSandboxBroker.lock");
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (true)
        {
            try
            {
                return new FileStream(
                    lockPath,
                    FileMode.OpenOrCreate,
                    FileAccess.ReadWrite,
                    FileShare.None);
            }
            catch (IOException) when (DateTime.UtcNow < deadline)
            {
                await Task.Delay(100);
            }
            catch (IOException)
            {
                throw new BrokerPolicyException(
                    "broker.busy",
                    "The PowerShell sandbox broker is busy.");
            }
        }
    }

    private static Task WriteResponseAsync(BrokerResponse response) =>
        Console.Out.WriteAsync(
            JsonSerializer.Serialize(
                response,
                BrokerJsonContext.Default.BrokerResponse));
}
