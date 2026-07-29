// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// randomstub - a tiny, dependency-free demo CLI for TypeAgent Studio onboarding.
//
// Purpose: give the onboarding pipeline a real, self-contained tool to exercise
// end to end, offline. The Discovery phase (crawlCliHelp) reads the `--help`
// surface; the generated agent can then actually invoke a subcommand and get a
// real answer (e.g. "give me a random number between 1 and 10"), so the
// "Try it" step proves the agent runs rather than just parses help.
//
// Two invocation shapes:
//   randomstub --help            -> top-level help with a "Commands:" section
//   randomstub <sub> --help      -> per-subcommand help with a "Flags:" section
//   randomstub <sub> [flags]     -> actually runs and prints a result
//
// IMPORTANT: help text must use LF ("\n") line endings. The crawler's
// subcommand parser only recognises the "Commands:" block when its lines are
// LF-separated; Windows CRLF makes it see just the first entry. .NET defaults
// Console newlines to Environment.NewLine (CRLF on Windows), so we force LF.
Console.Out.NewLine = "\n";

// The crawler appends a help flag; route on the first non-flag argument.
string? sub = args.FirstOrDefault(a => !a.StartsWith('-'));
bool wantsHelp = args.Contains("--help") || args.Contains("-h");

return sub switch
{
    null => TopHelp(),
    "number" => wantsHelp ? NumberHelp() : RunNumber(),
    "dice" => wantsHelp ? DiceHelp() : RunDice(),
    "pick" => wantsHelp ? PickHelp() : RunPick(),
    _ => Unknown(sub),
};

// ── Help text ────────────────────────────────────────────────────────────────

int TopHelp()
{
    Console.WriteLine("randomstub - a tiny demo randomness CLI");
    Console.WriteLine();
    Console.WriteLine("USAGE");
    Console.WriteLine("  randomstub <command> [flags]");
    Console.WriteLine();
    Console.WriteLine("Commands:");
    Console.WriteLine("  number   Generate a random integer between a minimum and maximum");
    Console.WriteLine("  dice     Roll one or more dice and report the rolls and their total");
    Console.WriteLine("  pick     Pick a random item from a comma-separated list of choices");
    return 0;
}

int NumberHelp()
{
    Console.WriteLine("randomstub number - Generate a random integer between a minimum and maximum");
    Console.WriteLine();
    Console.WriteLine("USAGE");
    Console.WriteLine("  randomstub number --min <n> --max <m> [--seed <s>]");
    Console.WriteLine();
    Console.WriteLine("Flags:");
    Console.WriteLine("  --min    integer   Inclusive lower bound (required)");
    Console.WriteLine("  --max    integer   Inclusive upper bound (required)");
    Console.WriteLine("  --seed   integer   Optional seed for reproducible output");
    return 0;
}

int DiceHelp()
{
    Console.WriteLine("randomstub dice - Roll one or more dice and report the rolls and their total");
    Console.WriteLine();
    Console.WriteLine("USAGE");
    Console.WriteLine("  randomstub dice [--sides <n>] [--count <k>] [--seed <s>]");
    Console.WriteLine();
    Console.WriteLine("Flags:");
    Console.WriteLine("  --sides  integer   Number of sides per die (default 6)");
    Console.WriteLine("  --count  integer   Number of dice to roll (default 1)");
    Console.WriteLine("  --seed   integer   Optional seed for reproducible output");
    return 0;
}

int PickHelp()
{
    Console.WriteLine("randomstub pick - Pick a random item from a comma-separated list of choices");
    Console.WriteLine();
    Console.WriteLine("USAGE");
    Console.WriteLine("  randomstub pick --from <a,b,c> [--seed <s>]");
    Console.WriteLine();
    Console.WriteLine("Flags:");
    Console.WriteLine("  --from   string    Comma-separated list of choices (required)");
    Console.WriteLine("  --seed   integer   Optional seed for reproducible output");
    return 0;
}

// ── Commands ─────────────────────────────────────────────────────────────────

int RunNumber()
{
    if (!TryGetInt("--min", out int min))
    {
        return Fail("Error: --min <integer> is required.");
    }

    if (!TryGetInt("--max", out int max))
    {
        return Fail("Error: --max <integer> is required.");
    }

    if (min > max)
    {
        return Fail($"Error: --min ({min}) must not be greater than --max ({max}).");
    }

    Random rng = CreateRng();
    // Random.Next's upper bound is exclusive; add 1 so --max is inclusive.
    long span = (long)max - min + 1;
    int value = min + (int)(rng.NextDouble() * span);
    if (value > max)
    {
        value = max; // guard against the NextDouble() == 1.0 corner case
    }

    Console.WriteLine(value);
    return 0;
}

int RunDice()
{
    int sides = TryGetInt("--sides", out int s) ? s : 6;
    int count = TryGetInt("--count", out int c) ? c : 1;

    if (sides < 2)
    {
        return Fail($"Error: --sides ({sides}) must be at least 2.");
    }

    if (count < 1)
    {
        return Fail($"Error: --count ({count}) must be at least 1.");
    }

    Random rng = CreateRng();
    int[] rolls = new int[count];
    int total = 0;
    for (int i = 0; i < count; i++)
    {
        rolls[i] = rng.Next(1, sides + 1);
        total += rolls[i];
    }

    Console.WriteLine($"Rolls: {string.Join(", ", rolls)}");
    Console.WriteLine($"Total: {total}");
    return 0;
}

int RunPick()
{
    string? from = GetFlag("--from");
    if (string.IsNullOrWhiteSpace(from))
    {
        return Fail("Error: --from <a,b,c> is required.");
    }

    string[] choices = from
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    if (choices.Length == 0)
    {
        return Fail("Error: --from did not contain any choices.");
    }

    Random rng = CreateRng();
    Console.WriteLine(choices[rng.Next(choices.Length)]);
    return 0;
}

int Unknown(string name)
{
    Console.Error.WriteLine($"Unknown command: {name}");
    Console.Error.WriteLine("Run 'randomstub --help' to see available commands.");
    return 1;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

Random CreateRng() => TryGetInt("--seed", out int seed) ? new Random(seed) : new Random();

string? GetFlag(string name)
{
    int i = Array.IndexOf(args, name);
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
}

bool TryGetInt(string name, out int value)
{
    value = 0;
    string? raw = GetFlag(name);
    return raw is not null && int.TryParse(raw, out value);
}

int Fail(string message)
{
    Console.Error.WriteLine(message);
    return 1;
}
