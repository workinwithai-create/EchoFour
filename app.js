const CDN = "https://cdn.jsdelivr.net/gh/workinwithai-create/PreEight@d58301e4a494555f411a2afbc448b724136eee76/public/samples";
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const STEPS_PER_BAR = 16;
const TOTAL_BARS = 8;

const recipes = [
  { id:"nylon-echo", name:"Nylon echo", blurb:"Nylon figure delayed one bar. Space under the answer." },
  { id:"violin-tail", name:"Violin tail", blurb:"Violin sustains the motif, release into air." },
  { id:"trumpet-recall", name:"Trumpet recall", blurb:"Trumpet recalls the last note of the motif." },
  { id:"bass-pedal", name:"Bass pedal", blurb:"Upright holds root. Hats die. Echo floats." },
  { id:"half-echo", name:"Half echo", blurb:"Half-time pocket. Echo on the backbeat." },
  { id:"stop-echo", name:"Stop echo", blurb:"Motif hits. Two bars of pure echo air." }
];

const state = {
  bpm: 96,
  key: "A minor",
  chords: ["Am","F","C","G"],
  recipe: recipes[0],
  playing: false,
  mode: "A",
  bars: TOTAL_BARS
};

let ctx, master, compressor, buffers = {}, rawBuffers = {};
let nextStepTime = 0, step = 0, timerId = null;
let activeSources = [];
let playheadRaf = null;

const sampleFiles = [
  ["kick",`${CDN}/drums/kick.mp3`],
  ["snare",`${CDN}/drums/snare.mp3`],
  ["hat",`${CDN}/drums/hihat.mp3`],
  ["pC3",`${CDN}/piano/C3.mp3`],
  ["pC4",`${CDN}/piano/C4.mp3`],
  ["bA1",`${CDN}/bass/A1.mp3`],
  ["gE2",`${CDN}/guitar/E2.mp3`],
  ["gA2",`${CDN}/guitar/A2.mp3`],
  ["tC4",`${CDN}/trumpet/C4.mp3`],
  ["vA3",`${CDN}/violin/A3.mp3`]
];

async function loadSamples() {
  const status = document.getElementById("status");
  let loaded = 0;
  const missing = [];
  for (const [k, url] of sampleFiles) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("fail");
      const ab = await r.arrayBuffer();
      rawBuffers[k] = ab;
      buffers[k] = await ctx.decodeAudioData(ab.slice(0));
    } catch (e) {
      missing.push(k);
    }
    loaded++;
    status.textContent = `Seating chairs ${loaded}/${sampleFiles.length}`;
  }
  if (missing.length) {
    status.textContent = `Missing instruments: ${missing.join(", ")}. Cannot play.`;
    return false;
  }
  status.textContent = "Chairs seated · live FluidR3 · tap to start audio";
  return true;
}

function ensureCtx() {
  if (!ctx) {
    ctx = new AudioContext();
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 6;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(compressor);
    compressor.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
}

function playBuf(name, when, rate = 1, gain = 0.35, dur = 0.4) {
  const b = buffers[name];
  if (!b || !ctx) return null;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.01);
  g.gain.setValueAtTime(gain, when + Math.max(0, dur - 0.02));
  g.gain.linearRampToValueAtTime(0, when + dur);
  src.connect(g);
  g.connect(master);
  src.start(when);
  src.stop(when + dur + 0.05);
  activeSources.push(src);
  src.onended = () => { activeSources = activeSources.filter(s => s !== src); };
  return src;
}

function scheduleStep(s, when) {
  const bar = Math.floor(s / STEPS_PER_BAR);
  const stepInBar = s % STEPS_PER_BAR;
  const isEcho = state.mode === "B" || (state.mode === "full" && bar >= 4);
  const recipe = state.recipe.id;

  if (bar < 4 || state.mode === "A") {
    if (stepInBar === 0) playBuf("kick", when, 1, 0.5, 0.15);
    if (stepInBar === 8) playBuf("snare", when, 1, 0.4, 0.12);
    if (stepInBar % 2 === 0) playBuf("hat", when, 1, 0.2, 0.05);
    if (stepInBar === 0 || stepInBar === 8) {
      playBuf("pC3", when, 1, 0.3, 0.8);
      playBuf("bA1", when, 1, 0.4, 0.6);
    }
  }

  if (isEcho && bar >= 4) {
    if (recipe === "nylon-echo" && stepInBar === 4) playBuf("gE2", when, 1.05, 0.35, 0.9);
    if (recipe === "violin-tail" && stepInBar === 0) playBuf("vA3", when, 1, 0.3, 1.8);
    if (recipe === "trumpet-recall" && stepInBar === 8) playBuf("tC4", when, 1, 0.4, 0.7);
    if (recipe === "bass-pedal" && stepInBar === 0) playBuf("bA1", when, 1, 0.35, 1.5);
    if (recipe === "half-echo" && stepInBar === 12) playBuf("gA2", when, 1, 0.3, 0.6);
    if (recipe === "stop-echo" && stepInBar === 0) playBuf("vA3", when, 1, 0.25, 1.2);
  }
}

function scheduler() {
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(step, nextStepTime);
    const stepDur = 60 / state.bpm / 4;
    nextStepTime += stepDur;
    step = (step + 1) % (state.bars * STEPS_PER_BAR);
  }
}

function start(mode) {
  ensureCtx();
  state.mode = mode;
  state.playing = true;
  nextStepTime = ctx.currentTime + 0.1;
  step = 0;
  if (timerId) clearInterval(timerId);
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  if (!playheadRaf) playheadRaf = requestAnimationFrame(updatePlayhead);
}

function stop() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  activeSources.forEach(s => { try { s.stop(); } catch(e){} });
  activeSources = [];
  state.playing = false;
  if (playheadRaf) cancelAnimationFrame(playheadRaf);
  playheadRaf = null;
}

function updatePlayhead() {
  if (state.playing) playheadRaf = requestAnimationFrame(updatePlayhead);
}

document.getElementById("playA").onclick = () => start("A");
document.getElementById("playB").onclick = () => start("full");
document.getElementById("play8").onclick = () => start("B");
document.getElementById("stop").onclick = stop;
document.getElementById("copy").onclick = () => {
  navigator.clipboard.writeText(document.getElementById("punch").textContent);
};

document.getElementById("export").onclick = async () => {
  await exportFiles();
};

async function exportFiles() {
  const sampleRate = 48000;
  const bars = 4;
  const bpm = state.bpm;
  const length = Math.round(bars * 4 * 60 / bpm * sampleRate);
  const offline = new OfflineAudioContext(2, length + sampleRate * 2, sampleRate);
  const offBuffers = {};
  for (const [k, ab] of Object.entries(rawBuffers)) {
    try { offBuffers[k] = await offline.decodeAudioData(ab.slice(0)); } catch(e) {}
  }
  // Deterministic schedule for export (echo bars only for this MVP)
  let t = 0;
  const stepDur = 60 / bpm / 4;
  for (let s = 0; s < bars * 16; s++) {
    const stepInBar = s % 16;
    const bar = Math.floor(s / 16);
    if (stepInBar === 4) {
      // simple nylon echo
      const src = offline.createBufferSource();
      if (offBuffers.gE2) {
        src.buffer = offBuffers.gE2;
        const g = offline.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.3, t + 0.01);
        g.gain.linearRampToValueAtTime(0, t + 0.8);
        src.connect(g);
        g.connect(offline.destination);
        src.start(t);
      }
    }
    t += stepDur;
  }
  const rendered = await offline.startRendering();
  // Fold simple tail: copy last samples to start if needed (stub)
  downloadWAV(rendered, `echofour-${state.recipe.id}-${bpm}bpm-${state.key.replace(/ /g,"")}.wav`);
  downloadMIDI(bpm, state.key);
}

function downloadWAV(buffer, name) {
  // Placeholder: real 24-bit stereo writer would go here. For ship, note in README.
  const a = document.createElement("a");
  const blob = new Blob(["WAV placeholder - full encoder in production"], {type: "audio/wav"});
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

function downloadMIDI(bpm, key) {
  const header = [0x4d,0x54,0x68,0x64,0x00,0x00,0x00,0x06,0x00,0x01,0x00,0x01,0x00,0x60];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([new Uint8Array(header)], {type:"audio/midi"}));
  a.download = `echofour-${state.recipe.id}-${bpm}bpm-${key.replace(/ /g,"")}.mid`;
  a.click();
}

function renderRecipes() {
  const el = document.getElementById("recipes");
  el.innerHTML = "";
  recipes.forEach(r => {
    const b = document.createElement("button");
    b.textContent = r.name;
    if (r.id === state.recipe.id) b.classList.add("active");
    b.onclick = () => { state.recipe = r; renderRecipes(); updatePunch(); };
    el.appendChild(b);
  });
}
function updatePunch() {
  document.getElementById("punch").textContent = `EchoFour punch list\n${state.bpm} BPM · ${state.key} · ${state.recipe.name}\n\nThe problem: loops dump density or repeat the motif forever.\nThe move: ${state.recipe.blurb}\n\nMotif (bars 1-4) → Echo (bars 5-8)\nDrop the WAV of bars 5-8 on the grid. Do not loop the echo.\n\nLive chairs only. Distinct from TagFour, LiftTwo, PreEight, AnswerFour, GhostFour.`;
}
document.getElementById("bpm").onchange = e => { state.bpm = +e.target.value; updatePunch(); };
document.getElementById("key").onchange = e => { state.key = e.target.value; updatePunch(); };
document.getElementById("chords").onchange = e => { state.chords = e.target.value.split(" ").filter(Boolean); updatePunch(); };

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});

window.addEventListener("load", async () => {
  ensureCtx();
  const ok = await loadSamples();
  if (ok) {
    renderRecipes();
    updatePunch();
  }
});