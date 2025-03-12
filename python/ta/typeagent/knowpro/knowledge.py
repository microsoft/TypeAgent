# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from . import kplib


# TODO: Why not use str(facet)?
def facet_value_to_string(facet: kplib.Facet) -> str:
    value = facet.value
    if isinstance(value, kplib.Quantity):
        return f"{value.amount} {value.units}"
    else:
        return str(value)
