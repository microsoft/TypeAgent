// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

public static class TypeEx
{
    public static IEnumerable<CommentAttribute> CommentAttributes(this MemberInfo member)
    {
        object[] attributes = member.GetCustomAttributes(typeof(CommentAttribute), false);
        foreach (var attribute in attributes)
        {
            if (attribute is CommentAttribute comment)
            {
                yield return comment;
            }
        }
    }

    public static IEnumerable<string> Comments(this MemberInfo member)
    {
        return from comment in member.CommentAttributes()
               where comment.HasText
               select comment.Text;
    }

    public static JsonVocabAttribute? JsonVocabAttribute(this MemberInfo member)
    {
        return member.GetCustomAttribute(typeof(JsonVocabAttribute)) as JsonVocabAttribute;
    }

    public static bool IsString(this Type type)
    {
        return type == typeof(string) || typeof(IStringType).IsAssignableFrom(type);
    }

    public static bool IsBoolean(this Type type)
    {
        return type == typeof(bool);
    }

    public static bool IsDateTime(this Type type)
    {
        return type == typeof(DateTime) || type == typeof(TimeSpan);
    }

    public static bool IsNumber(this Type type)
    {
        switch (Type.GetTypeCode(type))
        {
            default:
                return false;

            case TypeCode.Byte:
            case TypeCode.Decimal:
            case TypeCode.Double:
            case TypeCode.Int16:
            case TypeCode.Int32:
            case TypeCode.Int64:
            case TypeCode.SByte:
            case TypeCode.Single:
            case TypeCode.UInt16:
            case TypeCode.UInt32:
            case TypeCode.UInt64:
                return true;
        }
    }

    internal static bool IsObject(this Type type)
    {
        return type == typeof(object);
    }

    internal static bool IsValueType(this Type type)
    {
        return type == typeof(ValueType);
    }

    internal static bool IsEnum(this Type type)
    {
        return type == typeof(Enum);
    }

    internal static bool IsRoot(this Type type)
    {
        return type.IsObject() || type.IsValueType() || type.IsEnum();
    }

    internal static bool IsVoid(this Type type)
    {
        return type == typeof(void);
    }

    internal static bool IsAbstract(this PropertyInfo property)
    {
        var methods = property.GetAccessors();
        for (int i = 0; i < methods.Length; ++i)
        {
            if (methods[i].IsAbstract)
            {
                return true;
            }
        }
        return false;
    }

    internal static bool IsRequired(this MemberInfo property)
    {
#if NET7_0_OR_GREATER
        var json_attrib = property.GetCustomAttribute(typeof(JsonRequiredAttribute));
        if (json_attrib is not null)
        {
            return true;
        }
#endif
        var attrib = property.GetCustomAttribute(typeof(RequiredAttribute));
        return attrib is not null;
    }

    internal static bool IsNullableValueType(this Type type)
    {
        return GetNullableValueType(type) is not null;
    }

    internal static Type? GetNullableValueType(this Type type)
    {
        var foo = Nullable.GetUnderlyingType(type);
        var bar = type.IsGenericType && type.GetGenericTypeDefinition() == typeof(Nullable<>);
        return foo;
    }

    internal static Type? BaseClass(this Type type)
    {
        Type baseType = type.BaseType;
        return baseType.IsRoot() ? null : baseType;
    }

    internal static bool IsTask(this Type type)
    {
        return typeof(Task).IsAssignableFrom(type);
    }

    internal static Type? GetGenericType(this Type type)
    {
        if (!type.IsGenericType)
        {
            return null;
        }
        var args = type.GetGenericArguments();
        return (args.IsNullOrEmpty()) ? null : args[0];
    }

    internal static IEnumerable<Type> Subclasses(this Type type)
    {
        if (!type.IsClass)
        {
            return Empty<Type>();
        }
        Assembly assembly = type.Assembly;
        return assembly.GetTypes().Where(t => t.IsSubclassOf(type));
    }

    internal static IEnumerable<Type> Implementors(this Type type)
    {
        if (!type.IsInterface)
        {
            return Empty<Type>();
        }

        Assembly assembly = type.Assembly;

        return assembly.GetTypes().Where(t => t.IsClass && t.IsAssignableFrom(type));
    }


    internal static bool IsIgnore(this MemberInfo member)
    {
        JsonIgnoreAttribute? attr = (JsonIgnoreAttribute)member.GetCustomAttribute(typeof(JsonIgnoreAttribute), true);
        return attr is not null;
    }

    internal static string PropertyName(this MemberInfo member)
    {
        JsonPropertyNameAttribute? attr = (JsonPropertyNameAttribute)member.GetCustomAttribute(typeof(JsonPropertyNameAttribute), true);
        return attr is not null ?
                attr.Name :
                member.Name;
    }

    internal static string GenerateInterfaceTypeDef(this Type type)
    {
        if (!type.IsGenericType)
        {
            return type.Name;
        }

        string typeName = type.NonGenericName();
        Type typeDef = type.GetGenericTypeDefinition();
        Type[] typeParams = typeDef.GetGenericArguments();
        if (typeParams.IsNullOrEmpty())
        {
            return typeName;
        }
        StringBuilder sb = new StringBuilder();
        sb.Append(typeName).Append('<');
        typeParams.CombineArgNames(sb, ",").Append('>');
        return sb.ToString();
    }

    internal static string GenerateInterfaceName(this Type type)
    {
        if (!type.IsGenericType)
        {
            return type.Name;
        }

        string typeName = type.NonGenericName();
        Type[] typeArgs = type.GetGenericArguments();
        if (typeArgs.IsNullOrEmpty())
        {
            return typeName;
        }
        StringBuilder sb = new StringBuilder();
        sb.Append(typeName).Append('_');
        typeArgs.CombineArgNames(sb, "_");
        return sb.ToString();
    }

    internal static StringBuilder CombineArgNames(this Type[] args, StringBuilder sb, string sep)
    {
        var paramNames = from arg in args select arg.Name;
        sb.AppendMultiple(sep, paramNames);
        return sb;
    }

    internal static string NonGenericName(this Type type)
    {
        string name = type.Name;
        int i = name.IndexOf('`');
        if (i >= 0)
        {
            return name.Substring(0, i);
        }
        return name;
    }

    internal static IEnumerable<T> Empty<T>()
    {
        yield break;
    }
}
