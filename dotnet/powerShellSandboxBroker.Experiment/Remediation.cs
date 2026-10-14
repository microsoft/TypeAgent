using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Mxc.Sdk.V1;

namespace TypeAgent.PowerShellSandboxBroker;

internal static class Remediation
{
    internal static async Task<int> VerifyAsync(string output)
    {
        if (Directory.Exists(output)) throw new IOException("Use a new output directory; previous evidence is never overwritten.");
        Directory.CreateDirectory(output);
        var checks = new List<Check>();
        foreach (var (name, action) in new (string, Func<string, Task<List<Check>>>)[]
            { ("ui", UiAsync), ("lifecycle", LifecycleAsync) })
        {
            var directory = Directory.CreateDirectory(Path.Combine(output, name)).FullName;
            try { checks.AddRange(await action(directory)); }
            catch (Exception error) { checks.Add(new Check($"M/{name}-completion", false, error.ToString())); }
        }
        await ExperimentProgram.SaveAsync(output, "checks.json", checks);
        foreach (var check in checks) Console.WriteLine($"{(check.Passed ? "PASS" : "FAIL")} {check.Name}: {check.Detail}");
        Console.WriteLine($"Evidence: {output}");
        return checks.All(check => check.Passed) ? 0 : 1;
    }

    private static async Task<List<Check>> UiAsync(string output)
    {
        var root = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), $"TypeAgent.MxcUi.{Guid.NewGuid():N}")).FullName;
        var marker = $"TypeAgent.Ui.{Guid.NewGuid():N}";
        var window = NativeUi.CreateWindowExW(0, "STATIC", marker, 0, 0, 0, 0, 0, new IntPtr(-3), IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        var atom = NativeUi.GlobalAddAtomW(marker);
        try
        {
            var controlText = new System.Text.StringBuilder(128);
            if (window == IntPtr.Zero || atom == 0 || NativeUi.GetWindowTextW(window, controlText, controlText.Capacity) != marker.Length || NativeUi.GlobalFindAtomW(marker) != atom)
                throw new InvalidOperationException("Owned UI control window/atom must be accessible before testing denial.");
            var host = Directory.CreateDirectory(Path.Combine(root, "host")).FullName;
            var work = Directory.CreateDirectory(Path.Combine(root, "work")).FullName;
            var script = Path.Combine(host, "ui.ps1");
            File.WriteAllText(script, """
                param([long]$Window, [string]$Marker)
                $ErrorActionPreference = 'Stop'
                Add-Type -TypeDefinition @'
                using System;
                using System.Text;
                using System.Runtime.InteropServices;
                public static class UiFixture {
                    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr window, StringBuilder text, int capacity);
                    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern ushort GlobalFindAtomW(string name);
                    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool QueryInformationJobObject(IntPtr job, int information, out uint value, uint size, IntPtr returned);
                }
                '@
                $text = [Text.StringBuilder]::new(128)
                [uint32]$mask = 0
                $queried = [UiFixture]::QueryInformationJobObject([IntPtr]::Zero, 4, [ref]$mask, 4, [IntPtr]::Zero)
                @{ queried = $queried; mask = $mask; externalWindowText = [UiFixture]::GetWindowTextW([IntPtr]$Window, $text, 128);
                   externalAtom = [UiFixture]::GlobalFindAtomW($Marker) } | ConvertTo-Json -Compress
                """);
            var policy = Runner.CreatePolicy($"\"{Runner.PowerShellPath}\" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{script}\" -Window {window.ToInt64()} -Marker \"{marker}\"", host, work);
            var probe = Runner.ValidateProbe(policy);
            using var process = MxcContainer.Spawn(policy, new SpawnOptions { Telemetry = new TelemetryConfig { Enabled = false } });
            var response = await Runner.WaitAsync(process, 10);
            await ExperimentProgram.SaveAsync(output, "observations.json", new { Policy = policy, Probe = probe, Response = response, Warnings = process.Warnings, PositiveControl = controlText.ToString() == marker && NativeUi.GlobalFindAtomW(marker) == atom });
            if (!response.Success || response.Truncated) return [new Check("M/UI-probe-execution", false, "Trusted owned-object probe must run before accepting denials", response)];
            using var json = JsonDocument.Parse(response.Stdout);
            var values = json.RootElement;
            return
            [
                new Check("M/UI-external-owned-window-denied", values.GetProperty("externalWindowText").GetInt32() == 0, "Host positive control succeeds; contained process cannot read the owned outside-job window text", values.Clone()),
                new Check("M/UI-global-owned-atom-denied", values.GetProperty("externalAtom").GetInt32() == 0, "Host positive control succeeds; contained process cannot find the owned global atom", values.Clone()),
                new Check("M/UI-current-job-diagnostic", values.GetProperty("queried").GetBoolean(), "BaseContainer applies UI limits in PSEC; its tree-kill job mask is not an effective PSEC-policy query", values.Clone(), RequiredForCommonBenchmark: false),
                new Check("M/UI-full-control-verification", false, "Not verified: clipboard, input injection, IME, desktop, display/system settings and logoff/shutdown require isolated safe fixtures; no user clipboard, input or desktop mutation performed"),
            ];
        }
        finally
        {
            if (window != IntPtr.Zero) NativeUi.DestroyWindow(window);
            if (atom != 0) NativeUi.GlobalDeleteAtom(atom);
            Directory.Delete(root, recursive: true);
        }
    }

    private static async Task<List<Check>> LifecycleAsync(string output)
    {
        var root = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), $"TypeAgent.MxcLifecycle.{Guid.NewGuid():N}")).FullName;
        int? childPid = null;
        long childTicks = 0;
        try
        {
            var host = Directory.CreateDirectory(Path.Combine(root, "host")).FullName;
            var work = Directory.CreateDirectory(Path.Combine(root, "work")).FullName;
            var script = Path.Combine(host, "lifecycle.ps1");
            File.WriteAllText(script, """
                param([string]$Executable)
                $ErrorActionPreference = 'Stop'
                $info = [Diagnostics.ProcessStartInfo]::new()
                $info.FileName = $Executable
                $info.Arguments = '-NoLogo -NoProfile -NonInteractive -Command "[Console]::WriteLine(''descendant-ready''); Start-Sleep -Seconds 20"'
                $info.UseShellExecute = $false
                $info.CreateNoWindow = $true
                $info.RedirectStandardOutput = $true
                $child = [Diagnostics.Process]::Start($info)
                if ($child.StandardOutput.ReadLine() -ne 'descendant-ready') { throw 'Descendant did not start its body' }
                [Console]::WriteLine("body-ready|$($child.Id)|$($child.StartTime.ToUniversalTime().Ticks)")
                Start-Sleep -Seconds 20
                """);
            var policy = Runner.CreatePolicy($"\"{Runner.PowerShellPath}\" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{script}\" -Executable \"{Runner.PowerShellPath}\"", host, work);
            var probe = Runner.ValidateProbe(policy);
            using var process = MxcContainer.Spawn(policy, new SpawnOptions { Telemetry = new TelemetryConfig { Enabled = false } });
            using var reader = new StreamReader(process.StandardOutput!);
            var ready = await reader.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(8));
            var fields = ready?.Split('|');
            if (fields is not { Length: 3 } || fields[0] != "body-ready") throw new InvalidOperationException("Body-ready marker missing; no cancellation success claimed.");
            childPid = int.Parse(fields[1]);
            childTicks = long.Parse(fields[2]);
            using (var live = Process.GetProcessById(childPid.Value))
                if (live.HasExited || live.StartTime.ToUniversalTime().Ticks != childTicks) throw new InvalidOperationException("Descendant identity not live at cancellation.");
            var stopwatch = Stopwatch.StartNew();
            var response = await Runner.WaitAsync(process, 10, cancelSignal: Task.CompletedTask);
            var cancelledMs = stopwatch.Elapsed.TotalMilliseconds;
            var dead = OwnedChildDead(childPid.Value, childTicks);
            await ExperimentProgram.SaveAsync(output, "observations.json", new { Policy = policy, Probe = probe, Ready = ready, Response = response, CancelledMs = cancelledMs, DescendantDead = dead, Warnings = process.Warnings });
            return
            [
                new Check("M/mid-body-cancellation", response.Cancelled && !response.Success && cancelledMs < 5000, "Cancellation triggered only after root and live descendant entered body; terminal wait/drain bounded", response),
                new Check("M/mid-body-descendant-termination", dead, "Owned descendant PID plus creation-time checked after terminal wait; descendant held redirected output", new { childPid, childTicks, dead }),
                new Check("M/lifecycle-no-teardown-warnings", process.Warnings.Count == 0, "Terminal warnings observed before disposal", process.Warnings),
            ];
        }
        finally
        {
            if (childPid.HasValue && !OwnedChildDead(childPid.Value, childTicks))
            {
                using var child = Process.GetProcessById(childPid.Value);
                if (child.StartTime.ToUniversalTime().Ticks == childTicks) child.Kill(entireProcessTree: true);
            }
            Directory.Delete(root, recursive: true);
        }
    }

    private static bool OwnedChildDead(int pid, long ticks)
    {
        try
        {
            using var child = Process.GetProcessById(pid);
            return child.HasExited || child.StartTime.ToUniversalTime().Ticks != ticks;
        }
        catch (ArgumentException) { return true; }
    }

    internal static async Task<int> CompatibilityAsync(string output, bool stageAtDriveRoot = false)
    {
        if (Directory.Exists(output)) throw new IOException("Use a new output directory; previous evidence is never overwritten.");
        Directory.CreateDirectory(output);
        var root = Directory.CreateDirectory(Path.Combine(stageAtDriveRoot ? Path.GetPathRoot(Environment.CurrentDirectory)! : Path.GetTempPath(), $"TypeAgent.MxcCompatibility.{Guid.NewGuid():N}")).FullName;
        var checks = new List<Check>();
        try
        {
            var host = Directory.CreateDirectory(Path.Combine(root, "host")).FullName;
            var work = Directory.CreateDirectory(Path.Combine(root, "work")).FullName;
            var input = Directory.CreateDirectory(Path.Combine(root, "input")).FullName;
            var ungranted = Directory.CreateDirectory(Path.Combine(root, "ungranted")).FullName;
            var module = Path.Combine(input, "fixture.psm1");
            File.WriteAllText(module, "function Get-ExperimentValue { 'module-ok' }; Export-ModuleMember -Function Get-ExperimentValue");
            File.WriteAllText(Path.Combine(work, "relative.txt"), "relative-ok");
            File.WriteAllText(Path.Combine(ungranted, "canary.txt"), "must-not-read");
            var script = Path.Combine(host, "compatibility.ps1");
            File.WriteAllText(script, """
                param([string]$Work, [string]$InputModule, [string]$Ungrant)
                $ErrorActionPreference = 'Stop'
                $result = [ordered]@{}
                $result.psVersion = $PSVersionTable.PSVersion.ToString()
                $result.nativeCwd = [Environment]::CurrentDirectory
                $result.initialProviderCwd = (Get-Location).Path
                function Observe {
                    param([string]$Name, [scriptblock]$Action)
                    [Console]::Error.WriteLine("begin=$Name")
                    try { $result[$Name] = @{ success = $true; value = (& $Action) } }
                    catch { $result[$Name] = @{ success = $false; error = $_.Exception.Message; type = $_.Exception.GetType().FullName } }
                    [Console]::Error.WriteLine("end=$Name")
                }
                Observe 'absoluteRead' { [IO.File]::ReadAllText([IO.Path]::Combine($Work, 'relative.txt')) }
                Observe 'nativeRelativeRead' { [IO.File]::ReadAllText('relative.txt') }
                Observe 'providerSetLocation' { Set-Location -LiteralPath $Work; (Get-Location).Path }
                Observe 'moduleOnly' { Import-Module -Name $InputModule -Force; Get-ExperimentValue }
                Observe 'rootedDrive' {
                    New-PSDrive -Name Approved -PSProvider FileSystem -Root $Work -Scope Global | Out-Null
                    Set-Location -LiteralPath 'Approved:\'
                          "$((Get-Location).Path)|$((Get-Location).ProviderPath)|$(Get-Content -LiteralPath 'Approved:\relative.txt')|$([Environment]::CurrentDirectory)"
                }
                Observe 'outsideRead' { [IO.File]::ReadAllText([IO.Path]::Combine($Ungrant, 'canary.txt')) }
                Observe 'moduleWrite' { [IO.File]::WriteAllText($InputModule, 'changed') }
                $result | ConvertTo-Json -Depth 8 -Compress
                """);
            var command = $"\"{Runner.PowerShellPath}\" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{script}\" -Work \"{work}\" -InputModule \"{module}\" -Ungrant \"{ungranted}\"";
            var policy = Runner.CreatePolicy(command, host, work, readonlyPaths: [input]);
            ((Containment.ProcessContainer)policy.Containment).CaptureDenials = new CaptureDenialsPolicy
            {
                Mode = CaptureDenialsMode.Block,
                OutputPath = Path.Combine(output, "compatibility-capture.json"),
            };
            var probe = Runner.ValidateProbe(policy);
            using var process = MxcContainer.Spawn(policy, new SpawnOptions { Telemetry = new TelemetryConfig { Enabled = false } });
            var response = await Runner.WaitAsync(process, 10);
            await ExperimentProgram.SaveAsync(output, "observations.json", new
            {
                StartedUtc = DateTimeOffset.UtcNow,
                Environment.OSVersion,
                Runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
                MxcPlatform.NativeVersion,
                HostHash = ExperimentProgram.Hash(await File.ReadAllTextAsync(Runner.HostPath)),
                Script = await File.ReadAllTextAsync(script),
                Policy = policy,
                Probe = probe,
                Response = response,
                Metadata = process.OutputMetadata,
                Warnings = process.Warnings,
            });
            if (!response.Success || response.Truncated)
            {
                await ExperimentProgram.SaveAsync(output, "checks.json", new[]
                {
                    new Check("M/compatibility-completion", false, "Probe did not complete with bounded output; phase markers and terminal response retained", response),
                });
                Console.WriteLine($"FAIL M/compatibility-completion: {response.ErrorCode}; {response.Stderr}");
                Console.WriteLine($"Evidence: {output}");
                return 1;
            }
            using var observations = JsonDocument.Parse(response.Stdout);
            var values = observations.RootElement;
            checks.Add(new Check("M/native-cwd", response.Success && values.GetProperty("nativeCwd").GetString() == work, "OS process cwd must match the approved leaf", values.Clone()));
            foreach (var name in new[] { "absoluteRead", "nativeRelativeRead", "providerSetLocation", "moduleOnly", "rootedDrive" })
            {
                var value = values.GetProperty(name);
                checks.Add(new Check($"M/{name}", value.GetProperty("success").GetBoolean(), "Separate path/provider/module observation; no parent grants", value.Clone(), RequiredForCommonBenchmark: name is "absoluteRead" or "nativeRelativeRead"));
            }
            var drive = values.GetProperty("rootedDrive");
            var fields = drive.GetProperty("success").GetBoolean() ? drive.GetProperty("value").GetString()?.Split('|') : null;
            var parity = drive.GetProperty("success").GetBoolean() &&
                fields is { Length: 4 } && fields[0] == work && fields[1] == work &&
                fields[2] == "relative-ok" && fields[3] == work;
            checks.Add(new Check("M/rooted-drive-contract-parity", parity, "Existing approved-local contract exposes the physical cwd in Get-Location.Path, not a synthetic drive alias", drive.Clone(), RequiredForCommonBenchmark: false));
            foreach (var name in new[] { "outsideRead", "moduleWrite" })
            {
                var value = values.GetProperty(name);
                checks.Add(new Check($"M/{name}-denied", !value.GetProperty("success").GetBoolean(), "Negative resource boundary must remain denied", value.Clone()));
            }
            checks.Add(new Check("M/module-input-unchanged", File.ReadAllText(module).StartsWith("function Get-ExperimentValue", StringComparison.Ordinal), "RO synthetic module unchanged"));
        }
        finally { Directory.Delete(root, recursive: true); }
        checks.Add(new Check("M/compatibility-scratch-cleanup", !Directory.Exists(root), "Owned staging removed after terminal completion"));
        await ExperimentProgram.SaveAsync(output, "checks.json", checks);
        foreach (var check in checks) Console.WriteLine($"{(check.Passed ? "PASS" : "FAIL")} {check.Name}: {check.Detail}");
        Console.WriteLine($"Evidence: {output}");
        return checks.Any(check => !check.Passed && check.RequiredForCommonBenchmark) ? 1 : 0;
    }
}

internal static class NativeUi
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern IntPtr CreateWindowExW(uint extendedStyle, string className, string title, uint style, int left, int top, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern int GetWindowTextW(IntPtr window, System.Text.StringBuilder text, int capacity);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DestroyWindow(IntPtr window);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    internal static extern ushort GlobalAddAtomW(string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    internal static extern ushort GlobalFindAtomW(string name);
    [DllImport("kernel32.dll")]
    internal static extern ushort GlobalDeleteAtom(ushort atom);
}

