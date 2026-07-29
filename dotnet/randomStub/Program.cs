// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// randomstub - a tiny demo CLI for TypeAgent Studio onboarding.
//
// Purpose: give the onboarding pipeline a real, self-contained tool to exercise
// end to end, offline. The Discovery phase (crawlCliHelp) reads the `--help`
// surface; the generated agent can then actually invoke a subcommand and get a
// real answer (e.g. "give me a random number between 1 and 10"), so the
// "Try it" step proves the agent runs rather than just parses help.
//
// The command surface is defined with System.CommandLine so the `--help` output
// has the standard, real-world shape (Description / Usage / Commands / Options)
// that a user onboarding an actual CLI would hit -- a more faithful exercise of
// the Discovery crawler than a hand-rolled help string.
//
// Two invocation shapes the crawler and the generated agent rely on:
//   randomstub --help            -> top-level help with a "Commands:" section
//   randomstub <sub> --help      -> per-subcommand help with an "Options:" section
//   randomstub <sub> [options]   -> actually runs and prints a result
//
// IMPORTANT: help/output must use LF ("\n") line endings. The crawler's
// subcommand parser only recognises the "Commands:" block when its lines are
// LF-separated; Windows CRLF can make it see just the first entry. .NET defaults
// console newlines to Environment.NewLine (CRLF on Windows), so we route every
// output path -- the command actions' Console.Write* calls and System.CommandLine's
// own help/error rendering (via the InvocationConfiguration below) -- through
// writers whose NewLine is forced to "\n".

using System.CommandLine;

StreamWriter stdout = new(Console.OpenStandardOutput()) { NewLine = "\n", AutoFlush = true };
StreamWriter stderr = new(Console.OpenStandardError()) { NewLine = "\n", AutoFlush = true };
Console.SetOut(stdout);
Console.SetError(stderr);

// ── number ───────────────────────────────────────────────────────────────────
Option<int> minOption = new("--min")
{
    Description = "Inclusive lower bound",
    Required = true,
};
Option<int> maxOption = new("--max")
{
    Description = "Inclusive upper bound",
    Required = true,
};
Option<int?> numberSeedOption = new("--seed")
{
    Description = "Optional seed for reproducible output",
};

Command numberCommand = new(
    "number",
    "Generate a random integer between a minimum and maximum");
numberCommand.Options.Add(minOption);
numberCommand.Options.Add(maxOption);
numberCommand.Options.Add(numberSeedOption);
numberCommand.SetAction(parseResult =>
{
    int min = parseResult.GetValue(minOption);
    int max = parseResult.GetValue(maxOption);
    if (min > max)
    {
        Console.Error.WriteLine(
            $"Error: --min ({min}) must not be greater than --max ({max}).");
        return 1;
    }

    Random rng = CreateRng(parseResult.GetValue(numberSeedOption));
    // Random.NextDouble scales to an inclusive [min, max] range; add 1 to the
    // span so --max is reachable, and clamp the NextDouble() == 1.0 corner case.
    long span = (long)max - min + 1;
    int value = min + (int)(rng.NextDouble() * span);
    if (value > max)
    {
        value = max;
    }

    Console.WriteLine(value);
    return 0;
});

// ── dice ─────────────────────────────────────────────────────────────────────
Option<int> sidesOption = new("--sides")
{
    Description = "Number of sides per die (default 6)",
    DefaultValueFactory = _ => 6,
};
Option<int> countOption = new("--count")
{
    Description = "Number of dice to roll (default 1)",
    DefaultValueFactory = _ => 1,
};
Option<int?> diceSeedOption = new("--seed")
{
    Description = "Optional seed for reproducible output",
};

Command diceCommand = new(
    "dice",
    "Roll one or more dice and report the rolls and their total");
diceCommand.Options.Add(sidesOption);
diceCommand.Options.Add(countOption);
diceCommand.Options.Add(diceSeedOption);
diceCommand.SetAction(parseResult =>
{
    int sides = parseResult.GetValue(sidesOption);
    int count = parseResult.GetValue(countOption);
    if (sides < 2)
    {
        Console.Error.WriteLine($"Error: --sides ({sides}) must be at least 2.");
        return 1;
    }
    if (count < 1)
    {
        Console.Error.WriteLine($"Error: --count ({count}) must be at least 1.");
        return 1;
    }

    Random rng = CreateRng(parseResult.GetValue(diceSeedOption));
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
});

// ── pick ─────────────────────────────────────────────────────────────────────
Option<string> fromOption = new("--from")
{
    Description = "Comma-separated list of choices",
    Required = true,
};
Option<int?> pickSeedOption = new("--seed")
{
    Description = "Optional seed for reproducible output",
};

Command pickCommand = new(
    "pick",
    "Pick a random item from a comma-separated list of choices");
pickCommand.Options.Add(fromOption);
pickCommand.Options.Add(pickSeedOption);
pickCommand.SetAction(parseResult =>
{
    string from = parseResult.GetValue(fromOption) ?? string.Empty;
    string[] choices = from.Split(
        ',',
        StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    if (choices.Length == 0)
    {
        Console.Error.WriteLine("Error: --from did not contain any choices.");
        return 1;
    }

    Random rng = CreateRng(parseResult.GetValue(pickSeedOption));
    Console.WriteLine(choices[rng.Next(choices.Length)]);
    return 0;
});

// ── root ─────────────────────────────────────────────────────────────────────
RootCommand rootCommand = new("randomstub - a tiny demo randomness CLI");
rootCommand.Subcommands.Add(numberCommand);
rootCommand.Subcommands.Add(diceCommand);
rootCommand.Subcommands.Add(pickCommand);

InvocationConfiguration config = new()
{
    Output = stdout,
    Error = stderr,
};

return rootCommand.Parse(args).Invoke(config);

static Random CreateRng(int? seed) => seed is int s ? new Random(s) : new Random();
