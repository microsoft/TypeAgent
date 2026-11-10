/**
 * A platform subset: the part of the web's DOM that web implementations
 * may use. It is not part of the blueprint. Its names and signatures
 * are the DOM's, and so is its meaning, so it has no rules of its own; a
 * browser is the reference.
 *
 * Two checks keep it honest, as for canvas.ts. platform/dom.check.ts
 * compiles with the DOM library and fails unless the browser's types fit.
 * The second, a recording document that implements only these members, so
 * that an implementation that needs more fails to compile, went with the
 * web renderer (domkit.ts); a new one comes with the web app (STATE.md).
 *
 * Members are added when an implementation spec decides to use them, not
 * before.
 *
 * @module
 */

/** The part of an Event a listener may read. */
export interface DomEvent {
  readonly type: string;
}

/** The part of a CSSStyleDeclaration a renderer may use. */
export interface DomStyle {
  setProperty(property: string, value: string): void;
}

/**
 * What element-taking members accept: any node. Only elements made by the
 * document are ever passed.
 */
export interface DomNode {
  readonly nodeType: number;
}

/** The part of an HTMLElement a renderer may use. */
export interface DomElement extends DomNode {
  readonly tagName: string;
  textContent: string | null;
  readonly style: DomStyle;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getAttribute(name: string): string | null;
  /** Appends nodes (a string as text), moving any that are already elsewhere, in order. */
  append(...nodes: (DomNode | string)[]): void;
  /** Replaces the children with nodes, in order. */
  replaceChildren(...nodes: (DomNode | string)[]): void;
  /** Removes the element from its parent. */
  remove(): void;
  addEventListener(type: string, listener: (event: DomEvent) => void): void;
  removeEventListener(type: string, listener: (event: DomEvent) => void): void;
}

/** The part of an HTMLInputElement a renderer may use, for sliders. */
export interface DomInputElement extends DomElement {
  /** The current value as a string; setting it fires no event. */
  value: string;
  disabled: boolean;
}

/** The part of an HTMLButtonElement a renderer may use. */
export interface DomButtonElement extends DomElement {
  disabled: boolean;
}

/** The part of a Document a renderer may use. */
export interface DomDocument {
  createElement(tagName: "div"): DomElement;
  createElement(tagName: "button"): DomButtonElement;
  createElement(tagName: "input"): DomInputElement;
}
