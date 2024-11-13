// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent;

public class Filter
{
    public static class Op
    {
        public const string Eq = "=";
    }

    string _value;

    public Filter(string value)
    {
        ArgumentException.ThrowIfNullOrEmpty(value);
        _value = value;
    }

    public Filter(string field, string value)
    : this(Expr(field, Op.Eq, value))
    {
    }

    public Filter(string field, string op, string value)
        : this(Expr(field, op, value))
    {
    }

    public override string ToString()
    {
        return _value;
    }

    public static string Expr(string field, string op, string value)
    {
        ArgumentException.ThrowIfNullOrEmpty(field, nameof(field));
        ArgumentException.ThrowIfNullOrEmpty(op, nameof(op));
        ArgumentException.ThrowIfNullOrEmpty(value, nameof(value));

        return $"[{field}] {op} '{value}'";
    }

    public Filter And(string field, string value)
    {
        return And(field, Op.Eq, value);
    }

    public Filter And(string field, string op, string value)
    {
        string expr = Expr(field, op, value);
        _value = $"{_value} And ${expr}";
        return this;
    }

    public Filter Or(string field, string value)
    {
        return Or(field, Op.Eq, value);
    }
    public Filter Or(string field, string op, string value)
    {
        string expr = Expr(field, op, value);
        _value = $"{_value} Or ${expr}";
        return this;
    }

    public static implicit operator string(Filter filter)
    {
        return filter._value;
    }
}

public class EmailSender
{
    public EmailSender(string name, string? email = null)
    {
        Name = name;
        Email = email;
    }

    public string Name
    {
        get;
        private set;
    }

    public string? Email
    {
        get;
        private set;
    }

    public bool HasEmail => !string.IsNullOrEmpty(Email);

    public Filter ToFilter()
    {
        Filter filter = new Filter("SenderName", Name);
        if (HasEmail)
        {
            filter = filter.And("SenderEmailAddress", Email);
        }
        return filter;
    }
}
