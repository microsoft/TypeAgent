// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from "console";

export interface ListNode {
    next: ListNode | undefined;
    prev: ListNode | undefined;
}

export function detachListNode<T>(node: ListNode): void {
    const next = node.next;
    const prev = node.prev;
    if (next) {
        next.prev = prev;
        node.next = undefined;
    }

    if (prev) {
        prev.next = next;
        node.prev = undefined;
    }
}

export function appendListNode(node: ListNode, appendNode: ListNode): void {
    assert(isSingleton(node));

    var next = node.next;
    if (next) {
        next.prev = appendNode;
        appendNode.next = next;
    }

    node.next = appendNode;
    appendNode.prev = node;
}

export function isHead(node: ListNode): boolean {
    return node.prev === undefined;
}

export function isTail(node: ListNode): boolean {
    return node.next === undefined;
}

export function prependListNode(node: ListNode, prependNode: ListNode): void {
    assert(isSingleton(prependNode));

    var prev = node.prev;
    if (prev) {
        prev.next = prependNode;
        prependNode.prev = prev;
    }
    prependNode.next = node;
    node.prev = prependNode;
}

function isSingleton(node: ListNode): boolean {
    return node.next === undefined && node.prev === undefined;
}

export function* allNodes(
    node: ListNode | undefined,
): IterableIterator<ListNode> {
    let nextNode: ListNode | undefined = node;
    while (nextNode) {
        yield nextNode;
        nextNode = nextNode.next;
    }
}

export function* allNodesReverse(
    node: ListNode | undefined,
): IterableIterator<ListNode> {
    let prevNode: ListNode | undefined = node;
    while (prevNode) {
        yield prevNode;
        prevNode = prevNode.prev;
    }
}

export function getTail(node: ListNode): ListNode | undefined {
    let last = node;
    if (last === undefined) {
        return undefined;
    }
    let next = last.next;
    while (next) {
        last = next;
        next = next.next;
    }

    return last;
}

export interface LinkedList {
    readonly length: number;
    readonly head: ListNode | undefined;
    readonly tail: ListNode | undefined;
    pushHead(node: ListNode): void;
    pushTail(node: ListNode): void;
    popHead(): ListNode | undefined;
    popTail(): ListNode | undefined;
    insertAfter(node: ListNode, nextNode: ListNode): void;
    removeNode(node: ListNode): void;
    makeMRU(node: ListNode): void;
    makeLRU(node: ListNode): void;

    entries(): IterableIterator<ListNode>;
}

export function createLinkedList(): LinkedList {
    let head: ListNode | undefined;
    let tail: ListNode | undefined;
    let count = 0;

    return {
        get length() {
            return count;
        },
        get head() {
            return head;
        },
        get tail() {
            return tail;
        },
        pushHead,
        pushTail,
        popHead,
        popTail,
        insertAfter,
        removeNode,
        makeMRU,
        makeLRU,
        entries,
    };

    function pushHead(node: ListNode): void {
        if (head) {
            prependListNode(head, node);
            head = node;
        } else {
            initList(node);
        }
        ++count;
    }

    function pushTail(node: ListNode): void {
        if (tail) {
            appendListNode(tail, node);
            tail = node;
        } else {
            initList(node);
        }
        ++count;
    }

    function popHead(): ListNode | undefined {
        if (head) {
            const curHead = head;
            removeNode(head);
            return curHead;
        }
        return undefined;
    }

    function popTail(): ListNode | undefined {
        if (tail) {
            const curTail = tail;
            removeNode(tail);
            return curTail;
        }
        return undefined;
    }

    function makeMRU(node: ListNode): void {
        removeNode(node);
        pushHead(node);
    }

    function makeLRU(node: ListNode): void {
        removeNode(node);
        pushTail(node);
    }

    function removeNode(node: ListNode): void {
        if (node === head) {
            head = node.next;
        }
        if (node === tail) {
            tail = node.prev;
        }
        detachListNode(node);
        --count;
    }

    function insertAfter(node: ListNode, nextNode: ListNode): void {
        appendListNode(node, nextNode);
        if (node === tail) {
            tail = nextNode;
        }
        ++count;
    }

    function initList(node: ListNode): void {
        head = tail = node;
    }

    function* entries(): IterableIterator<ListNode> {
        return allNodes(head);
    }
}

export interface ListEntry<T> extends ListNode {
    value: T;
}

export function createListEntry<T>(value: T): ListEntry<T> {
    return {
        next: undefined,
        prev: undefined,
        value: value,
    };
}
