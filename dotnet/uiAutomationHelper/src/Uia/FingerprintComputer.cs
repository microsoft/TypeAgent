// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using FlaUI.Core.AutomationElements;
using UiAutomationHelper.Models;

namespace UiAutomationHelper.Uia;

internal static class FingerprintComputer
{
    public sealed class Result
    {
        public string Hash { get; set; } = "";
        public int ControlCount { get; set; }
        public string ActiveWindowTitle { get; set; } = "";
        public string? FocusedSelector { get; set; }
    }

    public static Result Compute(
        AutomationElement root,
        string rootSelector,
        IReadOnlyList<DynamicControlRule>? rules)
    {
        rules ??= Array.Empty<DynamicControlRule>();
        var sb = new StringBuilder();
        var ctx = new Context { Rules = rules };
        WriteNode(root, rootSelector, sb, ctx);

        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString()));
        var hex = Convert.ToHexString(bytes).ToLowerInvariant()[..16];
        return new Result
        {
            Hash = hex,
            ControlCount = ctx.NodeCount,
            ActiveWindowTitle = root.Properties.Name.ValueOrDefault ?? "",
            FocusedSelector = ctx.FocusedSelector,
        };
    }

    private sealed class Context
    {
        public IReadOnlyList<DynamicControlRule> Rules { get; init; } = Array.Empty<DynamicControlRule>();
        public int NodeCount;
        public string? FocusedSelector;
    }

    private static void WriteNode(AutomationElement el, string selector, StringBuilder sb, Context ctx)
    {
        ctx.NodeCount++;
        if (el.Properties.HasKeyboardFocus.ValueOrDefault)
        {
            ctx.FocusedSelector ??= selector;
        }

        var dynamicProps = MatchDynamicProps(el, selector, ctx.Rules);
        var ct = el.ControlType.ToString();
        var aid = el.Properties.AutomationId.ValueOrDefault ?? "";
        var name = dynamicProps.Contains("name") ? "" : (el.Properties.Name.ValueOrDefault ?? "");
        var cls = el.Properties.ClassName.ValueOrDefault ?? "";

        string value = "";
        if (!dynamicProps.Contains("value"))
        {
            try
            {
                if (el.Patterns.Value.IsSupported)
                {
                    value = el.Patterns.Value.Pattern.Value.ValueOrDefault ?? "";
                }
            }
            catch { /* ignore pattern access errors */ }
        }

        string toggle = "";
        if (!dynamicProps.Contains("toggleState"))
        {
            try
            {
                if (el.Patterns.Toggle.IsSupported)
                {
                    toggle = el.Patterns.Toggle.Pattern.ToggleState.ValueOrDefault.ToString();
                }
            }
            catch { /* ignore */ }
        }

        sb.Append('{')
          .Append("ct=").Append(ct)
          .Append("|aid=").Append(aid)
          .Append("|name=").Append(name)
          .Append("|class=").Append(cls)
          .Append("|val=").Append(value)
          .Append("|tog=").Append(toggle)
          .Append("|kids=[");

        AutomationElement[] children;
        try { children = el.FindAllChildren(); }
        catch { children = Array.Empty<AutomationElement>(); }

        for (int i = 0; i < children.Length; i++)
        {
            if (i > 0) sb.Append(',');
            var childSelector = selector + Selectors.BuildSegment(children[i]);
            WriteNode(children[i], childSelector, sb, ctx);
        }
        sb.Append(']').Append('}');
    }

    private static HashSet<string> MatchDynamicProps(
        AutomationElement el,
        string selector,
        IReadOnlyList<DynamicControlRule> rules)
    {
        var matched = new HashSet<string>(StringComparer.Ordinal);
        if (rules.Count == 0) return matched;

        foreach (var rule in rules)
        {
            if (!RuleMatches(rule, el, selector)) continue;
            foreach (var p in rule.DynamicProperties)
            {
                matched.Add(p);
            }
        }
        return matched;
    }

    private static bool RuleMatches(DynamicControlRule rule, AutomationElement el, string selector)
    {
        var m = rule.Match;
        switch (m.Kind)
        {
            case "automationId":
                if (string.IsNullOrEmpty(m.Value)) return false;
                return string.Equals(
                    el.Properties.AutomationId.ValueOrDefault ?? "",
                    m.Value,
                    StringComparison.Ordinal);

            case "selector":
                return string.Equals(selector, m.Value, StringComparison.Ordinal);

            case "selectorPattern":
                if (string.IsNullOrEmpty(m.Pattern)) return false;
                return Regex.IsMatch(selector, GlobToRegex(m.Pattern));

            case "container":
                if (string.IsNullOrEmpty(m.Container) || string.IsNullOrEmpty(m.ControlType)) return false;
                if (!selector.StartsWith(m.Container, StringComparison.Ordinal)) return false;
                if (!string.Equals(el.ControlType.ToString(), m.ControlType, StringComparison.Ordinal)) return false;
                if (!string.IsNullOrEmpty(m.NameRegex))
                {
                    var name = el.Properties.Name.ValueOrDefault ?? "";
                    if (!Regex.IsMatch(name, m.NameRegex)) return false;
                }
                if (!string.IsNullOrEmpty(m.ClassNameRegex))
                {
                    var cls = el.Properties.ClassName.ValueOrDefault ?? "";
                    if (!Regex.IsMatch(cls, m.ClassNameRegex)) return false;
                }
                return true;

            default:
                return false;
        }
    }

    private static string GlobToRegex(string glob)
    {
        var escaped = Regex.Escape(glob).Replace("\\*", ".*").Replace("\\?", ".");
        return "^" + escaped + "$";
    }
}
