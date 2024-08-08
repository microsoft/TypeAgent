// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PropertyValueType = string | number | boolean;

export interface PropertyValue {
    // property name in the action
    propertyName: string;
    // property value in the action
    propertyValue: PropertyValueType;

    // the set of original sub-phrases that translate into this property value.
    propertySubPhrases: string[];

    // Return 3 or more alternatives values for the property that will change the translation, and the substitue sub-phrases.
    alternatives: PropertyAlternatives[];
}

export interface PropertyAlternatives {
    propertyValue: PropertyValueType;
    // substitute sub-phrases in the original request to get this alternative property value.  The order of the sub-phrases must match the order of the original sub-phrases.
    propertySubPhrases: string[];
}

export interface AlternativesExplanation {
    propertyAlternatives: PropertyValue[];
}
