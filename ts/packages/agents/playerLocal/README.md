# Local Music Player TypeAgent

A TypeAgent for playing local audio files without requiring any external service like Spotify.

> **Note:** This agent's commands may collide with the `player` agent (Spotify). It is recommended to enable only one at a time. If you have both enabled, be explicit in your requests by saying "local player" or "music player" for this agent, or "Spotify" for the player agent, otherwise your intent may be routed to the wrong service.

## Features

- **Play local audio files** - MP3, WAV, OGG, FLAC, M4A, AAC, WMA
- **Queue management** - Add files to queue, show queue, clear queue
- **Playback controls** - Play, pause, resume, stop, next, previous
- **Volume control** - Set volume, mute/unmute
- **Shuffle and repeat** - Shuffle mode, repeat one/all
- **File search** - Search for files in your music folder
- **Cross-platform** - Works on Windows, macOS, and Linux

## Setup

No external API keys required! The agent uses the system's built-in audio capabilities:

- **Windows**: Uses PowerShell with Windows Media Player
- **macOS**: Uses `afplay`
- **Linux**: Uses `mpv` (must be installed separately; for example: Debian/Ubuntu: `sudo apt install mpv`, Fedora: `sudo dnf install mpv`, Arch: `sudo pacman -S mpv`)

## Configuration

Set your music folder using the command:

```
@localPlayer folder set /path/to/music
```

Or use natural language:

```
set music folder to C:\Users\Me\Music
```

## Usage

### Enable the agent

In the shell or interactive mode:

```
@config localPlayer on
```

### Example commands

**Play music:**

```
play some music
play song.mp3
play all songs in the folder
```

**Control playback:**

```
pause
resume
stop
next track
previous track
```

**Volume:**

```
set volume to 50
turn up the volume
mute
```

**Queue management:**

```
show the queue
add rock song to queue
clear the queue
play the third track
```

**Browse files:**

```
list files
search for beethoven
show music folder
```

## Available Actions

| Action            | Description                           |
| ----------------- | ------------------------------------- |
| `playFile`        | Play a specific audio file            |
| `playFolder`      | Play all audio files in a folder      |
| `playFromQueue`   | Play a track from the queue by number |
| `status`          | Show current playback status          |
| `pause`           | Pause playback                        |
| `resume`          | Resume playback                       |
| `stop`            | Stop playback                         |
| `next`            | Skip to next track                    |
| `previous`        | Go to previous track                  |
| `shuffle`         | Turn shuffle on/off                   |
| `repeat`          | Set repeat mode (off/one/all)         |
| `setVolume`       | Set volume level (0-100)              |
| `changeVolume`    | Adjust volume by amount               |
| `mute`            | Mute audio                            |
| `unmute`          | Unmute audio                          |
| `listFiles`       | List audio files in folder            |
| `searchFiles`     | Search for files by name              |
| `addToQueue`      | Add file to playback queue            |
| `clearQueue`      | Clear the queue                       |
| `showQueue`       | Display the queue                     |
| `setMusicFolder`  | Set default music folder              |
| `showMusicFolder` | Show current music folder             |

## Supported Audio Formats

- MP3 (.mp3)
- WAV (.wav)
- OGG (.ogg)
- FLAC (.flac)
- M4A (.m4a)
- AAC (.aac)
- WMA (.wma)

## TODOs
- real volume controlling would require a library with api. Currently we can control this only via restart.
- tested only on windows currently. Tests on Linux and macOS will follow.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
