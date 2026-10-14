using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Microsoft.Mxc.Sdk.V1;

namespace TypeAgent.PowerShellSandboxBroker;

internal static class Runner
{
    internal static readonly string PowerShellPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
    internal static readonly string HostPath = Path.Combine(AppContext.BaseDirectory, "scriptHost.ps1");
    private static readonly Task Never = new TaskCompletionSource().Task;
    private static readonly string[] Commands = ["Write-Output", "ConvertFrom-Json", "Sort-Object", "Select-Object", "Start-Sleep"];

    internal static object PolicyDescription => new
    {
        M = "Explicit ProcessContainer, LearningMode=false, no capabilities, no DACL augmentation; RO private host/request and Windows runtime directories; RW unique scratch only; deny ingress/egress/loopback; no inherited environment; Win32k allowed for Windows PowerShell startup, clipboard/input/external-handles/global-atoms/desktop/system-setting/IME restrictions retained; telemetry off.",
        A = "Unmodified existing v1 AppContainer launcher, no capabilities, one-process job, constrained language and same allowed commands; profile contains writable host/request.",
        H = "Unmodified existing v2 current-user launcher and full language; existing allowlisted host environment; NOT containment-equivalent.",
        RuntimeReadonlyPaths = RuntimePaths(),
        OutputBytesPerStream = 4096,
        TimeoutSeconds = 10,
        PhaseCaveat = "PrepareAndLaunch includes native staging for H/A and explicit staging plus request probe for M. No comparable host-ready/script-body markers; do not infer native-only overhead.",
    };

    internal static async Task<Sample> RunAsync(string route, Fixture fixture, int timeoutSeconds = 10,
        bool cancel = false, bool validate = true, bool fullLanguage = false,
        string? workingDirectory = null, string[]? modules = null, string[]? readonlyPaths = null,
        string? capturePath = null, bool allowWin32k = true)
    {
        if (route is not ("H" or "A" or "M")) throw new ArgumentException("Unknown route; no fallback.");
        var stopwatch = Stopwatch.StartNew();
        var approved = route == "H" || fullLanguage;
        var request = new BrokerRequest(approved ? 2 : 1, fixture.Script, fixture.Parameters, Commands,
            timeoutSeconds, 4096, "trusted-experiment-fixture", approved,
            approved ? workingDirectory ?? AppContext.BaseDirectory : null, modules);
        request = BrokerProtocol.ParseAndValidate(JsonSerializer.Serialize(request, BrokerJsonContext.Default.BrokerRequest));
        var hostRequest = new HostRequest(request.ProtocolVersion, request.Script, request.Parameters.GetRawText(),
            request.AllowedCommands, request.TimeoutSeconds, false, request.ApprovedLocal, request.WorkingDirectory, request.RequiredModules);
        var json = JsonSerializer.Serialize(hostRequest, BrokerJsonContext.Default.HostRequest);
        BrokerResponse response;
        double launchMs;
        double resultMs;
        string? tier = null;
        string[] warnings = [];
        ExecutionMetadata? captureMetadata = null;
        string scratch;
        if (route == "M")
        {
            scratch = Path.Combine(Path.GetTempPath(), $"TypeAgent.MxcExperiment.{Guid.NewGuid():N}");
            Directory.CreateDirectory(scratch);
            try
            {
                var hostDirectory = Directory.CreateDirectory(Path.Combine(scratch, "host")).FullName;
                var work = Directory.CreateDirectory(Path.Combine(scratch, "work")).FullName;
                var host = Path.Combine(hostDirectory, "scriptHost.ps1");
                var input = Path.Combine(hostDirectory, "request.json");
                File.Copy(HostPath, host);
                File.WriteAllText(input, json, new UTF8Encoding(false));
                var command = $"\"{PowerShellPath}\" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{host}\" -RequestPath \"{input}\"";
                var policy = CreatePolicy(command, hostDirectory, work, timeoutSeconds, readonlyPaths);
                policy.Ui!.Disable = !allowWin32k;
                if (capturePath is not null)
                    ((Containment.ProcessContainer)policy.Containment).CaptureDenials = new CaptureDenialsPolicy
                    {
                        Mode = CaptureDenialsMode.Block,
                        OutputPath = capturePath,
                    };
                if (fullLanguage) policy.WorkingDirectory = request.WorkingDirectory;
                var probe = ValidateProbe(policy);
                tier = probe.Tier?.ToString();
                using (var process = MxcContainer.Spawn(policy, new SpawnOptions { Telemetry = new TelemetryConfig { Enabled = false } }))
                {
                    launchMs = stopwatch.Elapsed.TotalMilliseconds;
                    response = await WaitAsync(process, timeoutSeconds, cancel);
                    warnings = probe.Warnings.Concat(process.Warnings).ToArray();
                    captureMetadata = process.OutputMetadata;
                    resultMs = stopwatch.Elapsed.TotalMilliseconds;
                }
            }
            finally { Directory.Delete(scratch, recursive: true); }
        }
        else
        {
            var started = PowerShellProcess.Start(HostPath, json, false, approved, request.WorkingDirectory);
            scratch = started.ProfilePath;
            using (started.Process)
            {
                launchMs = stopwatch.Elapsed.TotalMilliseconds;
                response = await started.Process.WaitAsync(timeoutSeconds, request.MaxOutputBytes, cancel ? Task.Delay(200) : Never);
                resultMs = stopwatch.Elapsed.TotalMilliseconds;
            }
        }
        var scratchRemoved = !Directory.Exists(scratch) || !Directory.EnumerateFileSystemEntries(scratch).Any();
        var valid = !validate || response.Success && !response.Truncated && !response.Cancelled &&
            string.IsNullOrWhiteSpace(response.Stderr) && response.Stdout.Trim() == fixture.Expected;
        var total = stopwatch.Elapsed.TotalMilliseconds;
        return new Sample(route, fixture.Name, "check", 0, valid && scratchRemoved, total,
            launchMs, resultMs - launchMs, total - resultMs, response, tier, warnings, scratchRemoved, captureMetadata);
    }

    internal static ContainerRequest CreatePolicy(string command, string hostDirectory, string work,
        int timeoutSeconds = 10, string[]? readonlyPaths = null) => new(command)
        {
            Containment = new Containment.ProcessContainer { LearningMode = false, Capabilities = [] },
            Filesystem = new FilesystemPolicy
            {
                ReadonlyPaths = RuntimePaths().Concat([hostDirectory]).Concat(readonlyPaths ?? []).ToList(),
                ReadwritePaths = [work],
                ClearPolicyOnExit = true,
            },
            Network = new NetworkPolicy
            {
                Egress = new NetworkEgressPolicy { Default = NetworkAction.Deny },
                Ingress = new NetworkIngressPolicy { Default = NetworkAction.Deny, HostLoopback = NetworkAction.Deny },
            },
            Ui = new UiPolicy { Disable = false, Clipboard = ClipboardPolicy.None, AllowInputInjection = false },
            WorkingDirectory = work,
            TimeoutMs = checked((uint)(timeoutSeconds + 2) * 1000),
            InheritDefaultEnvironment = false,
            Environment = new Dictionary<string, string>
            {
                ["COMSPEC"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe"),
                ["SYSTEMROOT"] = Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                ["WINDIR"] = Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                ["LOCALAPPDATA"] = work, ["USERPROFILE"] = work, ["TEMP"] = work, ["TMP"] = work,
                ["POWERSHELL_TELEMETRY_OPTOUT"] = "1",
            },
        };

    internal static ProbeOutput ValidateProbe(ContainerRequest policy)
    {
        var probe = MxcContainer.Probe(policy);
        if (probe.Error is not null || probe.Tier is null || probe.NeedsDaclAugmentation == true)
            throw new InvalidOperationException($"Requested containment unavailable; no fallback or ACL changes: {JsonSerializer.Serialize(probe, ExperimentProgram.JsonOptions)}");
        return probe;
    }

    private static string[] RuntimePaths() =>
    [
        Environment.GetFolderPath(Environment.SpecialFolder.System),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Microsoft.NET"),
    ];

    internal static async Task<BrokerResponse> WaitAsync(MxcProcess process, int timeoutSeconds, bool cancel = false, Task? cancelSignal = null)
    {
        var stopwatch = Stopwatch.StartNew();
        process.StandardInput?.Dispose();
        var stdout = DrainAsync(process.StandardOutput);
        var stderr = DrainAsync(process.StandardError);
        var wait = process.WaitAsync();
        var timeout = Task.Delay(TimeSpan.FromSeconds(timeoutSeconds + 2));
        var cancellation = cancelSignal ?? (cancel ? Task.Delay(200) : Never);
        var completed = await Task.WhenAny(wait, timeout, cancellation);
        var cancelled = completed == cancellation;
        var timedOut = completed == timeout;
        if (cancelled || timedOut) process.Kill();
        var result = await wait.WaitAsync(TimeSpan.FromSeconds(5));
        var output = await stdout.WaitAsync(TimeSpan.FromSeconds(5));
        var error = await stderr.WaitAsync(TimeSpan.FromSeconds(5));
        timedOut |= result.TimedOut;
        return new BrokerResponse(!cancelled && !timedOut && result.ExitCode == 0,
            output.Text, error.Text, result.ExitCode, stopwatch.ElapsedMilliseconds,
            output.Truncated || error.Truncated, cancelled,
            cancelled ? "broker.cancelled" : timedOut ? "broker.timeout" : null);
    }

    private static async Task<(string Text, bool Truncated)> DrainAsync(Stream? stream)
    {
        if (stream is null) return ("", false);
        var buffer = new byte[8192];
        using var retained = new MemoryStream();
        var truncated = false;
        while (true)
        {
            var count = await stream.ReadAsync(buffer);
            if (count == 0) break;
            var remaining = 4096 - (int)retained.Length;
            retained.Write(buffer, 0, Math.Min(count, remaining));
            truncated |= count > remaining;
        }
        return (Encoding.UTF8.GetString(retained.ToArray()), truncated);
    }
}
