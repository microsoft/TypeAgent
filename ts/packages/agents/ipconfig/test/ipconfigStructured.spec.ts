// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit tests for buildStructuredOutput in ipconfigActionHandler — it parses
 * raw `ipconfig` text into a StructuredContent document of per-section
 * heading + keyValue blocks with a rawData payload keyed by section.
 */

import { buildStructuredOutput } from "../src/ipconfigActionHandler.js";

const SAMPLE = [
    "Windows IP Configuration",
    "",
    "Ethernet adapter Ethernet:",
    "",
    "   Connection-specific DNS Suffix  . : example.com",
    "   IPv4 Address. . . . . . . . . . . : 192.168.1.10",
    "   Subnet Mask . . . . . . . . . . . : 255.255.255.0",
    "   Default Gateway . . . . . . . . . : 192.168.1.1",
    "",
    "Wireless LAN adapter Wi-Fi:",
    "",
    "   Media State . . . . . . . . . . . : Media disconnected",
].join("\r\n");

function content(raw: string) {
    return (buildStructuredOutput(raw).displayContent as any);
}

describe("buildStructuredOutput", () => {
    test("produces a structured displayContent", () => {
        expect(content(SAMPLE).type).toBe("structured");
    });

    test("emits a heading block per section", () => {
        const headings = content(SAMPLE)
            .blocks.filter((b: any) => b.kind === "heading")
            .map((b: any) => b.text);
        expect(headings).toEqual(
            expect.arrayContaining([
                "Ethernet adapter Ethernet",
                "Wireless LAN adapter Wi-Fi",
            ]),
        );
    });

    test("parses dotted key/value lines into keyValue pairs", () => {
        const kv = content(SAMPLE).blocks.find(
            (b: any) => b.kind === "keyValue",
        );
        const ip = kv.pairs.find((p: any) => p.label === "IPv4 Address");
        expect(ip.value).toBe("192.168.1.10");
    });

    test("rawData is keyed by section heading", () => {
        const raw = content(SAMPLE).rawData;
        expect(raw["Ethernet adapter Ethernet"]["Subnet Mask"]).toBe(
            "255.255.255.0",
        );
    });

    test("empty values render as an em dash", () => {
        const raw = "Adapter X:\r\n   Empty Field . . . . . . . . . . . :";
        const kv = content(raw).blocks.find((b: any) => b.kind === "keyValue");
        expect(kv.pairs[0].value).toBe("—");
    });

    test("falls back to text when nothing parses", () => {
        // Only blank lines produce no blocks → plain text display.
        const result = buildStructuredOutput("\r\n   \r\n");
        expect((result.displayContent as any).type).not.toBe("structured");
    });

    test("a bare header line becomes a heading block", () => {
        const result = buildStructuredOutput("Some Section:");
        const c = result.displayContent as any;
        expect(c.type).toBe("structured");
        expect(c.blocks[0]).toMatchObject({
            kind: "heading",
            text: "Some Section",
        });
    });
});
