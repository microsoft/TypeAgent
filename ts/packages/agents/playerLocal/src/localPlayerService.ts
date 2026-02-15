// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn, execSync, ChildProcess } from "child_process";
import registerDebug from "debug";

const debug = registerDebug("typeagent:localPlayer");
const debugError = registerDebug("typeagent:localPlayer:error");

// Media player definitions per platform
interface MediaPlayerDef {
    name: string;
    command: string;
    buildArgs: (filePath: string, volume: number) => string[];
    supportsPauseResume: boolean;
}

const MACOS_PLAYERS: MediaPlayerDef[] = [
    {
        name: "afplay",
        command: "afplay",
        buildArgs: (filePath, volume) => [
            "-v",
            String(volume),
            filePath,
        ],
        supportsPauseResume: true, // supports SIGSTOP/SIGCONT
    },
    {
        name: "mpv",
        command: "mpv",
        buildArgs: (filePath, volume) => [
            "--no-video",
            `--volume=${Math.round(volume * 100)}`,
            filePath,
        ],
        supportsPauseResume: true,
    },
    {
        name: "ffplay",
        command: "ffplay",
        buildArgs: (filePath, volume) => [
            "-nodisp",
            "-autoexit",
            "-volume",
            String(Math.round(volume * 100)),
            filePath,
        ],
        supportsPauseResume: true,
    },
    {
        name: "VLC",
        command: "/Applications/VLC.app/Contents/MacOS/VLC",
        buildArgs: (filePath, volume) => [
            "--intf",
            "dummy",
            "--play-and-exit",
            `--gain=${volume}`,
            filePath,
        ],
        supportsPauseResume: true,
    },
];

const LINUX_PLAYERS: MediaPlayerDef[] = [
    {
        name: "mpv",
        command: "mpv",
        buildArgs: (filePath, volume) => [
            "--no-video",
            `--volume=${Math.round(volume * 100)}`,
            filePath,
        ],
        supportsPauseResume: true,
    },
    {
        name: "ffplay",
        command: "ffplay",
        buildArgs: (filePath, volume) => [
            "-nodisp",
            "-autoexit",
            "-volume",
            String(Math.round(volume * 100)),
            filePath,
        ],
        supportsPauseResume: true,
    },
    {
        name: "vlc",
        command: "cvlc",
        buildArgs: (filePath, volume) => [
            "--play-and-exit",
            `--gain=${volume}`,
            filePath,
        ],
        supportsPauseResume: true,
    },
    {
        name: "aplay",
        command: "aplay",
        buildArgs: (filePath) => [filePath],
        supportsPauseResume: true, // supports SIGSTOP/SIGCONT
    },
    {
        name: "paplay",
        command: "paplay",
        buildArgs: (filePath) => [filePath],
        supportsPauseResume: false,
    },
];

/**
 * Check if a command is available on the system.
 */
function isCommandAvailable(command: string): boolean {
    try {
        const checkCmd =
            process.platform === "win32"
                ? `where ${command}`
                : `which ${command}`;
        execSync(checkCmd, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

/**
 * Find the first available media player for the current platform.
 * Results are cached after the first call.
 */
let cachedPlayer: MediaPlayerDef | null | undefined;
function findAvailablePlayer(): MediaPlayerDef | null {
    if (cachedPlayer !== undefined) {
        return cachedPlayer;
    }

    const candidates =
        process.platform === "darwin" ? MACOS_PLAYERS : LINUX_PLAYERS;

    for (const player of candidates) {
        // For absolute paths (e.g. VLC on macOS), check if the file exists
        if (player.command.startsWith("/")) {
            if (fs.existsSync(player.command)) {
                debug(`Found media player: ${player.name} (${player.command})`);
                cachedPlayer = player;
                return player;
            }
        } else if (isCommandAvailable(player.command)) {
            debug(`Found media player: ${player.name}`);
            cachedPlayer = player;
            return player;
        }
    }

    debugError(
        `No supported media player found. Tried: ${candidates.map((p) => p.name).join(", ")}`,
    );
    cachedPlayer = null;
    return null;
}

// Supported audio file extensions
const AUDIO_EXTENSIONS = [
    ".mp3",
    ".wav",
    ".ogg",
    ".flac",
    ".m4a",
    ".aac",
    ".wma",
];

export interface Track {
    name: string;
    path: string;
    duration?: number;
    artist?: string;
    album?: string;
}

export interface PlaybackState {
    isPlaying: boolean;
    isPaused: boolean;
    currentTrack: Track | null;
    currentIndex: number;
    volume: number;
    isMuted: boolean;
    shuffle: boolean;
    repeat: "off" | "one" | "all";
    queue: Track[];
}

/**
 * Determine the default music folder for the current platform.
 *
 * - Windows / macOS: ~/Music (the OS convention)
 * - Linux: Reads XDG_MUSIC_DIR from the environment or ~/.config/user-dirs.dirs,
 *   falling back to ~/Music if neither is set or the directory doesn't exist.
 */
function getDefaultMusicFolder(): string {
    const fallback = path.join(os.homedir(), "Music");

    if (process.platform !== "linux") {
        // Windows and macOS both use ~/Music by convention
        return fallback;
    }

    // 1. Check the XDG_MUSIC_DIR environment variable
    const xdgEnv = process.env.XDG_MUSIC_DIR;
    if (xdgEnv) {
        const resolved = xdgEnv.replace(/^\$HOME/, os.homedir());
        if (fs.existsSync(resolved)) {
            debug(`Using XDG_MUSIC_DIR: ${resolved}`);
            return resolved;
        }
    }

    // 2. Parse ~/.config/user-dirs.dirs
    const userDirsPath = path.join(
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
        "user-dirs.dirs",
    );
    try {
        if (fs.existsSync(userDirsPath)) {
            const content = fs.readFileSync(userDirsPath, "utf8");
            const match = content.match(
                /^XDG_MUSIC_DIR\s*=\s*"?([^"\n]+)"?\s*$/m,
            );
            if (match) {
                const dir = match[1].replace(/^\$HOME/, os.homedir());
                if (fs.existsSync(dir)) {
                    debug(`Using music dir from user-dirs.dirs: ${dir}`);
                    return dir;
                }
            }
        }
    } catch (e) {
        debug(`Failed to read user-dirs.dirs: ${e}`);
    }

    return fallback;
}

export class LocalPlayerService {
    private state: PlaybackState;
    private musicFolder: string;
    private playerProcess: ChildProcess | null = null;
    private activePlayer: MediaPlayerDef | null = null;

    constructor() {
        // Default music folder (platform-aware)
        this.musicFolder = getDefaultMusicFolder();

        this.state = {
            isPlaying: false,
            isPaused: false,
            currentTrack: null,
            currentIndex: -1,
            volume: 50,
            isMuted: false,
            shuffle: false,
            repeat: "off",
            queue: [],
        };
    }

    public getMusicFolder(): string {
        return this.musicFolder;
    }

    public setMusicFolder(folderPath: string): boolean {
        if (
            fs.existsSync(folderPath) &&
            fs.statSync(folderPath).isDirectory()
        ) {
            this.musicFolder = folderPath;
            debug(`Music folder set to: ${folderPath}`);
            return true;
        }
        debugError(`Invalid folder path: ${folderPath}`);
        return false;
    }

    public getState(): PlaybackState {
        return { ...this.state };
    }

    public listFiles(folderPath?: string): Track[] {
        const folder = folderPath || this.musicFolder;
        const tracks: Track[] = [];

        try {
            if (!fs.existsSync(folder)) {
                debug(`Folder does not exist: ${folder}`);
                return tracks;
            }

            const files = fs.readdirSync(folder);
            for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                if (AUDIO_EXTENSIONS.includes(ext)) {
                    tracks.push({
                        name: path.basename(file, ext),
                        path: path.join(folder, file),
                    });
                }
            }
        } catch (error) {
            debugError(`Error listing files: ${error}`);
        }

        return tracks;
    }

    public searchFiles(query: string): Track[] {
        const allFiles = this.listFilesRecursive(this.musicFolder);
        const lowerQuery = query.toLowerCase();

        return allFiles.filter((track) =>
            track.name.toLowerCase().includes(lowerQuery),
        );
    }

    private listFilesRecursive(folder: string): Track[] {
        const tracks: Track[] = [];

        try {
            const entries = fs.readdirSync(folder, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(folder, entry.name);

                if (entry.isDirectory()) {
                    tracks.push(...this.listFilesRecursive(fullPath));
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (AUDIO_EXTENSIONS.includes(ext)) {
                        tracks.push({
                            name: path.basename(entry.name, ext),
                            path: fullPath,
                        });
                    }
                }
            }
        } catch (error) {
            debugError(`Error reading folder ${folder}: ${error}`);
        }

        return tracks;
    }

    public async playFile(fileName: string): Promise<boolean> {
        // Search for the file
        const tracks = this.searchFiles(fileName);

        if (tracks.length === 0) {
            debugError(`No files found matching: ${fileName}`);
            return false;
        }

        // Play the first match
        return this.playTrack(tracks[0]);
    }

    public async playTrack(track: Track): Promise<boolean> {
        // Stop any current playback
        this.stop();

        try {
            debug(`Playing: ${track.path}`);

            if (process.platform === "win32") {
                // Use Windows Media Player via PowerShell
                const escapedPath = track.path.replace(/'/g, "''");
                const volume = this.state.volume / 100;
                const psScript =
                    `Add-Type -AssemblyName PresentationCore; ` +
                    `$player = New-Object System.Windows.Media.MediaPlayer; ` +
                    `$player.Open([Uri]'${escapedPath}'); ` +
                    `$player.Volume = [double]${volume}; ` +
                    `$player.Play(); ` +
                    `Start-Sleep -Seconds 3600`;

                this.playerProcess = spawn(
                    "powershell",
                    [
                        "-NoProfile",
                        "-NonInteractive",
                        "-ExecutionPolicy",
                        "Bypass",
                        "-Command",
                        psScript,
                    ],
                    {
                        stdio: ["ignore", "ignore", "ignore"],
                        shell: false,
                    },
                );
                this.activePlayer = null;
            } else {
                // macOS / Linux: find an available media player
                const player = findAvailablePlayer();
                if (!player) {
                    debugError(
                        "No media player available. Install mpv, ffplay, or vlc.",
                    );
                    return false;
                }

                const volume = this.state.volume / 100;
                const args = player.buildArgs(track.path, volume);

                debug(
                    `Using ${player.name}: ${player.command} ${args.join(" ")}`,
                );

                this.playerProcess = spawn(player.command, args, {
                    stdio: ["ignore", "ignore", "ignore"],
                    shell: false,
                });
                this.activePlayer = player;
            }

            this.playerProcess.on("error", (error) => {
                debugError(`Player error: ${error}`);
            });

            this.playerProcess.on("exit", () => {
                debug("Playback ended");
                this.handlePlaybackEnd();
            });

            this.state.isPlaying = true;
            this.state.isPaused = false;
            this.state.currentTrack = track;

            // Find index in queue
            const index = this.state.queue.findIndex(
                (t) => t.path === track.path,
            );
            if (index >= 0) {
                this.state.currentIndex = index;
            }

            return true;
        } catch (error) {
            debugError(`Error playing track: ${error}`);
            return false;
        }
    }

    private handlePlaybackEnd(): void {
        this.state.isPlaying = false;

        if (this.state.repeat === "one" && this.state.currentTrack) {
            // Repeat current track
            this.playTrack(this.state.currentTrack);
        } else if (
            this.state.queue.length > 0 &&
            this.state.currentIndex < this.state.queue.length - 1
        ) {
            // Play next in queue
            this.next();
        } else if (this.state.repeat === "all" && this.state.queue.length > 0) {
            // Repeat all - go back to start
            this.state.currentIndex = 0;
            this.playTrack(this.state.queue[0]);
        }
    }

    public pause(): boolean {
        if (this.playerProcess && this.state.isPlaying) {
            if (process.platform === "win32") {
                // Windows: kill and restart on resume (no SIGSTOP support)
                this.playerProcess.kill();
                this.playerProcess = null;
            } else if (
                this.activePlayer &&
                this.activePlayer.supportsPauseResume
            ) {
                // macOS/Linux: SIGSTOP suspends the player process
                this.playerProcess.kill("SIGSTOP");
            } else {
                // Player doesn't support pause; kill and restart on resume
                this.playerProcess.kill();
                this.playerProcess = null;
            }
            this.state.isPaused = true;
            this.state.isPlaying = false;
            debug("Paused");
            return true;
        }
        return false;
    }

    public resume(): boolean {
        if (this.state.isPaused && this.state.currentTrack) {
            if (
                this.playerProcess &&
                this.activePlayer?.supportsPauseResume
            ) {
                // macOS/Linux: SIGCONT resumes a suspended process
                this.playerProcess.kill("SIGCONT");
            } else {
                // No active process or no pause/resume support; restart playback
                this.playTrack(this.state.currentTrack);
            }
            this.state.isPaused = false;
            this.state.isPlaying = true;
            debug("Resumed");
            return true;
        }
        return false;
    }

    public stop(): boolean {
        if (this.playerProcess) {
            this.playerProcess.kill();
            this.playerProcess = null;
        }
        this.state.isPlaying = false;
        this.state.isPaused = false;
        debug("Stopped");
        return true;
    }

    public async next(): Promise<boolean> {
        if (this.state.queue.length === 0) {
            return false;
        }

        let nextIndex = this.state.currentIndex + 1;

        if (this.state.shuffle) {
            const queueLength = this.state.queue.length;
            if (queueLength > 1) {
                let randomIndex: number;
                do {
                    randomIndex = Math.floor(Math.random() * queueLength);
                } while (randomIndex === this.state.currentIndex);
                nextIndex = randomIndex;
            } else {
                // Only one track in the queue; keep index at 0
                nextIndex = 0;
            }
        }

        if (nextIndex >= this.state.queue.length) {
            if (this.state.repeat === "all") {
                nextIndex = 0;
            } else {
                return false;
            }
        }

        this.state.currentIndex = nextIndex;
        return await this.playTrack(this.state.queue[nextIndex]);
    }

    public async previous(): Promise<boolean> {
        if (this.state.queue.length === 0) {
            return false;
        }

        let prevIndex = this.state.currentIndex - 1;

        if (prevIndex < 0) {
            if (this.state.repeat === "all") {
                prevIndex = this.state.queue.length - 1;
            } else {
                prevIndex = 0;
            }
        }

        this.state.currentIndex = prevIndex;
        return await this.playTrack(this.state.queue[prevIndex]);
    }

    public setVolume(level: number): boolean {
        this.state.volume = Math.max(0, Math.min(100, level));
        debug(`Volume set to: ${this.state.volume}`);
        // Note: Changing volume during playback requires player-specific implementation
        return true;
    }

    public changeVolume(amount: number): boolean {
        return this.setVolume(this.state.volume + amount);
    }

    public mute(): boolean {
        this.state.isMuted = true;
        debug("Muted");
        return true;
    }

    public unmute(): boolean {
        this.state.isMuted = false;
        debug("Unmuted");
        return true;
    }

    public setShuffle(on: boolean): boolean {
        this.state.shuffle = on;
        debug(`Shuffle: ${on}`);
        return true;
    }

    public setRepeat(mode: "off" | "one" | "all"): boolean {
        this.state.repeat = mode;
        debug(`Repeat mode: ${mode}`);
        return true;
    }

    public addToQueue(track: Track): boolean {
        this.state.queue.push(track);
        debug(`Added to queue: ${track.name}`);
        return true;
    }

    public addFileToQueue(fileName: string): boolean {
        const tracks = this.searchFiles(fileName);
        if (tracks.length > 0) {
            return this.addToQueue(tracks[0]);
        }
        return false;
    }

    public clearQueue(): boolean {
        this.state.queue = [];
        this.state.currentIndex = -1;
        debug("Queue cleared");
        return true;
    }

    public getQueue(): Track[] {
        return [...this.state.queue];
    }

    public async playFromQueue(index: number): Promise<boolean> {
        // Convert from 1-based to 0-based index
        const zeroIndex = index - 1;

        if (zeroIndex >= 0 && zeroIndex < this.state.queue.length) {
            this.state.currentIndex = zeroIndex;
            return await this.playTrack(this.state.queue[zeroIndex]);
        }
        return false;
    }

    public async playFolder(
        folderPath?: string,
        shuffle: boolean = false,
    ): Promise<boolean> {
        const tracks = this.listFiles(folderPath);

        if (tracks.length === 0) {
            return false;
        }

        this.state.queue = shuffle ? this.shuffleArray(tracks) : tracks;
        this.state.shuffle = shuffle;
        this.state.currentIndex = 0;

        return await this.playTrack(this.state.queue[0]);
    }

    private shuffleArray<T>(array: T[]): T[] {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
}

// Singleton instance
let playerInstance: LocalPlayerService | null = null;

export function getLocalPlayerService(): LocalPlayerService {
    if (!playerInstance) {
        playerInstance = new LocalPlayerService();
    }
    return playerInstance;
}
