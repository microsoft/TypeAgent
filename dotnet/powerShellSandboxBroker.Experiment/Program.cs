using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Mxc.Sdk.V1;
using Microsoft.Win32;

namespace TypeAgent.PowerShellSandboxBroker;

internal static class ExperimentProgram
{
    private static readonly string[] Routes = ["H", "A", "M"];
    private static readonly string[] Baselines = ["H", "A"];
    private static readonly string[] MeasuredPhases = ["cold", "warm"];
    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    private static async Task<int> Main(string[] args)
    {
        try
        {
            if (args is ["--published-smoke"])
            {
                var sample = await Runner.RunAsync("M", Fixtures[0]);
                Console.WriteLine(JsonSerializer.Serialize(sample.Response, BrokerJsonContext.Default.BrokerResponse));
                return sample.Valid && sample.Tier == "BaseContainer" && sample.Warnings.Length == 0 ? 0 : 1;
            }
            if (args is ["--compatibility", var compatibilityOutput])
                return await Remediation.CompatibilityAsync(Path.GetFullPath(compatibilityOutput));
            if (args is ["--compatibility-staged", var stagedOutput])
                return await Remediation.CompatibilityAsync(Path.GetFullPath(stagedOutput), stageAtDriveRoot: true);
            if (args is ["--verify-adoption", var verificationOutput])
                return await Remediation.VerifyAsync(Path.GetFullPath(verificationOutput));
            if (args is ["--diagnose", var capturePath])
            {
                Console.WriteLine(JsonSerializer.Serialize(await Runner.RunAsync("M", Fixtures[0],
                    capturePath: Path.GetFullPath(capturePath), allowWin32k: false), JsonOptions));
                return 0;
            }
            if (args is ["--diagnose-win32k", var diagnosticPath])
            {
                Console.WriteLine(JsonSerializer.Serialize(await Runner.RunAsync("M", Fixtures[0],
                    capturePath: Path.GetFullPath(diagnosticPath), allowWin32k: true), JsonOptions));
                return 0;
            }
            if (args is ["--sample", var route, var fixtureName])
            {
                var fixture = Fixtures.Single(item => item.Name == fixtureName);
                Console.WriteLine(JsonSerializer.Serialize(await Runner.RunAsync(route, fixture), JsonOptions));
                return 0;
            }
            if (args.Length == 0 || args is ["--probe"])
            {
                Console.WriteLine(JsonSerializer.Serialize(Discovery(), JsonOptions));
                return 0;
            }
            if (args.Length != 2 || args[0] is not ("--check" or "--run"))
                throw new ArgumentException("Use --probe, --published-smoke, or --check/--run/--compatibility/--compatibility-staged/--verify-adoption <new-output-directory>.");
            var output = Path.GetFullPath(args[1]);
            if (Directory.Exists(output)) throw new IOException("Use a new output directory; previous evidence is never overwritten.");
            Directory.CreateDirectory(output);
            using var identity = WindowsIdentity.GetCurrent();
            using var os = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            using var cpu = Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0");
            await SaveAsync(output, "metadata.json", new
            {
                StartedUtc = DateTimeOffset.UtcNow,
                GitRevision = await ReadProcessAsync("git", ["rev-parse", "HEAD"]),
                OsBuild = $"{os?.GetValue("CurrentBuild")}.{os?.GetValue("UBR")}",
                Cpu = cpu?.GetValue("ProcessorNameString"),
                Environment.ProcessorCount,
                Runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
                Architecture = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString(),
                Elevated = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator),
                TokenSidHash = Hash(identity.User!.Value),
                PowerShell = Runner.PowerShellPath,
                PowerShellFileVersion = FileVersionInfo.GetVersionInfo(Runner.PowerShellPath).FileVersion,
                DotnetSdk = await ReadProcessAsync("dotnet", ["--version"]),
                PowerShellHash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(Runner.PowerShellPath))),
                ScriptHostHash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(Runner.HostPath))),
                HarnessAssemblyHash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(Assembly.GetExecutingAssembly().Location))),
                MxcAssemblyHash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(typeof(MxcContainer).Assembly.Location))),
                Discovery = Discovery(),
                Fixtures = Fixtures.Select(item => new { item.Name, item.Script, item.Parameters, item.Expected, Hash = Hash(item.Script + item.Parameters.GetRawText()) }),
                Policy = Runner.PolicyDescription,
                PolicyHash = Hash(JsonSerializer.Serialize(Runner.PolicyDescription)),
                Timing = "Warm: validation/serialization through result validation and cleanup in a persistent harness, fresh child each run. Cold: same plus a fresh harness process. No OS/cache reset.",
                Seed = 20261013,
                ColdCount = 10,
                WarmupCount = 5,
                WarmCount = 100,
                Diagnostics = "off; telemetry disabled per MXC spawn",
                DiagnosticVariant = "minimal M fixture; interleaved block-mode capture off/on, 5 excluded warmups and 100 measured pairs after main comparison",
                LatencyBudget = "not agreed; measurements only, no adoption gate",
            });
            var checks = await Correctness.RunAsync();
            await SaveAsync(output, "checks.json", checks);
            foreach (var check in checks) Console.WriteLine($"{(check.Passed ? "PASS" : check.RequiredForCommonBenchmark ? "FAIL" : "UNSUPPORTED")} {check.Name}: {check.Detail}");
            if (checks.Any(check => !check.Passed && check.RequiredForCommonBenchmark))
                throw new InvalidOperationException("Correctness failed; benchmark withheld. See checks.json. No fallback.");
            if (args[0] == "--run") await BenchmarkAsync(output);
            Console.WriteLine($"Evidence: {output}");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"MXC unavailable; no fallback: {error.GetType().Name}: {error.Message}");
            return 1;
        }
    }

    internal static readonly Fixture[] Fixtures =
    [
        new("minimal", "Write-Output 'ready'", JsonDocument.Parse("{}").RootElement.Clone(), "ready"),
        new("json", "param([string]$Payload) $items = ConvertFrom-Json $Payload; Write-Output (($items | Sort-Object score | Select-Object -ExpandProperty name) -join ',')",
            JsonDocument.Parse("""{"Payload":"[{\"name\":\"alpha\",\"score\":2},{\"name\":\"beta\",\"score\":1},{\"name\":\"gamma\",\"score\":3}]"}""").RootElement.Clone(), "beta,alpha,gamma"),
        new("cpu", "param([int]$Count) $sum = 0; for ($index = 1; $index -le $Count; $index++) { $sum += $index }; Write-Output $sum",
            JsonDocument.Parse("""{"Count":20000}""").RootElement.Clone(), "200010000"),
        new("typed", "param([string]$Text, [int]$Count) Write-Output \"$Text|$Count\"",
            JsonDocument.Parse("""{"Text":"literal'; Write-Output 'INJECTED","Count":17}""").RootElement.Clone(), "literal'; Write-Output 'INJECTED|17"),
    ];

    private static object Discovery() => new
    {
        MxcPlatform.NativeVersion,
        Support = MxcPlatform.GetPlatformSupport(),
        Backends = MxcPlatform.GetAvailableBackends(),
        Probe = MxcContainer.Probe(),
    };

    internal static Task SaveAsync(string directory, string name, object value) =>
        File.WriteAllTextAsync(Path.Combine(directory, name), JsonSerializer.Serialize(value, JsonOptions) + "\n", new UTF8Encoding(false));

    internal static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private static async Task BenchmarkAsync(string output)
    {
        var random = new Random(20261013);
        var samples = new List<Sample>();
        await using var raw = new StreamWriter(Path.Combine(output, "samples.jsonl"), false, new UTF8Encoding(false));
        foreach (var (phase, count) in new[] { ("cold", 10), ("warmup", 5), ("warm", 100) })
        {
            for (var block = 0; block < count; block++)
            {
                var order = (from route in Routes from fixture in Fixtures select (route, fixture)).ToArray();
                random.Shuffle(order);
                foreach (var (route, fixture) in order)
                {
                    var sample = phase == "cold" ? await ColdAsync(route, fixture) : await Runner.RunAsync(route, fixture);
                    sample = sample with { Phase = phase, Block = block };
                    await raw.WriteLineAsync(JsonSerializer.Serialize(sample));
                    await raw.FlushAsync();
                    if (!sample.Valid) throw new InvalidOperationException($"Invalid benchmark sample: {route}/{fixture.Name}; raw evidence retained, no successful-run comparison emitted.");
                    samples.Add(sample);
                }
                if (block % 10 == 0 || block == count - 1) Console.WriteLine($"{phase}: {block + 1}/{count} blocks complete");
            }
        }
        var summaries = samples.Where(sample => sample.Phase != "warmup")
            .GroupBy(sample => (sample.Phase, sample.Fixture, sample.Route))
            .Select(group => new
            {
                group.Key.Phase,
                group.Key.Fixture,
                group.Key.Route,
                Count = group.Count(),
                P50Ms = Quantile(group.Select(sample => sample.TotalMs), 0.5),
                P95Ms = Quantile(group.Select(sample => sample.TotalMs), 0.95),
                MinMs = group.Min(sample => sample.TotalMs),
                MaxMs = group.Max(sample => sample.TotalMs),
            }).ToArray();
        var deltas = (from phase in MeasuredPhases
                      from fixture in Fixtures
                      from baseline in Baselines
                      let measured = samples.Where(sample => sample.Phase == phase && sample.Fixture == fixture.Name).ToArray()
                      let mxc = summaries.Single(item => item.Phase == phase && item.Fixture == fixture.Name && item.Route == "M")
                      let reference = summaries.Single(item => item.Phase == phase && item.Fixture == fixture.Name && item.Route == baseline)
                      let pairs = measured.Where(sample => sample.Route == "M").Select(sample => sample.TotalMs - measured.Single(other => other.Route == baseline && other.Block == sample.Block).TotalMs).ToArray()
                      select new
                      {
                          Phase = phase,
                          Fixture = fixture.Name,
                          Baseline = baseline,
                          P50DeltaMs = mxc.P50Ms - reference.P50Ms,
                          P50DeltaPercent = 100 * (mxc.P50Ms - reference.P50Ms) / reference.P50Ms,
                          P95DeltaMs = mxc.P95Ms - reference.P95Ms,
                          P95DeltaPercent = 100 * (mxc.P95Ms - reference.P95Ms) / reference.P95Ms,
                          PairedMedianDeltaMs = Quantile(pairs, 0.5),
                          PairedP05DeltaMs = Quantile(pairs, 0.05),
                          PairedP95DeltaMs = Quantile(pairs, 0.95),
                      }).ToArray();
        await SaveAsync(output, "summary.json", new { Routes = summaries, Deltas = deltas });
        Console.WriteLine(JsonSerializer.Serialize(new { Routes = summaries.Where(item => item.Phase == "warm"), Deltas = deltas.Where(item => item.Phase == "warm") }, JsonOptions));
        await DiagnosticBenchmarkAsync(output, random);
    }

    private static async Task DiagnosticBenchmarkAsync(string output, Random random)
    {
        var samples = new List<Sample>();
        var captureDirectory = Directory.CreateDirectory(Path.Combine(output, "capture")).FullName;
        await using var raw = new StreamWriter(Path.Combine(output, "diagnostic-samples.jsonl"), false, new UTF8Encoding(false));
        for (var block = 0; block < 105; block++)
        {
            var order = new[] { false, true };
            random.Shuffle(order);
            foreach (var capture in order)
            {
                var path = capture ? Path.Combine(captureDirectory, $"block-{block}.json") : null;
                var sample = await Runner.RunAsync("M", Fixtures[0], capturePath: path);
                sample = sample with { Route = capture ? "capture-on" : "capture-off", Phase = block < 5 ? "warmup" : "warm", Block = block };
                await raw.WriteLineAsync(JsonSerializer.Serialize(sample));
                await raw.FlushAsync();
                if (!sample.Valid || capture && sample.CaptureMetadata?.CaptureDenials is null)
                    throw new InvalidOperationException("Enforcing capture variant failed; no diagnostic summary emitted.");
                if (block >= 5) samples.Add(sample);
            }
            if (block % 20 == 0 || block == 104) Console.WriteLine($"Enforcing capture comparison: {block + 1}/105 blocks complete");
        }
        var summaries = samples.GroupBy(sample => sample.Route).Select(group => new
        {
            Route = group.Key,
            Count = group.Count(),
            P50Ms = Quantile(group.Select(sample => sample.TotalMs), 0.5),
            P95Ms = Quantile(group.Select(sample => sample.TotalMs), 0.95),
        }).ToArray();
        var enabled = summaries.Single(item => item.Route == "capture-on");
        var disabled = summaries.Single(item => item.Route == "capture-off");
        var pairs = samples.Where(sample => sample.Route == "capture-on").Select(sample => sample.TotalMs - samples.Single(other => other.Route == "capture-off" && other.Block == sample.Block).TotalMs).ToArray();
        var summary = new
        {
            Routes = summaries,
            P50DeltaMs = enabled.P50Ms - disabled.P50Ms,
            P95DeltaMs = enabled.P95Ms - disabled.P95Ms,
            P50DeltaPercent = 100 * (enabled.P50Ms - disabled.P50Ms) / disabled.P50Ms,
            P95DeltaPercent = 100 * (enabled.P95Ms - disabled.P95Ms) / disabled.P95Ms,
            PairedMedianDeltaMs = Quantile(pairs, 0.5),
            PairedP05DeltaMs = Quantile(pairs, 0.05),
            PairedP95DeltaMs = Quantile(pairs, 0.95),
        };
        await SaveAsync(output, "diagnostic-summary.json", summary);
        Console.WriteLine(JsonSerializer.Serialize(summary, JsonOptions));
    }

    private static double Quantile(IEnumerable<double> values, double fraction)
    {
        var ordered = values.Order().ToArray();
        var position = (ordered.Length - 1) * fraction;
        var lower = (int)position;
        return ordered[lower] + (ordered[(int)Math.Ceiling(position)] - ordered[lower]) * (position - lower);
    }

    private static async Task<Sample> ColdAsync(string route, Fixture fixture)
    {
        var stopwatch = Stopwatch.StartNew();
        var arguments = new List<string>();
        var executable = Environment.ProcessPath!;
        if (Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
            arguments.Add(Assembly.GetExecutingAssembly().Location);
        arguments.AddRange(["--sample", route, fixture.Name]);
        var json = await ReadProcessAsync(executable, arguments);
        var sample = JsonSerializer.Deserialize<Sample>(json)!;
        return sample with { TotalMs = stopwatch.Elapsed.TotalMilliseconds };
    }

    private static async Task<string> ReadProcessAsync(string executable, IEnumerable<string> arguments)
    {
        var info = new ProcessStartInfo(executable) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var argument in arguments) info.ArgumentList.Add(argument);
        using var process = Process.Start(info)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(60)); }
        catch { process.Kill(entireProcessTree: true); throw; }
        var error = await stderr;
        if (process.ExitCode != 0) throw new InvalidOperationException($"Child failed: {error}");
        return (await stdout).Trim();
    }
}

internal sealed record Fixture(string Name, string Script, JsonElement Parameters, string Expected);

internal sealed record Sample(string Route, string Fixture, string Phase, int Block, bool Valid,
    double TotalMs, double PrepareAndLaunchMs, double ExecutionAndDrainMs, double CleanupMs,
    BrokerResponse Response, string? Tier, string[] Warnings, bool ScratchRemoved,
    ExecutionMetadata? CaptureMetadata = null);
