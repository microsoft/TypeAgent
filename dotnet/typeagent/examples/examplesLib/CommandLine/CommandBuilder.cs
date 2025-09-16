// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

public class CommandBuilder
{
    public static readonly CommandBuilder Default = new CommandBuilder();

    public const string DefaultArgPrefix = "--";

    string _argPrefix;

    public CommandBuilder(string? argPrefix = null)
    {
        _argPrefix = argPrefix ?? DefaultArgPrefix;
    }

    /// <summary>
    /// Create a command for each public method annotated with [Command]
    /// </summary>
    /// <param name="type"></param>
    /// <returns></returns>
    public IEnumerable<Command> FromType(Type type)
    {
        ArgumentVerify.ThrowIfNull(type, nameof(type));

        MethodInfo[] methods = type.GetMethods(BindingFlags.Static | BindingFlags.Public);

        return FromMethods(methods, null);
    }

    /// <summary>
    /// For the given object, create a command for each method annotated with [Command]
    /// </summary>
    /// <param name="instance"></param>
    /// <returns></returns>
    public IEnumerable<Command> FromObject(object instance)
    {
        ArgumentVerify.ThrowIfNull(instance, nameof(instance));

        MethodInfo[] methods = instance.GetType().GetMethods(BindingFlags.Instance | BindingFlags.Public);

        return FromMethods(methods, instance);
    }

    /// <summary>
    /// For the given object, create a command for each method annotated with [Command]
    /// </summary>
    /// <param name="methods"></param>
    /// <param name="instance">object instance</param>
    /// <returns></returns>
    public IEnumerable<Command> FromMethods(MethodInfo[] methods, object? instance)
    {
        ArgumentVerify.ThrowIfNull(methods, nameof(methods));

        foreach (var method in methods)
        {
            CommandAttribute? attribute = method.GetCustomAttribute<CommandAttribute>(true);
            if (attribute is null)
            {
                continue;
            }

            string commandName = attribute.HasName ? attribute.Name : method.Name;

            Command cmd = new Command(commandName, GetDescription(method));
            cmd.Action = HandlerDescriptor.FromMethodInfo(method, instance).GetCommandHandler();

            AddArguments(cmd, method);

            yield return cmd;
        }
    }

    void AddArguments(Command cmd, MethodInfo method)
    {
        ParameterInfo[] parameters = method.GetParameters();

        foreach (var parameter in parameters)
        {
            if (parameter.IsOptional || IsOptional(parameter))
            {
                cmd.Options.Add(CreateOption(parameter));
            }
            else
            {
                cmd.Arguments.Add(CreateArgument(parameter));
            }
        }
    }

    void AddOptions(Command cmd, MethodInfo method)
    {
        ParameterInfo[] parameters = method.GetParameters();

        foreach (var parameter in parameters)
        {
            Option option = CreateOption(parameter);

            cmd.Options.Add(option);
        }
    }

    Argument CreateArgument(ParameterInfo parameter)
    {
        Argument arg = CreateArgument(
            parameter.ParameterType,
            parameter.Name,
            GetDescription(parameter)
        );

        return arg;
    }

    Option CreateOption(ParameterInfo parameter)
    {
        Option option = CreateOption(
            parameter.ParameterType,
            _argPrefix + parameter.Name,
            GetDescription(parameter)
        );

        return option;
    }

    bool IsOptional(ParameterInfo parameter)
    {
        return parameter.GetCustomAttribute<OptionalAttribute>() is not null;
    }

    Argument CreateArgument(Type valueType, string name, string? description)
    {
        var argumentType = typeof(Argument<>).MakeGenericType(valueType);

        var ctor = argumentType.GetConstructor(new[] { typeof(string) });

        var arg = (Argument)ctor.Invoke(new object[] { name});
        if (description is not null)
        {
            arg.Description = description;
        }
        return arg;
    }

    Option CreateOption(Type valueType, string name, string description = null)
    {
        var optionType = typeof(Option<>).MakeGenericType(valueType);

        var ctor = optionType.GetConstructor(new[] { typeof(string), typeof(string) });

        var option = (Option)ctor.Invoke(new object[] { name, description });

        return option;
    }

    string? GetDescription(ParameterInfo parameter)
    {
        var attribute = parameter.GetCustomAttribute<DescriptionAttribute>();

        return attribute?.Description;
    }

    string? GetDescription(MethodInfo method)
    {
        var attribute = method.GetCustomAttribute<DescriptionAttribute>(true);

        return attribute?.Description;
    }

    string? GetDescription(Type type)
    {
        var attribute = type.GetCustomAttribute<DescriptionAttribute>(true);

        return attribute?.Description ?? type.Name;
    }
}
