#!/usr/bin/env node
// VoiceBooth: line-by-line voice-over recorder (teleprompter + takes + retake).
// Usage: node server.mjs <script.json> [--port 7790] [--no-open]
// No npm dependencies. Needs ffmpeg on PATH (to turn browser recordings into WAV).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const scriptArg = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--port'));
if (!scriptArg) {
  console.error('Usage: node server.mjs <script.json> [--port 7790] [--no-open]');
  process.exit(1);
}
const PORT = Number(flag('--port', 7790));
const SCRIPT_PATH = path.resolve(scriptArg);

const SR = 48000; // sample rate of every take and the export
const BYTES_PER_SAMPLE = 2; // mono 16-bit PCM

// ---------- script + session state ----------
function loadScript() {
  const raw = JSON.parse(fs.readFileSync(SCRIPT_PATH, 'utf8'));
  const lines = (raw.lines || []).map((l, i) => ({
    id: String(l.id || `L${String(i + 1).padStart(2, '0')}`),
    text: String(l.text || ''),
    reaction: String(l.reaction || ''),
    emoji: String(l.emoji || ''),
    note: String(l.note || ''),
    section: String(l.section || ''),
  }));
  const outDir = path.resolve(path.dirname(SCRIPT_PATH), raw.out_dir || 'voice');
  return {
    title: String(raw.title || path.basename(SCRIPT_PATH, '.json')),
    trim_head: Number(raw.trim_head ?? 0.12), // seconds cut from the start (mouse click)
    trim_tail: Number(raw.trim_tail ?? 0.25), // seconds cut from the end (mouse click)
    gap: Number(raw.gap ?? 0.3), // silence between lines in the full export
    lines,
    outDir,
  };
}

let script = loadScript();
const takesDir = () => path.join(script.outDir, 'takes');
const statePath = () => path.join(script.outDir, 'session.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return { lines: {} };
  }
}
let state = loadState();
function saveState() {
  fs.mkdirSync(script.outDir, { recursive: true });
  state.updated = new Date().toISOString();
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}
const lineState = (id) => (state.lines[id] ||= { takes: [], chosen: null });

// ---------- WAV helpers ----------
function wavHeader(dataBytes) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * BYTES_PER_SAMPLE, 28);
  h.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}
// Find the PCM data of a WAV file written by ffmpeg (header may carry extra chunks).
function readPcm(file) {
  const b = fs.readFileSync(file);
  let p = 12;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === 'data') return b.subarray(p + 8, Math.min(b.length, p + 8 + size));
    p += 8 + size + (size % 2);
  }
  throw new Error('no data chunk in ' + file);
}
function peakDb(pcm) {
  let peak = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  return peak ? 20 * Math.log10(peak / 32768) : -120;
}

function ffmpeg(argv) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argv], (err, _o, se) =>
      err ? reject(new Error(se || err.message)) : resolve(),
    );
  });
}

// Browser recording (webm/ogg) -> trimmed mono 48 kHz WAV take.
async function saveTake(lineId, body, mime) {
  const line = script.lines.find((l) => l.id === lineId);
  if (!line) throw new Error('unknown line ' + lineId);
  fs.mkdirSync(takesDir(), { recursive: true });
  const ls = lineState(lineId);
  const n = ls.takes.reduce((m, t) => Math.max(m, t.n), 0) + 1;
  const base = `${lineId}_take${n}`;
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
  const rawFile = path.join(takesDir(), `${base}.raw.${ext}`);
  const tmpWav = path.join(takesDir(), `${base}.tmp.wav`);
  const wavFile = path.join(takesDir(), `${base}.wav`);
  fs.writeFileSync(rawFile, body);
  await ffmpeg(['-i', rawFile, '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', tmpWav]);
  let pcm = readPcm(tmpWav);
  const head = Math.round(script.trim_head * SR) * BYTES_PER_SAMPLE;
  const tail = Math.round(script.trim_tail * SR) * BYTES_PER_SAMPLE;
  if (pcm.length > head + tail + SR * BYTES_PER_SAMPLE * 0.2) pcm = pcm.subarray(head, pcm.length - tail);
  fs.writeFileSync(wavFile, Buffer.concat([wavHeader(pcm.length), pcm]));
  fs.rmSync(tmpWav, { force: true });
  const take = {
    n,
    file: path.basename(wavFile),
    seconds: +(pcm.length / BYTES_PER_SAMPLE / SR).toFixed(2),
    peak_db: +peakDb(pcm).toFixed(1),
    at: new Date().toISOString(),
  };
  ls.takes.push(take);
  saveState();
  return take;
}

// All chosen takes, in script order, joined with a short gap -> voiceover_full.wav + timings.
function exportFull() {
  const gap = Buffer.alloc(Math.round(script.gap * SR) * BYTES_PER_SAMPLE);
  const parts = [];
  const timings = [];
  const missing = [];
  let t = 0;
  for (const line of script.lines) {
    const ls = state.lines[line.id];
    const take = ls && ls.takes.find((k) => k.n === ls.chosen);
    if (!take) {
      missing.push(line.id);
      continue;
    }
    const pcm = readPcm(path.join(takesDir(), take.file));
    if (parts.length) {
      parts.push(gap);
      t += script.gap;
    }
    const dur = pcm.length / BYTES_PER_SAMPLE / SR;
    timings.push({ id: line.id, text: line.text, take: take.file, start: +t.toFixed(3), end: +(t + dur).toFixed(3) });
    parts.push(pcm);
    t += dur;
  }
  const data = Buffer.concat(parts);
  const wav = path.join(script.outDir, 'voiceover_full.wav');
  fs.writeFileSync(wav, Buffer.concat([wavHeader(data.length), data]));
  const out = { title: script.title, file: wav, seconds: +t.toFixed(2), gap: script.gap, missing, lines: timings };
  fs.writeFileSync(path.join(script.outDir, 'voiceover_timings.json'), JSON.stringify(out, null, 2));
  return out;
}

// ---------- HTTP ----------
const PURNO = [
  path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts', 'Purno Regular.ttf'),
  'C:\\Windows\\Fonts\\Purno Regular.ttf',
].find((p) => fs.existsSync(p));

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'GET' && (p === '/' || p === '/index.html'))
      return send(res, 200, fs.readFileSync(path.join(HERE, 'ui', 'index.html')), 'text/html; charset=utf-8');
    if (req.method === 'GET' && p === '/font/purno.ttf') {
      if (!PURNO) return send(res, 404, { error: 'Purno font not installed' });
      return send(res, 200, fs.readFileSync(PURNO), 'font/ttf');
    }
    if (req.method === 'GET' && p === '/api/session') {
      script = loadScript(); // pick up script edits on every reload
      return send(res, 200, { title: script.title, script: SCRIPT_PATH, out_dir: script.outDir, lines: script.lines, state });
    }
    if (req.method === 'POST' && p === '/api/take') {
      const id = url.searchParams.get('line');
      const body = await readBody(req);
      if (body.length < 1000) return send(res, 400, { error: 'recording is empty' });
      const take = await saveTake(id, body, req.headers['content-type'] || 'audio/webm');
      return send(res, 200, { take, state });
    }
    if (req.method === 'POST' && p === '/api/choose') {
      const { line, take } = JSON.parse((await readBody(req)).toString() || '{}');
      lineState(line).chosen = take ?? null;
      saveState();
      return send(res, 200, { state });
    }
    if (req.method === 'POST' && p === '/api/export') return send(res, 200, exportFull());
    if (req.method === 'GET' && p.startsWith('/takes/')) {
      const f = path.join(takesDir(), path.basename(decodeURIComponent(p.slice(7))));
      if (!fs.existsSync(f)) return send(res, 404, { error: 'no such take' });
      return send(res, 200, fs.readFileSync(f), 'audio/wav');
    }
    if (req.method === 'GET' && p === '/voiceover_full.wav') {
      const f = path.join(script.outDir, 'voiceover_full.wav');
      if (!fs.existsSync(f)) return send(res, 404, { error: 'not exported yet' });
      return send(res, 200, fs.readFileSync(f), 'audio/wav');
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e.message || e) });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is busy. Close the other VoiceBooth or use --port 7791.`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`VoiceBooth: ${script.title}`);
  console.log(`  script : ${SCRIPT_PATH}`);
  console.log(`  takes  : ${takesDir()}`);
  console.log(`  open   : ${url}`);
  if (!args.includes('--no-open')) {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref();
  }
});
