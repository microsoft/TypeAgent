// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LocalPlayerService } from "../src/localPlayerService.js";

describe("LocalPlayerService", () => {
    let testDir: string;
    let playerService: LocalPlayerService;

    beforeAll(() => {
        // Create a temp directory structure for testing
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), "localPlayer-test-"));

        // Create nested directory structure with audio files
        // testDir/
        //   song1.mp3
        //   subdir1/
        //     song2.mp3
        //     subdir2/
        //       song3.mp3
        //       song4.wav
        //   other/
        //     song5.flac

        fs.writeFileSync(path.join(testDir, "song1.mp3"), "");

        const subdir1 = path.join(testDir, "subdir1");
        fs.mkdirSync(subdir1);
        fs.writeFileSync(path.join(subdir1, "song2.mp3"), "");

        const subdir2 = path.join(subdir1, "subdir2");
        fs.mkdirSync(subdir2);
        fs.writeFileSync(path.join(subdir2, "song3.mp3"), "");
        fs.writeFileSync(path.join(subdir2, "song4.wav"), "");

        const other = path.join(testDir, "other");
        fs.mkdirSync(other);
        fs.writeFileSync(path.join(other, "song5.flac"), "");

        // Also add a non-audio file to ensure filtering works
        fs.writeFileSync(path.join(testDir, "readme.txt"), "");
        fs.writeFileSync(path.join(subdir1, "cover.jpg"), "");
    });

    afterAll(() => {
        // Clean up temp directory
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        playerService = new LocalPlayerService();
        playerService.setMusicFolder(testDir);
    });

    describe("listFiles", () => {
        it("should list audio files in the specified folder (non-recursive)", () => {
            const files = playerService.listFiles();

            expect(files).toHaveLength(1);
            expect(files[0].name).toBe("song1");
            expect(files[0].path).toBe(path.join(testDir, "song1.mp3"));
        });

        it("should not include non-audio files", () => {
            const files = playerService.listFiles();

            const names = files.map((f) => f.name);
            expect(names).not.toContain("readme");
        });
    });

    describe("searchFiles (recursive)", () => {
        it("should find all audio files recursively", () => {
            const files = playerService.searchFiles("");

            expect(files).toHaveLength(5);
        });

        it("should find files in nested subdirectories", () => {
            const files = playerService.searchFiles("song3");

            expect(files).toHaveLength(1);
            expect(files[0].name).toBe("song3");
            expect(files[0].path).toBe(
                path.join(testDir, "subdir1", "subdir2", "song3.mp3"),
            );
        });

        it("should find files matching query across all directories", () => {
            const files = playerService.searchFiles("song");

            expect(files).toHaveLength(5);
            const names = files.map((f) => f.name);
            expect(names).toContain("song1");
            expect(names).toContain("song2");
            expect(names).toContain("song3");
            expect(names).toContain("song4");
            expect(names).toContain("song5");
        });

        it("should find different audio formats recursively", () => {
            const wavFiles = playerService.searchFiles("song4");
            expect(wavFiles).toHaveLength(1);
            expect(wavFiles[0].path).toContain(".wav");

            const flacFiles = playerService.searchFiles("song5");
            expect(flacFiles).toHaveLength(1);
            expect(flacFiles[0].path).toContain(".flac");
        });

        it("should be case-insensitive", () => {
            const files = playerService.searchFiles("SONG1");

            expect(files).toHaveLength(1);
            expect(files[0].name).toBe("song1");
        });

        it("should return empty array when no matches found", () => {
            const files = playerService.searchFiles("nonexistent");

            expect(files).toHaveLength(0);
        });

        it("should not include non-audio files in recursive search", () => {
            const files = playerService.searchFiles("");

            const names = files.map((f) => f.name);
            expect(names).not.toContain("readme");
            expect(names).not.toContain("cover");
        });
    });

    describe("setMusicFolder", () => {
        it("should return true for valid folder", () => {
            const result = playerService.setMusicFolder(testDir);
            expect(result).toBe(true);
        });

        it("should return false for non-existent folder", () => {
            const result = playerService.setMusicFolder("/nonexistent/path");
            expect(result).toBe(false);
        });

        it("should update music folder and affect listFiles", () => {
            const subdir = path.join(testDir, "subdir1");
            playerService.setMusicFolder(subdir);

            const files = playerService.listFiles();
            expect(files).toHaveLength(1);
            expect(files[0].name).toBe("song2");
        });
    });
});
