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
        try
        {
            using var input = new StreamReader(
                Console.OpenStandardInput(),
                new UTF8Encoding(
                    encoderShouldEmitUTF8Identifier: false,
                    throwOnInvalidBytes: true),
                detectEncodingFromByteOrderMarks: false,
                leaveOpen: false);
            var inputJson = await input.ReadLineAsync();
            if (
                inputJson is null ||
                Encoding.UTF8.GetByteCount(inputJson) >
                    BrokerProtocol.MaximumRequestBytes
            )
            {
                throw new BrokerPolicyException(
                    "broker.invalidRequest",
                    "The broker request is missing or exceeds the size limit.");
            }
            var cancellation = MonitorCancellationAsync(input);
            var request = BrokerProtocol.ParseAndValidate(inputJson);
            var scriptHostPath = Path.Combine(
                AppContext.BaseDirectory,
                "scriptHost.ps1");
            if (!File.Exists(scriptHostPath))
            {
                throw new BrokerPolicyException(
                    "broker.hostMissing",
                    "The PowerShell broker host is unavailable.");
            }

            var diagnostics =
                Environment.GetEnvironmentVariable(
                    "TYPEAGENT_POWERSHELL_BROKER_DIAGNOSTICS") == "1";
            var hostRequestJson = JsonSerializer.Serialize(
                new HostRequest(
                    BrokerProtocol.CurrentVersion,
                    request.Script,
                    request.Parameters.GetRawText(),
                    request.AllowedCommands,
                    request.TimeoutSeconds,
                    diagnostics),
                BrokerJsonContext.Default.HostRequest);

            var (process, _) = AppContainerProcess.Start(
                scriptHostPath,
                hostRequestJson,
                diagnostics);
            BrokerResponse response;
            using (process)
            {
                response = await process.WaitAsync(
                    request.TimeoutSeconds,
                    request.MaxOutputBytes,
                    cancellation);
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
    }

    private static async Task MonitorCancellationAsync(StreamReader input)
    {
        _ = await input.ReadLineAsync();
    }

    private static Task WriteResponseAsync(BrokerResponse response) =>
        Console.Out.WriteAsync(
            JsonSerializer.Serialize(
                response,
                BrokerJsonContext.Default.BrokerResponse));
}
