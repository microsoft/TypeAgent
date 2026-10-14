using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Microsoft.Mxc.Sdk.V1;

namespace TypeAgent.PowerShellSandboxBroker;

internal sealed record Check(string Name, bool Passed, string Detail, object? Evidence = null, bool RequiredForCommonBenchmark = true);

internal static class Correctness
{
    internal static async Task<List<Check>> RunAsync()
    {
        var checks = new List<Check>();
        foreach (var route in new[] { "H", "A", "M" })
        {
            foreach (var fixture in ExperimentProgram.Fixtures)
                await CaptureAsync(checks, $"{route}/{fixture.Name}", async () =>
                {
                    var sample = await Runner.RunAsync(route, fixture);
                    return new Check($"{route}/{fixture.Name}", sample.Valid, "Exact output, no stderr/truncation, scratch cleaned", sample);
                });
            await CaptureAsync(checks, $"{route}/language", async () =>
            {
                var fixture = EmptyFixture("language", "Write-Output $ExecutionContext.SessionState.LanguageMode", route == "H" ? "FullLanguage" : "ConstrainedLanguage");
                var sample = await Runner.RunAsync(route, fixture);
                return new Check($"{route}/language", sample.Valid, "Observed runspace language mode", sample);
            });
            await CaptureAsync(checks, $"{route}/bounded-output", async () =>
            {
                var sample = await Runner.RunAsync(route, EmptyFixture("flood", "Write-Output ('x' * 100000)"), validate: false);
                return new Check($"{route}/bounded-output", sample.Response.Success && sample.Response.Truncated && sample.Response.Stdout.Length <= 4096 && sample.ScratchRemoved, "100 KB output drained, retained at most 4096 bytes", sample);
            });
            await CaptureAsync(checks, $"{route}/cancel", async () =>
            {
                var sample = await Runner.RunAsync(route, EmptyFixture("sleep", "Start-Sleep -Seconds 20; Write-Output 'late'"), cancel: true, validate: false);
                return new Check($"{route}/cancel", sample.Response.Cancelled && !sample.Response.Success && sample.TotalMs < 5000 && sample.ScratchRemoved, "Explicit cancellation kills process; cleanup bounded by 5 seconds", sample);
            });
            await CaptureAsync(checks, $"{route}/timeout", async () =>
            {
                var sample = await Runner.RunAsync(route, EmptyFixture("sleep", "Start-Sleep -Seconds 20; Write-Output 'late'"), timeoutSeconds: 1, validate: false);
                return new Check($"{route}/timeout", !sample.Response.Success && (sample.Response.ErrorCode == "broker.timeout" || sample.Response.Stderr.Contains("timed out")) && sample.TotalMs < 5000 && sample.ScratchRemoved, "One-second host timeout plus launcher guard", sample);
            });
            if (route != "H") await CaptureAsync(checks, $"{route}/AST-denial", async () =>
            {
                var sample = await Runner.RunAsync(route, EmptyFixture("ast", "Get-Content 'not-a-granted-resource'"), validate: false);
                return new Check($"{route}/AST-denial", !sample.Response.Success && sample.Response.Stderr.Contains("policy denied", StringComparison.OrdinalIgnoreCase), "Host denies unsupported command; not proof of OS filesystem denial", sample);
            });
        }
        await CaptureAsync(checks, "M/OS-boundary", BoundaryAsync);
        await CaptureAsync(checks, "H/M-approved-module-and-cwd", ModuleAsync);
        await CaptureAsync(checks, "H/M-descendant-cleanup", DescendantsAsync);
        await CaptureAsync(checks, "M/fail-closed-unsupported-policy", () =>
        {
            var policy = Runner.CreatePolicy($"\"{Runner.PowerShellPath}\"", AppContext.BaseDirectory, AppContext.BaseDirectory);
            ((Containment.ProcessContainer)policy.Containment).Filesystem = new ProcessContainerFilesystemPolicy
            {
                EnumeratePaths = [AppContext.BaseDirectory],
            };
            try
            {
                Runner.ValidateProbe(policy);
                using var process = MxcContainer.Spawn(policy, new SpawnOptions { Telemetry = new TelemetryConfig { Enabled = false } });
                process.Kill();
                return Task.FromResult(new Check("M/fail-closed-unsupported-policy", false, "Unexpected unsupported enumerate-policy acceptance"));
            }
            catch (Exception error) when (error is MxcException or InvalidOperationException)
            {
                return Task.FromResult(new Check("M/fail-closed-unsupported-policy", true, error.Message));
            }
        });
        return checks;
    }

    private static Fixture EmptyFixture(string name, string script, string expected = "") =>
        new(name, script, JsonSerializer.SerializeToElement(new { }), expected);

    private static async Task CaptureAsync(List<Check> checks, string name, Func<Task<Check>> action)
    {
        try { checks.Add(await action()); }
        catch (Exception error) { checks.Add(new Check(name, false, $"{error.GetType().Name}: {error.Message}")); }
    }

    private static async Task<Check> BoundaryAsync()
    {
        var root = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), $"TypeAgent.MxcBoundary.{Guid.NewGuid():N}")).FullName;
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        try
        {
            var host = Directory.CreateDirectory(Path.Combine(root, "host")).FullName;
            var work = Directory.CreateDirectory(Path.Combine(root, "work")).FullName;
            var readonlyDirectory = Directory.CreateDirectory(Path.Combine(root, "readonly")).FullName;
            var denied = Directory.CreateDirectory(Path.Combine(root, "ungranted")).FullName;
            var input = Path.Combine(readonlyDirectory, "input.txt");
            var secret = Path.Combine(denied, "synthetic-canary.txt");
            File.WriteAllText(input, "synthetic-input");
            File.WriteAllText(secret, "synthetic-canary");
            using (var control = new TcpClient())
            {
                await control.ConnectAsync(IPAddress.Loopback, port);
                using var accepted = await listener.AcceptTcpClientAsync();
            }
            var script = Path.Combine(host, "boundary.ps1");
            File.WriteAllText(script, """
                param([string]$ReadPath, [string]$DeniedPath, [string]$Work, [int]$Port)
                $ErrorActionPreference = 'Stop'
                $result = @{}
                $result.readGranted = [System.IO.File]::ReadAllText($ReadPath) -eq 'synthetic-input'
                try { [System.IO.File]::ReadAllText($DeniedPath) | Out-Null; $result.readDenied = $false } catch { $result.readDenied = $true }
                try { [System.IO.File]::WriteAllText($ReadPath, 'changed'); $result.readonlyWriteDenied = $false } catch { $result.readonlyWriteDenied = $true }
                $output = [System.IO.Path]::Combine($Work, 'output.txt')
                [System.IO.File]::WriteAllText($output, 'synthetic-output')
                $result.writeGranted = [System.IO.File]::ReadAllText($output) -eq 'synthetic-output'
                $client = [System.Net.Sockets.TcpClient]::new()
                try {
                    $connect = $client.ConnectAsync('127.0.0.1', $Port)
                    if (-not $connect.Wait(2000)) { $result.networkDenied = $true }
                    else { $result.networkDenied = -not $client.Connected }
                } catch { $result.networkDenied = $true } finally { $client.Dispose() }
                $result.environmentClean = $null -eq [Environment]::GetEnvironmentVariable('TYPEAGENT_EXPERIMENT_CANARY')
                $result | ConvertTo-Json -Compress
                """);
            var command = $"\"{Runner.PowerShellPath}\" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{script}\" -ReadPath \"{input}\" -DeniedPath \"{secret}\" -Work \"{work}\" -Port {port}";
            var policy = Runner.CreatePolicy(command, host, work, readonlyPaths: [readonlyDirectory]);
            var probe = Runner.ValidateProbe(policy);
            var previous = Environment.GetEnvironmentVariable("TYPEAGENT_EXPERIMENT_CANARY");
            Environment.SetEnvironmentVariable("TYPEAGENT_EXPERIMENT_CANARY", "synthetic-not-a-secret");
            BrokerResponse response;
            try
            {
                using var process = MxcContainer.Spawn(policy, new SpawnOptions { Telemetry = new TelemetryConfig { Enabled = false } });
                response = await Runner.WaitAsync(process, 10);
            }
            finally { Environment.SetEnvironmentVariable("TYPEAGENT_EXPERIMENT_CANARY", previous); }
            using var json = JsonDocument.Parse(response.Stdout);
            var passed = response.Success && json.RootElement.EnumerateObject().All(property => property.Value.ValueKind == JsonValueKind.True) &&
                json.RootElement.EnumerateObject().Count() == 6 && File.ReadAllText(input) == "synthetic-input";
            return new Check("M/OS-boundary", passed, "Trusted standalone FullLanguage probe bypasses AST: RO/RW grants, ungranted canary denial, RO write denial, reachable loopback denied, inherited environment excluded", new { probe, response });
        }
        finally { listener.Stop(); Directory.Delete(root, recursive: true); }
    }

    private static async Task<Check> ModuleAsync()
    {
        var root = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), $"TypeAgent.MxcModule.{Guid.NewGuid():N}")).FullName;
        try
        {
            var module = Path.Combine(root, "fixture.psm1");
            File.WriteAllText(module, "function Get-ExperimentValue { 'module-ok' }; Export-ModuleMember -Function Get-ExperimentValue");
            var fixture = EmptyFixture("approved-module", "Write-Output \"$(Get-ExperimentValue)|$((Get-Location).Path)\"", $"module-ok|{root}");
            var host = await Runner.RunAsync("H", fixture, workingDirectory: root, modules: [module]);
            var mxc = await Runner.RunAsync("M", fixture, fullLanguage: true, workingDirectory: root, modules: [module], readonlyPaths: [root]);
            return new Check("H/M-approved-module-and-cwd", host.Valid && mxc.Valid, "Explicit synthetic module import and working directory; separate FullLanguage compatibility variant, not timed H/A/M subset; A contract denies modules; failure blocks adoption, not measurement of successful common fixtures", new { host, mxc }, RequiredForCommonBenchmark: false);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    private static async Task<Check> DescendantsAsync()
    {
        var evidence = new List<object>();
        var passed = true;
        foreach (var route in new[] { "H", "M" })
        {
            var script = """
                param([string]$Executable)
                $info = [System.Diagnostics.ProcessStartInfo]::new()
                $info.FileName = $Executable
                $info.Arguments = '-NoLogo -NoProfile -NonInteractive -Command Start-Sleep -Seconds 20'
                $info.UseShellExecute = $false
                $info.CreateNoWindow = $true
                $child = [System.Diagnostics.Process]::Start($info)
                Write-Output "$($child.Id)|$($child.StartTime.ToUniversalTime().Ticks)"
                """;
            var fixture = new Fixture("descendant", script, JsonSerializer.SerializeToElement(new { Executable = Runner.PowerShellPath }), "");
            var sample = route == "H" ? await Runner.RunAsync(route, fixture, validate: false) : await StandaloneDescendantAsync(script);
            var fields = sample.Response.Stdout.Trim().Split('|');
            var dead = false;
            if (sample.Response.Success && fields.Length == 2 && int.TryParse(fields[0], out var pid) && long.TryParse(fields[1], out var ticks))
            {
                try
                {
                    using var child = Process.GetProcessById(pid);
                    dead = child.HasExited || child.StartTime.ToUniversalTime().Ticks != ticks;
                    if (!dead) child.Kill(entireProcessTree: true);
                }
                catch (ArgumentException) { dead = true; }
            }
            passed &= dead && sample.ScratchRemoved;
            evidence.Add(new { route, dead, sample });
        }
        return new Check("H/M-descendant-cleanup", passed, "Child PID/start-time identity checked after cleanup; a surviving owned child is killed and the check fails", evidence);
    }

    private static async Task<Sample> StandaloneDescendantAsync(string script)
    {
        var root = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), $"TypeAgent.MxcChild.{Guid.NewGuid():N}")).FullName;
        BrokerResponse response;
        string? tier;
        string[] warnings;
        var stopwatch = Stopwatch.StartNew();
        try
        {
            var host = Directory.CreateDirectory(Path.Combine(root, "host")).FullName;
            var work = Directory.CreateDirectory(Path.Combine(root, "work")).FullName;
            var path = Path.Combine(host, "descendant.ps1");
            File.WriteAllText(path, script);
            var command = $"\"{Runner.PowerShellPath}\" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{path}\" -Executable \"{Runner.PowerShellPath}\"";
            var policy = Runner.CreatePolicy(command, host, work);
            tier = Runner.ValidateProbe(policy).Tier?.ToString();
            using var process = MxcContainer.Spawn(policy, new SpawnOptions { Telemetry = new TelemetryConfig { Enabled = false } });
            response = await Runner.WaitAsync(process, 10);
            warnings = process.Warnings.ToArray();
        }
        finally { Directory.Delete(root, recursive: true); }
        return new Sample("M", "standalone-descendant", "check", 0, response.Success, stopwatch.Elapsed.TotalMilliseconds,
            0, 0, 0, response, tier, warnings, !Directory.Exists(root));
    }
}
