// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

(function (original) {
    Element.prototype.addEventListener = function (type, listener, useCapture) {
        if (typeof this._handlerTypes == "undefined") {
            this._handlerTypes = {};
        }
        this._handlerTypes[type] = true;
        this.setAttribute("handler_" + type, true);
        return original.apply(this, arguments);
    };
})(Element.prototype.addEventListener);

(function (original) {
    Element.prototype.removeEventListener = function (
        type,
        listener,
        useCapture,
    ) {
        if (typeof this._handlerTypes != "undefined") {
            delete this._handlerTypes[type];
            this.removeAttribute("handler_" + type);
        }
        return original.apply(this, arguments);
    };
})(Element.prototype.removeEventListener);
