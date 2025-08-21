# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import MISSING
from typing import Any

from pydantic import Field, AliasChoices
from pydantic.alias_generators import to_camel


def CamelCaseField(
    description: str | None = None,
    *,
    default: Any = MISSING,
    default_factory: Any = MISSING,
) -> Any:
    """
    Helper function to create a Field with camelCase serialization alias.

    Args:
        description: The field description
        default: The default value for the field (optional)
        default_factory: The default factory for the field (optional)

    Returns:
        A descriptor that will create a Field with serialization_alias set to the camelCase version
        of the field name and validation_alias set to accept both snake_case and camelCase versions.

    Note: For fields ending with underscore (like 'from_'), the underscore is removed in the camelCase version.
    """

    class CamelCaseFieldDescriptor:
        def __init__(
            self,
            description: str | None = None,
            default: Any = MISSING,
            default_factory: Any = MISSING,
        ):
            self.description = description
            self.default = default
            self.default_factory = default_factory

        def __set_name__(self, owner, name):
            # Replace ourselves with the actual Field when the field name is known
            # Handle trailing underscore (like from_ -> from)
            clean_name = name.rstrip("_")
            camel_name = to_camel(clean_name)

            field_kwargs = {
                "description": self.description,
                "serialization_alias": camel_name,
                "validation_alias": AliasChoices(name, camel_name),
            }

            if self.default is not MISSING:
                field_kwargs["default"] = self.default
            elif self.default_factory is not MISSING:
                field_kwargs["default_factory"] = self.default_factory

            field = Field(**field_kwargs)
            setattr(owner, name, field)

    return CamelCaseFieldDescriptor(description, default, default_factory)
