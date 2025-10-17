// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

/// <summary>
/// CodeWriter uses a text writer to emit code
/// Includes support of indentation
/// </summary>
public class CodeWriter
{
    private readonly TextWriter _writer;
    private readonly List<char> _indent;

    /// <summary>
    /// Create a new CodeWriter
    /// </summary>
    /// <param name="writer"></param>
    public CodeWriter(TextWriter writer)
    {
        _writer = writer;
        _indent = new List<char>();
    }

    /// <summary>
    /// How many spaces to inject for each level of indent
    /// </summary>
    public int IndentUnit { get; set; } = 2;

    /// <summary>
    /// Increase the indent 
    /// </summary>
    /// <returns></returns>
    public CodeWriter PushIndent()
    {
        for (int i = 0; i < IndentUnit; ++i)
        {
            _indent.Add(' ');
        }
        return this;
    }

    /// <summary>
    /// Decrease the indent
    /// </summary>
    /// <returns></returns>
    public CodeWriter PopIndent()
    {
        if (_indent.Count > 0)
        {
            _indent.RemoveRange(_indent.Count - IndentUnit, IndentUnit);
        }
        return this;
    }

    /// <summary>
    /// Write given token
    /// </summary>
    /// <param name="token">token to write</param>
    /// <returns>this code writer</returns>
    private CodeWriter Write(string token)
    {
        if (!string.IsNullOrEmpty(token))
        {
            _writer.Write(token);
        }
        return this;
    }

    /// <summary>
    /// Write the contents of the string builder
    /// </summary>
    /// <param name="sb">string builder that contains the string to write</param>
    /// <returns>CodeWriter</returns>
    private CodeWriter Write(StringBuilder sb)
    {
        if (sb.Length > 0)
        {
            _writer.Write(sb);
        }
        return this;
    }

    /// <summary>
    /// Write indent
    /// </summary>
    /// <returns>CodeWriter</returns>
    public CodeWriter WriteIndent()
    {
        if (_indent.Count > 0)
        {
            for (int i = 0; i < _indent.Count; ++i)
            {
                _writer.Write(_indent[i]);
            }
        }
        return this;
    }

    /// <summary>
    /// Append a token
    /// </summary>
    /// <param name="token"></param>
    /// <returns>CodeWriter</returns>
    public CodeWriter Append(string token) => Write(token);

    public CodeWriter Append(StringBuilder tokens) => Write(tokens);

    public CodeWriter Append(char ch)
    {
        _writer.Write(ch);
        return this;
    }

    /// <summary>
    /// Write a double precision number
    /// </summary>
    /// <param name="token">number to write</param>
    /// <returns>CodeWriter</returns>
    public CodeWriter Append(double token)
    {
        _writer.Write(token);
        return this;
    }

    /// <summary>
    /// Write an integer
    /// </summary>
    /// <param name="value">number to write</param>
    /// <returns>CodeWriter</returns>
    public CodeWriter Append(int value)
    {
        _writer.Write(value);
        return this;
    }

    public CodeWriter Clear()
    {
        _indent.Clear();
        return this;
    }

    public CodeWriter LBrace() => Write(CodeLanguage.Punctuation.LBrace);
    public CodeWriter RBrace() => Write(CodeLanguage.Punctuation.RBrace);
    public CodeWriter LParan() => Write(CodeLanguage.Punctuation.LParan);
    public CodeWriter RParan() => Write(CodeLanguage.Punctuation.RParan);
    public CodeWriter LSquare() => Write(CodeLanguage.Punctuation.LSquare);
    public CodeWriter RSquare() => Write(CodeLanguage.Punctuation.RSquare);
    public CodeWriter Semicolon() => Write(CodeLanguage.Punctuation.Semicolon);
    public CodeWriter Comma() => Write(CodeLanguage.Punctuation.Comma);
    public CodeWriter Period() => Write(CodeLanguage.Punctuation.Period);
    public CodeWriter Colon() => Write(CodeLanguage.Punctuation.Colon);
    public CodeWriter SQuote() => Write(CodeLanguage.Punctuation.SingleQuote);
    public CodeWriter DoubleQuote() => Write(CodeLanguage.Punctuation.DoubleQuote);
    public CodeWriter Question() => Write(CodeLanguage.Punctuation.Question);
    public CodeWriter Space() => Write(CodeLanguage.Punctuation.Space);
    public CodeWriter SOL() { WriteIndent(); return this; } // Start a line
    public CodeWriter EOL() => Write(CodeLanguage.Punctuation.EOL);

    public void Flush()
    {
        _writer.Flush();
    }
}
