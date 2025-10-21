// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

/// <summary>
/// Class with methods to support writing Typescript code
/// This class is reserved for TypeChat infrastructure
/// </summary>
public class TypescriptWriter
{
    private readonly CodeWriter _writer;

    /// <summary>
    /// Create a new TypescriptWrite that writes Typescript to the given text writer
    /// </summary>
    /// <param name="writer"></param>
    public TypescriptWriter(TextWriter writer)
    {
        _writer = new CodeWriter(writer);
    }

    /// <summary>
    /// The underlying Code Writer
    /// </summary>
    public CodeWriter Writer => _writer;

    /// <summary>
    /// Increase indent
    /// </summary>
    /// <returns></returns>
    public TypescriptWriter PushIndent()
    {
        _writer.PushIndent();
        return this;
    }

    /// <summary>
    /// Decrease indent
    /// </summary>
    /// <returns></returns>
    public TypescriptWriter PopIndent()
    {
        _writer.PopIndent();
        return this;
    }

    /// <summary>
    /// Reset the writer's state. 
    /// </summary>
    /// <returns></returns>
    public virtual TypescriptWriter Clear()
    {
        _writer.Clear();
        return this;
    }
    /// <summary>
    /// Flush current output
    /// </summary>
    public void Flush() => _writer.Flush();

    public TypescriptWriter Append(string token) { _writer.Append(token); return this; }

    public TypescriptWriter Space() { _writer.Space(); return this; }
    public TypescriptWriter SOL() { _writer.SOL(); return this; } // Start a line
    public TypescriptWriter EOL() { _writer.EOL(); return this; } // End of line

    public TypescriptWriter LBrace() { _writer.LBrace(); return this; }
    public TypescriptWriter RBrace() { _writer.RBrace(); return this; }
    public TypescriptWriter LParan() { _writer.LParan(); return this; }
    public TypescriptWriter RParan() { _writer.RParan(); return this; }
    public TypescriptWriter Semicolon() { _writer.Semicolon(); return this; }
    public TypescriptWriter Comma() { _writer.Comma(); return this; }
    public TypescriptWriter EOS() => Semicolon().EOL();
    public TypescriptWriter Colon() { _writer.Colon(); return this; }
    public TypescriptWriter Assign() => Append(Typescript.Operators.Assign);
    public TypescriptWriter Or() => Append(Typescript.Operators.Or);
    public TypescriptWriter Comment(string text)
    {
        if (!string.IsNullOrEmpty(text))
        {
            Append(CodeLanguage.Punctuation.Comment).Space().Append(text).EOL();
        }
        return this;
    }

    /// <summary>
    /// Start a code block
    /// </summary>
    /// <returns></returns>
    public TypescriptWriter StartBlock() => LBrace().EOL();
    /// <summary>
    /// End a code block
    /// </summary>
    /// <returns></returns>
    public TypescriptWriter EndBlock() => RBrace().EOL();

    public TypescriptWriter Export() => Append(Typescript.Keywords.Export);
    public TypescriptWriter Extends() => Append(Typescript.Keywords.Extends);

    public TypescriptWriter Name(string name) => Append(name);
    public TypescriptWriter Name(string name, bool nullable)
    {
        Name(name);
        if (nullable)
        {
            _writer.Question();
        }
        return this;
    }
    public TypescriptWriter DataType(string name) => Colon().Space().Name(name);
    public TypescriptWriter Array() => Append(Typescript.Punctuation.Array);
    public TypescriptWriter Literal(string value)
    {
        _writer.SQuote().Append(value).SQuote();
        return this;
    }

    public TypescriptWriter Literals(IEnumerable<string> values)
    {
        ArgumentVerify.ThrowIfNull(values, nameof(values));
        int i = 0;
        foreach (var value in values)
        {
            if (i > 0)
            {
                Space().Or().Space();
            }
            Literal(value);
            ++i;
        }
        return this;
    }

    public TypescriptWriter Variable(
        string name,
        string dataType,
        bool isArray = false,
        bool nullable = false)
    {
        return DeclareVariable(name, dataType, isArray, nullable).Semicolon();
    }

    public TypescriptWriter Variable(string name, bool nullable, IEnumerable<string> literals)
    {
        Name(name, nullable).Colon().Space().Literals(literals).Semicolon();
        return this;
    }

    public TypescriptWriter DeclareVariable(
        string name,
        string dataType,
        bool isArray = false,
        bool nullable = false)
    {
        Name(name, nullable).Colon().Space().Name(dataType);
        if (isArray)
        {
            Array();
        }
        return this;
    }

    public TypescriptWriter Parameter(
        string name,
        string dataType,
        int argNumber,
        int argCount,
        bool isArray = false,
        bool nullable = false)
    {
        if (argNumber > 0)
        {
            Space();
        }
        DeclareVariable(name, dataType, isArray, nullable);
        if (argNumber < argCount - 1)
        {
            Comma();
        }
        return this;
    }

    public TypescriptWriter Type(string name)
    {
        return Append(Typescript.Keywords.Type).Space().Name(name);
    }

    public TypescriptWriter Enum(string name)
    {
        return Append(Typescript.Keywords.Enum).Space().Name(name);
    }

    public TypescriptWriter BeginType(string name)
    {
        return Type(name).Space().StartBlock();
    }

    public TypescriptWriter EndType(string name)
    {
        // TODO: validation here to verify Begin & End match
        return EndBlock();
    }

    public TypescriptWriter Interface(string name, bool space = true)
    {
        return Append(Typescript.Keywords.Interface).Space().Name(name);
    }

    public TypescriptWriter BeginInterface(string name, string baseType = null)
    {
        if (string.IsNullOrEmpty(baseType))
        {
            Interface(name).Space().StartBlock();
        }
        else
        {
            Interface(name).Space().Extends().Space().Name(baseType).Space().StartBlock();
        }
        return this;
    }

    public TypescriptWriter EndInterface()
    {
        return SOL().EndBlock();
    }

    public TypescriptWriter BeginMethodDeclare(string name)
    {
        return SOL().Name(name).LParan();
    }

    public TypescriptWriter EndMethodDeclare(string? returnType = null, bool nullable = false)
    {
        RParan();
        if (!string.IsNullOrEmpty(returnType))
        {
            Colon().Space().Name(returnType);
            if (nullable)
            {
                _writer.Question();
            }
        }
        return EOS();
    }

    /// <summary>
    /// Wrapper method that sets up a TypescriptWriter, then calls the given codeGenerator
    /// When codeGeneration completes, returns the generated code as a string
    /// </summary>
    /// <param name="codeGenerator">Callback that generates code</param>
    /// <returns></returns>
    public static string WriteCode(Action<TypescriptWriter> codeGenerator)
    {
        ArgumentVerify.ThrowIfNull(codeGenerator, nameof(codeGenerator));

        using StringWriter sw = new StringWriter();
        TypescriptWriter writer = new TypescriptWriter(sw);
        codeGenerator(writer);
        sw.Flush();
        return sw.ToString();
    }
}
