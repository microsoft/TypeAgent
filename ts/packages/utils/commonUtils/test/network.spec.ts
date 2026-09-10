// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createPinnedLookup,
    isPublicIpAddress,
    PrivateNetworkTargetError,
    resolvePublicIpAddress,
    type HostnameResolver,
} from "../src/network.js";

describe("public IP validation", () => {
    test.each([
        "1.1.1.1",
        "8.8.8.8",
        "192.31.196.1",
        "2001:1::1",
        "2001:3::1",
        "2001:4:112::1",
        "2001:20::1",
        "2001:30::1",
        "2001:4860:4860::8888",
        "2606:4700:4700::1111",
        "3000::1",
    ])("accepts globally routable address %s", (address) => {
        expect(isPublicIpAddress(address)).toBe(true);
    });

    test.each([
        "0.0.0.0",
        "10.0.0.1",
        "100.64.0.1",
        "127.0.0.2",
        "169.254.169.254",
        "172.31.255.255",
        "192.0.0.1",
        "192.0.2.1",
        "192.88.99.1",
        "192.168.1.1",
        "198.18.0.1",
        "198.51.100.1",
        "203.0.113.1",
        "224.0.0.1",
        "255.255.255.255",
        "[::]",
        "[::1]",
        "::ffff:a9fe:a9fe",
        "64:ff9b::a9fe:a9fe",
        "64:ff9b:1::a9fe:a9fe",
        "100::1",
        "100:0:0:1::1",
        "2001::1",
        "2001:2::1",
        "2001:db8::1",
        "2002:a9fe:a9fe::",
        "3fff::1",
        "5f00::1",
        "fc00::1",
        "fe80::1",
        "ff00::1",
    ])("rejects non-public address %s", (address) => {
        expect(isPublicIpAddress(address)).toBe(false);
    });
});

describe("pinned DNS lookup", () => {
    test("fixes the address family and returns the validated address", () => {
        const pinned = createPinnedLookup({
            address: "192.31.196.1",
            family: 4,
        });

        expect(pinned.family).toBe(4);
        pinned.lookup("ignored.example", {}, (error, address, family) => {
            expect(error).toBeNull();
            expect(address).toBe("192.31.196.1");
            expect(family).toBe(4);
        });
    });
});

describe("public hostname resolution", () => {
    const resolver =
        (
            ...addresses: { address: string; family: number }[]
        ): HostnameResolver =>
        async () =>
            addresses;

    test("returns a public literal without a DNS lookup", async () => {
        let called = false;
        const resolveHostname: HostnameResolver = async () => {
            called = true;
            return [];
        };

        await expect(
            resolvePublicIpAddress("[2001:4860:4860::8888]", resolveHostname),
        ).resolves.toEqual({
            address: "2001:4860:4860::8888",
            family: 6,
        });
        expect(called).toBe(false);
    });

    test("rejects a hostname that resolves to a private address", async () => {
        await expect(
            resolvePublicIpAddress(
                "attacker.example",
                resolver({ address: "169.254.169.254", family: 4 }),
            ),
        ).rejects.toBeInstanceOf(PrivateNetworkTargetError);
    });

    test("rejects a hostname with mixed public and private answers", async () => {
        await expect(
            resolvePublicIpAddress(
                "attacker.example",
                resolver(
                    { address: "1.1.1.1", family: 4 },
                    { address: "10.0.0.1", family: 4 },
                ),
            ),
        ).rejects.toThrow("Private network target");
    });

    test("returns one address only after validating every DNS answer", async () => {
        await expect(
            resolvePublicIpAddress(
                "public.example",
                resolver(
                    { address: "2001:4860:4860::8888", family: 6 },
                    { address: "1.1.1.1", family: 4 },
                ),
            ),
        ).resolves.toEqual({
            address: "2001:4860:4860::8888",
            family: 6,
        });
    });

    test.each([
        "localhost",
        "service.localhost.",
        "printer.local",
        "service.internal",
        "router.home.arpa",
    ])("rejects reserved local hostname %s without DNS", async (hostname) => {
        let called = false;
        const resolveHostname: HostnameResolver = async () => {
            called = true;
            return [];
        };

        await expect(
            resolvePublicIpAddress(hostname, resolveHostname),
        ).rejects.toThrow("Private network target");
        expect(called).toBe(false);
    });
});
