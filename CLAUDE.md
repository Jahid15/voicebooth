# VoiceBooth: how Claude uses it

The user records voice-overs here one line at a time. The flow for a new video:

1. **Understand the idea** with the user.
2. **Get the script.** Either the user gives it, or Claude writes it in the user's own spoken voice. Break it into short lines that can be said in one breath, about 3–8 seconds each, and never split a line in the middle of a thought.
3. **Give every line a delivery cue.** `emoji` plus `reaction` in Bangla says how to say the line (মজা করে, অবাক হয়ে, জোর দিয়ে, ফিসফিস করে, ধীরে…). Add a `note` only for a specific stress or pause. Group lines with `section` (হুক, স্টেপ ১, রেজাল্ট, CTA).
4. **Write `<project>/voice/script.json`.** Set `"out_dir": "."` so the takes land beside the script; the format is in README.md.
5. **Open the app** in the background, then tell the user it is open:
   `node D:\harness\tools\VoiceBooth\server.mjs <project>\voice\script.json`
   The default port is 7790; if it is busy, use `--port 7791`.
6. The user records: Space to record, Enter if the take is good, R to record again, then **Export**.
7. **Read the results:**
   - `voiceover_timings.json` gives each line's start and end in `voiceover_full.wav`. Use it to time captions, motion graphics and SFX.
   - `session.json` shows the kept take for each line, and `takes/<id>_take<n>.wav` holds the individual takes.
   - If the user wants to redo one line, they open the app, pick the line, record it again and export again. The timings change, so re-read them.

Rules:
- Keep each line `id` fixed once it has takes. To add new lines, give them new ids.
- Takes are raw. Clean the sound (noise removal, loudness) in the edit, not in this app.
- Never delete takes. Export only rewrites `voiceover_full.wav` and the timings file.
