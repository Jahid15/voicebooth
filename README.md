# VoiceBooth

A local voice-over recorder that works one line at a time. It is meant to run alongside Claude Code.

Claude writes the script and adds a delivery cue to every line, for example "😄 মজা করে, হাসি মুখে". It then opens VoiceBooth for you. On screen you see the line in large text with its cue above it. You press record and speak the line. If the take is good you move to the next line; if not, you record it again. When every line is done, one click joins all the takes you kept into a single WAV and writes a timing file for the edit.

```
┌──────────────┬──────────────────────────────────────────────┐
│ ✓ L01 ভাই... │          হুক · লাইন 2 / 12                   │
│ ▸ L02 কখনো...│      ( 🤔  একটু থেমে, কৌতূহল নিয়ে )          │
│ · L03 তাহলে..│  কখনো কি এরকম ভিডিও আপনার বানাইতে মন চাইছে?  │
│              │  NEXT  তাহলে চলেন, আজকে বানাই!               │
│              │   [↻ আবার নিন]   ( ● )   [✓ ভালো হয়েছে]      │
│              │   ▮▮▮▮▮▮▯▯▯ 3.4s     ▶ Take 1   ✓ Take 2       │
└──────────────┴──────────────────────────────────────────────┘
```

## Requirements
- Node.js 20 or later. No npm packages are needed.
- `ffmpeg` on your PATH.
- Chrome or Edge, so the page can use the microphone.

## Run it
```bash
node server.mjs path/to/script.json            # starts the app at http://127.0.0.1:7790 and opens the browser
node server.mjs path/to/script.json --port 7791 --no-open
```
On Windows you can also double-click `open.cmd`, which opens the demo, or drag a `script.json` onto it.

## Keys
| Key | Action |
|---|---|
| Space or mouse click on ● | start or stop recording |
| Enter / ✓ | keep the take you just recorded and go to the next line |
| R / ↻ | record the line again |
| P | play the take you kept |
| ← → | previous or next line |
| click a take | play it and keep it |

## Script format (`script.json`)
```json
{
  "title": "07 Stickman reel",
  "out_dir": "voice",
  "trim_head": 0.12,
  "trim_tail": 0.25,
  "gap": 0.3,
  "lines": [
    { "id": "L01", "section": "হুক", "emoji": "😄",
      "reaction": "মজা করে, হাসি মুখে",
      "text": "ভাই, স্টিকম্যানের এই ভিডিওগুলো দেখতে আসলেই মজা লাগে না?",
      "note": "\"মজা\" শব্দে জোর" }
  ]
}
```
- `text` is required. `id` defaults to L01, L02 and so on. Keep each id fixed once you have recorded takes for that line.
- `reaction` and `emoji` show how to deliver the line. `note` is an optional small hint, and `section` groups lines in the sidebar.
- `trim_head` and `trim_tail` cut the sound of the mouse click from the start and end of each take.
- `gap` is the silence placed between lines in the full export.
- If you edit the script while the app is open, reload the page to see the changes.

## Output (in `out_dir`, next to the script)
```
voice/
  takes/L01_take1.wav ...      every take as mono 48 kHz WAV (the browser's raw file is kept as .raw.webm)
  session.json                 which takes exist and which one is kept for each line
  voiceover_full.wav           all kept takes in script order (written by Export)
  voiceover_timings.json       start and end time of every line in the full WAV
```
The microphone is recorded raw: the browser's noise suppression, echo cancellation and auto gain are all turned off. Clean the sound and set loudness later, in the edit. A take whose peak goes above −0.5 dBFS is marked as clipping, and a take that is too quiet shows a warning.

## For Claude Code
See [CLAUDE.md](CLAUDE.md).

MIT license.
