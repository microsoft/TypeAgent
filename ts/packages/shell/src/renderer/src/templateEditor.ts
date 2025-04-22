// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    TemplateFieldArray,
    TemplateType,
    TemplateField,
    TemplateFieldScalar,
    TemplateSchema,
} from "@typeagent/agent-sdk";
import { TemplateData, TemplateEditConfig } from "agent-dispatcher";
import { getObjectProperty, setObjectProperty } from "common-utils";
import { getDispatcher } from "./main";
import { SearchMenu, SearchMenuItem } from "./search";

function cloneTemplateData(
    templateData: TemplateData | TemplateData[],
): TemplateData[] {
    const clone = Array.isArray(templateData) ? templateData : [templateData];

    return clone.map((d) => {
        return {
            data: structuredClone(d.data),
            schema: d.schema,
        };
    });
}

class FieldContainer {
    private current: TemplateData[];
    public readonly table: HTMLTableElement;
    private root: FieldRootArray;
    public errorCount = 0;
    public editMode = false;
    private editingField: FieldScalar | undefined;

    constructor(
        public readonly actionTemplates: TemplateEditConfig,
        public readonly enableEdit: boolean,
    ) {
        this.table = document.createElement("table");
        this.current = cloneTemplateData(actionTemplates.templateData);
        this.root = new FieldRootArray(
            this,
            "Actions",
            actionTemplates.defaultTemplate,
        );
    }

    public reset() {
        this.editingField = undefined;
        this.errorCount = 0;

        this.current = cloneTemplateData(this.actionTemplates.templateData);
        this.table.replaceChildren();
        this.root = new FieldRootArray(
            this,
            "Actions",
            this.actionTemplates.defaultTemplate,
        );
    }

    public getProperty(name: string) {
        return getObjectProperty(this.current, name);
    }

    public setProperty(name: string, value: any) {
        setObjectProperty(this, "current", name, value, true);
    }

    public async refreshSchema(index: number) {
        const editingPropertyName = this.editingField?.getPropertyNameSuffix(
            this.root,
        );
        this.editingField = undefined;

        this.current[index].schema = await getDispatcher().getTemplateSchema(
            this.actionTemplates.templateAgentName,
            this.actionTemplates.templateName,
            this.current[index].data,
        );
        this.root.refresh();

        if (editingPropertyName) {
            const field = this.root.findPrefixField(editingPropertyName);
            if (field) {
                const scalarField = field.getScalarField();
                if (scalarField === field) {
                    this.setEditing(scalarField.getNextScalarField());
                } else {
                    this.setEditing(scalarField);
                }
            }
        }
    }

    public getSchemaValue(): any {
        return this.root.getSchemaValue();
    }
    public setEditing(field: FieldScalar | undefined) {
        const editingField = this.editingField;
        if (editingField === field || editingField?.stopEditing() === false) {
            return undefined;
        }
        this.editingField = field;
        field?.startEditing();
        return editingField;
    }
}

class FieldRow {
    private readonly buttonCells: HTMLElement[] = [];
    protected readonly row: HTMLTableRowElement;
    protected readonly valueCell: HTMLTableCellElement;
    constructor(label: string, level: number, parent: FieldGroup | undefined) {
        const row = document.createElement("tr");
        const nameCell = row.insertCell();
        nameCell.className = "name-cell";

        const labelDiv = document.createElement("div");
        labelDiv.style.paddingLeft = `${level * 20}px`;
        labelDiv.innerText = label;
        labelDiv.className = "name-div";
        nameCell.appendChild(labelDiv);

        const valueCell = row.insertCell();
        valueCell.className = "value-cell";

        this.row = row;
        this.valueCell = valueCell;

        if (parent !== undefined) {
            parent.insertAfter(row);
        }
    }

    public addButton(
        index: number,
        iconChar: string,
        className: string,
        onclick: () => void,
    ) {
        if (index >= this.buttonCells.length) {
            for (let i = this.buttonCells.length; i <= index; i++) {
                const buttonCell = this.row.insertCell();
                this.buttonCells.push(buttonCell);
            }
        }

        const buttonCell = this.buttonCells[index];
        buttonCell.className = "button-cell";
        const button = document.createElement("button");
        button.innerText = iconChar;
        button.className = className;
        button.onclick = onclick;
        buttonCell.appendChild(button);

        return button;
    }

    public showButton(index: number, show: boolean) {
        const buttonCell = this.buttonCells[index];
        buttonCell.style.visibility = show ? "visible" : "hidden";
    }

    public removeButton(index: number) {
        this.buttonCells[index].replaceChildren();
    }

    public remove() {
        this.row.remove();
    }
}

abstract class FieldBase extends FieldRow {
    private isValid: boolean = true;
    constructor(
        protected readonly data: FieldContainer,
        protected readonly fullPropertyName: string,
        label: string,
        private readonly optional: boolean,
        level: number,
        private readonly parent: FieldGroup | undefined,
    ) {
        super(label, level, parent);
        if (parent === undefined) {
            this.data.table.appendChild(this.row);
        }
    }

    public isAncestor(field: FieldBase): boolean {
        return this.fullPropertyName.startsWith(field.fullPropertyName);
    }

    // Return the suffix of the property name if field is an ancestor, undefined otherwise
    public getPropertyNameSuffix(field: FieldBase): string | undefined {
        return this.isAncestor(field)
            ? this.fullPropertyName.substring(field.fullPropertyName.length)
            : undefined;
    }

    public getNextScalarField(): FieldScalar | undefined {
        let curr: FieldBase | undefined = this;
        let parent = curr.parent;
        while (parent) {
            curr = parent.findNextField(curr);
            while (curr) {
                const scalarField = curr.getScalarField();
                if (scalarField !== undefined) {
                    return scalarField;
                }
                curr = parent.findNextField(curr);
            }
            curr = parent;
            parent = curr.parent;
        }
        return undefined;
    }

    public abstract findPrefixField(name: string): FieldBase | undefined;
    public abstract getScalarField(): FieldScalar | undefined;
    public abstract getSchemaValue(): any;
    protected abstract isValidValue(value: any): boolean;

    public insertAfter(row: HTMLTableRowElement) {
        this.row.after(row);
    }
    public remove() {
        if (!this.isValid) {
            this.data.errorCount--;
        }
        super.remove();
    }
    public updateValueDisplay(updateParent: boolean = false) {
        const value = this.getValue();
        const valid = this.isValidValue(value);
        if (value !== undefined) {
            this.setMissing(false);
            this.setValid(valid);
            this.valueCell.innerText =
                typeof value === "object" ? "" : value.toString();
        } else {
            this.setMissing(true);
            this.setValid(valid || this.optional);
            this.valueCell.innerText = "";
        }

        if (updateParent) {
            this.parent?.updateValueDisplay();
        }
    }

    protected setValid(valid: boolean) {
        if (valid === this.isValid) {
            return;
        }
        this.isValid = valid;
        if (valid) {
            this.data.errorCount--;
            this.row.classList.remove("error");
        } else {
            this.data.errorCount++;
            this.row.classList.add("error");
        }
    }

    private setMissing(missing: boolean) {
        if (this.optional) {
            if (missing) {
                this.row.classList.add("missing");
            } else {
                this.row.classList.remove("missing");
            }
        }
    }

    protected getValue() {
        return this.data.getProperty(this.fullPropertyName);
    }
    protected setValue(value: any) {
        this.data.setProperty(this.fullPropertyName, value);
        this.updateValueDisplay(true);
    }
    public deleteValue() {
        this.setValue(undefined);
    }
}

function createUIForField(
    data: FieldContainer,
    fullPropertyName: string,
    paramName: string,
    paramField: TemplateType,
    optional: boolean,
    level: number,
    parent: FieldGroup | undefined,
) {
    switch (paramField.type) {
        case "array":
            return new FieldArray(
                data,
                fullPropertyName,
                paramName,
                paramField,
                optional,
                level,
                parent,
            );

        case "object":
            return new FieldObject(
                data,
                fullPropertyName,
                paramName,
                paramField.fields,
                optional,
                level,
                parent,
            );

        default:
            return new FieldScalar(
                data,
                fullPropertyName,
                paramName,
                paramField,
                optional,
                level,
                parent,
            );
    }
}

abstract class FieldGroup extends FieldBase {
    protected readonly fields: FieldBase[] = [];

    constructor(
        data: FieldContainer,
        fullPropertyName: string,
        label: string,
        optional: boolean,
        private readonly level: number,
        parent: FieldGroup | undefined,
    ) {
        super(data, fullPropertyName, label, optional, level, parent);
    }

    public findPrefixField(propertyName: string): FieldBase | undefined {
        if (!propertyName.startsWith(this.fullPropertyName)) {
            return undefined;
        }
        for (const field of this.fields) {
            const found = field.findPrefixField(propertyName);
            if (found !== undefined) {
                return found;
            }
        }
        return this;
    }
    public getScalarField() {
        for (const field of this.fields) {
            const scalarField = field.getScalarField();
            if (scalarField) {
                return scalarField;
            }
        }
        return undefined;
    }

    public findNextField(field: FieldBase): FieldBase | undefined {
        const index = this.fields.indexOf(field);
        if (index !== -1 && index + 1 < this.fields.length) {
            return this.fields[index + 1];
        }
        return undefined;
    }
    public insertAfter(row: HTMLTableRowElement) {
        if (this.fields.length === 0) {
            super.insertAfter(row);
        } else {
            this.fields[this.fields.length - 1].insertAfter(row);
        }
    }

    protected createChildField(
        fieldName: string | number,
        label: string,
        fieldType: TemplateType,
        optional: boolean,
    ) {
        const field = createUIForField(
            this.data,
            this.fullPropertyName === ""
                ? `${fieldName}`
                : `${this.fullPropertyName}.${fieldName}`,
            label,
            fieldType,
            optional,
            this.level + 1,
            this,
        );
        this.fields.push(field);
        return field;
    }

    public remove() {
        super.remove();
        this.clearChildFields();
    }

    protected clearChildFields() {
        if (this.fields.length !== 0) {
            this.fields.forEach((f) => f.remove());
            this.fields.length = 0;
        }
    }

    public deleteValue() {
        super.deleteValue();
        this.clearChildFields();
    }
}

class FieldScalar extends FieldBase {
    private editUI?: {
        div: HTMLDivElement;
        input: HTMLInputElement;
        searchMenu?: SearchMenu;
    };
    constructor(
        data: FieldContainer,
        fullPropertyName: string,
        label: string,
        private readonly fieldType: TemplateFieldScalar,
        optional: boolean = false,
        level: number = 0,
        parent?: FieldGroup,
    ) {
        super(data, fullPropertyName, label, optional, level, parent);

        this.updateValueDisplay();

        if (data.enableEdit) {
            const div = document.createElement("div");
            div.style.position = "relative";

            const input = this.createInputElement();
            div.appendChild(input);

            const valueCell = this.valueCell;
            valueCell.onclick = () => {
                if (!this.data.editMode) {
                    return;
                }

                this.data.setEditing(this);
            };

            input.addEventListener("keydown", (event) => {
                if (this.handleSearchMenuKeys(event)) {
                    return;
                }
                switch (event.key) {
                    case "Enter":
                        event.preventDefault();
                        this.data.setEditing(this.getNextScalarField());
                        break;
                }
            });

            this.editUI = {
                div,
                input,
            };
        }
    }

    private createSearchMenu(
        input: HTMLInputElement,
        choices: SearchMenuItem[],
    ) {
        const searchMenu = new SearchMenu((item) => {
            input.value = item.matchText;
            this.data.setEditing(this.getNextScalarField());
        }, false);
        searchMenu.setChoices(choices);
        input.addEventListener("input", () => {
            this.updateSearchMenu();
        });
        input.addEventListener("focus", () => {
            this.updateSearchMenu();
        });
        input.addEventListener("blur", () => {
            // Delay in case there is a mouse click on the search menu
            setTimeout(() => {
                this.cancelSearchMenu();
            }, 250);
        });
        input.onwheel = (event) => {
            this.editUI?.searchMenu?.handleMouseWheel(event.deltaY);
        };
        return searchMenu;
    }

    public findPrefixField(propertyName: string) {
        if (this.fullPropertyName.startsWith(propertyName)) {
            return this;
        }
        return undefined;
    }

    private cancelSearchMenu() {
        const searchMenu = this.editUI?.searchMenu;
        if (searchMenu?.isActive()) {
            searchMenu.getContainer().remove();
        }
    }

    private updateSearchMenu() {
        if (this.editUI === undefined) {
            return;
        }
        const searchMenu = this.editUI.searchMenu;
        if (searchMenu === undefined) {
            return;
        }

        const value = this.editUI.input.value;
        const items = searchMenu.completePrefix(value);
        if (
            items.length !== 0 &&
            (items.length !== 1 || items[0].matchText !== value)
        ) {
            if (!searchMenu.isActive()) {
                this.editUI.div.appendChild(searchMenu.getContainer());
            }
        } else {
            this.cancelSearchMenu();
        }
    }
    private handleSearchMenuKeys(event: KeyboardEvent): boolean {
        if (this.editUI === undefined) {
            return false;
        }
        const searchMenu = this.editUI.searchMenu;
        if (searchMenu === undefined) {
            return false;
        }
        if (!searchMenu.isActive()) {
            return false;
        }
        if (event.key === "Escape") {
            this.cancelSearchMenu();
            event.preventDefault();
            return true;
        }
        if (searchMenu.handleSpecialKeys(event, this.editUI.input.value)) {
            event.preventDefault();
            return true;
        }
        return false;
    }

    public startEditing() {
        if (this.editUI === undefined) {
            return;
        }
        const { div, input } = this.editUI;
        this.row.classList.add("editing");

        const valueCell = this.valueCell;
        input.value = valueCell.innerText;
        valueCell.replaceChildren(div);
        input.focus();

        this.cancelSearchMenu();

        const fieldType = this.fieldType;
        if (fieldType.type === "string-union") {
            this.editUI.searchMenu = this.createSearchMenu(
                input,
                fieldType.typeEnum.map((e) => ({
                    matchText: e,
                    selectedText: e,
                })),
            );
            this.updateSearchMenu();
        } else if (fieldType.type === "string") {
            const templateConfig = this.data.actionTemplates;
            if (templateConfig.completion === true) {
                const searchMenu = this.createSearchMenu(input, []);
                this.editUI.searchMenu = searchMenu;
                getDispatcher()
                    .getTemplateCompletion(
                        this.data.actionTemplates.templateAgentName,
                        this.data.actionTemplates.templateName,
                        this.data.getSchemaValue(),
                        this.fullPropertyName,
                    )
                    .then((items) => {
                        if (
                            searchMenu !== this.editUI?.searchMenu ||
                            items === undefined
                        ) {
                            return;
                        }
                        searchMenu.setChoices(
                            items.map((e) => ({
                                matchText: e,
                                selectedText: e,
                            })),
                        );
                        this.updateSearchMenu();
                    });
            }
        }
    }

    private getInputValue(type: string, input: HTMLInputElement) {
        if (type === "boolean") {
            return input.checked;
        }
        const inputValue = input.value;
        if (type === "number") {
            const value = parseInt(inputValue);
            if (value.toString() === inputValue) {
                return value;
            }
        }
        return inputValue === "" ? undefined : inputValue;
    }

    public stopEditing() {
        if (this.editUI === undefined) {
            return;
        }
        const input = this.editUI.input;
        if (input === undefined) {
            return true;
        }
        this.cancelSearchMenu();
        this.editUI.searchMenu == undefined;

        const fieldType = this.fieldType;
        const newValue = this.getInputValue(fieldType.type, input);
        this.row.classList.remove("editing");
        this.setValue(newValue);

        if (
            fieldType.type === "string-union" &&
            fieldType.discriminator !== undefined &&
            fieldType.discriminator !== newValue
        ) {
            // Need to refresh the schema
            this.data.refreshSchema(
                parseInt(this.fullPropertyName.split(".")[0]),
            );
            return false;
        }
        return true;
    }

    public getScalarField(): FieldScalar | undefined {
        return this;
    }
    public getSchemaValue() {
        return this.getValue();
    }
    private createInputElement() {
        const element: HTMLInputElement = document.createElement("input");
        switch (this.fieldType.type) {
            case "string":
            case "number":
            case "string-union":
                element.type = "text";
                return element;
            case "boolean":
                element.type = "checkbox";
                return element;
        }
    }

    protected isValidValue(value: any) {
        const fieldType = this.fieldType;
        return fieldType.type === "string-union"
            ? fieldType.typeEnum.includes(value)
            : typeof value === fieldType.type && value !== "";
    }
}

const enum ButtonIndex {
    up = 0,
    down = 1,
    add = 2,
    delete = 3,
}

class FieldObject extends FieldGroup {
    constructor(
        data: FieldContainer,
        fullPropertyName: string,
        paramName: string,
        private readonly fieldTypes: Record<string, TemplateField>,
        optional: boolean = false,
        level = 0,
        parent?: FieldGroup,
    ) {
        super(data, fullPropertyName, paramName, optional, level, parent);
        this.updateValueDisplay();
        this.createChildFields();
    }

    protected isValidValue(_value: any) {
        // Object are always valid whether the actual value is correct,
        // The fields will be invalid if the value isn't
        return true;
    }

    private createChildFields() {
        this.clearChildFields();
        for (const [k, v] of Object.entries(this.fieldTypes)) {
            const optional = v.optional ?? false;
            const field = this.createChildField(k, k, v.type, optional);

            if (this.data.enableEdit && optional) {
                field.addButton(
                    ButtonIndex.delete,
                    "✕",
                    "action-button delete-button",
                    () => {
                        field.deleteValue();
                    },
                );
            }
        }
    }

    public getSchemaValue() {
        const value: Record<string, any> = {};
        const fieldEntries = Object.entries(this.fieldTypes);
        for (let i = 0; i < fieldEntries.length; i++) {
            const name = fieldEntries[i][0];
            const field = this.fields[i];
            value[name] = field.getSchemaValue();
        }
        return value;
    }
}

abstract class FieldArrayBase extends FieldGroup {
    constructor(
        data: FieldContainer,
        fullPropertyName: string,
        paramName: string,
        optional: boolean,
        level: number,
        parent: FieldGroup | undefined,
    ) {
        super(data, fullPropertyName, paramName, optional, level, parent);

        if (data.enableEdit) {
            this.addButton(ButtonIndex.add, "➕", "action-button", () => {
                const index = this.appendNewValue();
                this.createChildIndex(index);

                if (index !== 0) {
                    this.updateArrows(this.fields[index - 1], index - 1);
                }
            });
        }
    }

    protected isValidValue(value: any) {
        return Array.isArray(value) && value.length !== 0;
    }

    public getSchemaValue() {
        return this.fields.map((f) => f.getSchemaValue());
    }

    protected createChildFields() {
        this.clearChildFields();

        const items = this.getArray()?.length ?? 0;
        for (let i = 0; i < items; i++) {
            this.createChildIndex(i);
        }
    }

    protected abstract appendNewValue();
    protected abstract getArray();
    protected abstract createChildIndexField(index: number): FieldBase;

    private updateArrows(field: FieldBase, index: number) {
        field.showButton(0, index !== 0);
        field.showButton(1, index + 1 !== this.getArray()?.length);
    }

    private swap(indexA: number, indexB: number) {
        const value = this.getArray();
        if (value) {
            if (
                indexA < 0 ||
                indexA >= value.length ||
                indexB < 0 ||
                indexB >= value.length
            ) {
                return;
            }

            // Stop current editing first
            const editingField = this.data.setEditing(undefined);

            // Determine if we need to reselect the editing field
            let editingFieldName: string | undefined;
            if (editingField) {
                const fieldA = this.fields[indexA];
                const selectedSuffixA =
                    editingField?.getPropertyNameSuffix(fieldA);
                if (selectedSuffixA) {
                    editingFieldName = `${this.fullPropertyName}.${indexB}${selectedSuffixA}`;
                } else {
                    const fieldB = this.fields[indexB];
                    const selectedSuffixB =
                        editingField?.getPropertyNameSuffix(fieldB);
                    if (selectedSuffixB) {
                        editingFieldName = `${this.fullPropertyName}.${indexA}${selectedSuffixB}`;
                    }
                }
            }

            // Swap the value and recreate the fiels.
            const item = value.splice(indexA, 1)[0];
            value.splice(indexB, 0, item);
            this.createChildFields();

            // reselecting the editing field
            if (editingFieldName) {
                const prefixField = this.findPrefixField(editingFieldName);
                if (prefixField !== undefined) {
                    this.data.setEditing(prefixField.getScalarField());
                }
            }
        }
    }

    private createChildIndex(index: number) {
        const field = this.createChildIndexField(index);
        field.addButton(ButtonIndex.up, "⬆", "action-button", () => {
            this.swap(index, index - 1);
        });
        field.addButton(ButtonIndex.down, "⬇", "action-button", () => {
            this.swap(index, index + 1);
        });

        this.updateArrows(field, index);
        field.addButton(
            ButtonIndex.delete,
            "✕",
            "action-button delete-button",
            () => {
                const value = this.getArray();
                if (value) {
                    const editingField = this.data.setEditing(undefined);
                    let isEditing = editingField?.isAncestor(field);

                    value.splice(index, 1);
                    this.createChildFields();

                    if (value.length === 0) {
                        this.setValid(false);
                    } else if (isEditing) {
                        if (index < this.fields.length) {
                            this.data.setEditing(
                                this.fields[index].getScalarField(),
                            );
                        } else {
                            this.data.setEditing(
                                this.fields[
                                    this.fields.length - 1
                                ].getScalarField(),
                            );
                        }
                    }
                }
            },
        );

        return field;
    }
}

class FieldArray extends FieldArrayBase {
    constructor(
        data: FieldContainer,
        fullPropertyName: string,
        paramName: string,
        private readonly paramValue: TemplateFieldArray,
        optional: boolean,
        level: number,
        parent: FieldGroup | undefined,
    ) {
        super(data, fullPropertyName, paramName, optional, level, parent);
        this.updateValueDisplay();
        this.createChildFields();
    }

    protected appendNewValue() {
        const value = this.ensureArray();
        const index = value.length;
        value.push(undefined);
        this.setValid(true);
        return index;
    }

    private ensureArray() {
        const value = this.getValue();
        if (Array.isArray(value)) {
            return value;
        }
        const newArray = [];
        this.setValue(newArray);
        return newArray;
    }

    protected createChildIndexField(index: number) {
        return this.createChildField(
            index,
            `[${index}]`,
            this.paramValue.elementType,
            false,
        );
    }
    protected getArray() {
        const value = this.getValue();
        return Array.isArray(value) ? value : undefined;
    }
}

class FieldRootArray extends FieldArrayBase {
    constructor(
        data: FieldContainer,
        label: string,
        private readonly defaultTemplate: TemplateSchema,
    ) {
        super(data, "", label, false, 0, undefined);
        this.updateValueDisplay();
        this.createChildFields();
    }
    protected appendNewValue() {
        const value = this.getArray();
        const index = value.length;
        value.push({
            data: {},
            schema: this.defaultTemplate,
        });
        this.setValid(true);
        return index;
    }
    protected getArray() {
        return this.getValue() as TemplateData[];
    }
    protected createChildIndexField(index: number) {
        return this.createChildField(
            `${index}.data`,
            `[${index}]`,
            this.getArray()[index].schema,
            false,
        );
    }

    public refresh() {
        this.createChildFields();
    }
}

class FieldEditor {
    private data: FieldContainer;

    constructor(
        appendTo: HTMLElement,
        actionTemplates: TemplateEditConfig,
        enableEdit = true,
    ) {
        this.data = new FieldContainer(actionTemplates, enableEdit);
        appendTo.appendChild(this.data.table);
    }

    public get value() {
        return this.data.getSchemaValue();
    }

    public get hasErrors() {
        return this.data.errorCount !== 0;
    }

    public reset() {
        this.data.reset();
    }

    public setEditMode(editMode: boolean) {
        this.data.editMode = editMode;
    }
}

export class TemplateEditor {
    private readonly container: HTMLDivElement;
    private readonly fieldEditor: FieldEditor;
    private readonly preface: HTMLDivElement;
    private editMode = false;

    constructor(
        appendTo: HTMLElement,
        private readonly actionTemplates: TemplateEditConfig,
        private readonly enableEdit = true,
    ) {
        this.container = document.createElement("div");
        this.container.className = "action-text";
        appendTo.appendChild(this.container);

        this.preface = document.createElement("div");
        this.container.appendChild(this.preface);

        this.preface.innerText = this.actionTemplates.preface ?? "";

        this.fieldEditor = new FieldEditor(
            this.container,
            actionTemplates,
            enableEdit,
        );
    }

    public get value() {
        return this.fieldEditor.value;
    }

    public get hasErrors() {
        return this.fieldEditor.hasErrors;
    }

    public reset() {
        this.fieldEditor.reset();
    }

    public setEditMode(editMode: boolean) {
        if (this.editMode === editMode) {
            return;
        }
        if (!this.enableEdit && editMode === true) {
            throw new Error(
                "Cannot set edit mode to true on a non-editable action cascade",
            );
        }

        this.editMode = editMode;
        this.fieldEditor.setEditMode(editMode);
        if (editMode) {
            this.container.classList.add("action-text-editable");
            this.preface.innerText = this.actionTemplates.editPreface ?? "";
        } else {
            this.container.classList.remove("action-text-editable");
            this.preface.innerText = this.actionTemplates.preface ?? "";
        }
    }

    public remove() {
        this.container.remove();
    }
}
