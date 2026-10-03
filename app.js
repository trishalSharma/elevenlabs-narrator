/* ─────────────────────────────────────────────────────────────────
   ElevenLabs Narrator — app.js
   ───────────────────────────────────────────────────────────────── */

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

// ── DOM refs ──────────────────────────────────────────────────────
const apiKeyInput    = document.getElementById('apiKey');
const textInput      = document.getElementById('textInput');
const charCount      = document.getElementById('charCount');
const voiceSelect    = document.getElementById('voiceSelect');
const modelSelect    = document.getElementById('modelSelect');
const stabilityRange = document.getElementById('stability');
const stabilityVal   = document.getElementById('stabilityVal');
const similarityRange= document.getElementById('similarity');
const similarityVal  = document.getElementById('similarityVal');
const playBtn        = document.getElementById('playBtn');
const playLabel      = document.getElementById('playLabel');
const stopBtn        = document.getElementById('stopBtn');
const downloadBtn    = document.getElementById('downloadBtn');
const audioSection   = document.getElementById('audioSection');
const audioPlayer    = document.getElementById('audioPlayer');
const waveCanvas     = document.getElementById('waveCanvas');
const statusBar      = document.getElementById('statusBar');

// ── State ─────────────────────────────────────────────────────────
let currentBlob     = null;
let currentObjectURL= null;
let audioCtx        = null;
let analyserNode    = null;
let sourceNode      = null;
let animFrameId     = null;
let voicesLoaded    = false;

// ── Char counter ──────────────────────────────────────────────────
textInput.addEventListener('input', () => {
  const len = textInput.value.length;
  charCount.textContent = len.toLocaleString();
  charCount.parentElement.classList.toggle('over', len > 5000);
  refreshPlayButton();
});

// ── Slider labels ─────────────────────────────────────────────────
stabilityRange.addEventListener('input', () => {
  stabilityVal.textContent = stabilityRange.value;
});
similarityRange.addEventListener('input', () => {
  similarityVal.textContent = similarityRange.value;
});

// ── API key: load voices when key is pasted ───────────────────────
apiKeyInput.addEventListener('change', loadVoices);
apiKeyInput.addEventListener('paste', () => {
  // paste fires before value updates
  setTimeout(loadVoices, 50);
});

// ── Play button state ─────────────────────────────────────────────
function refreshPlayButton() {
  const hasKey  = apiKeyInput.value.trim().length > 10;
  const hasText = textInput.value.trim().length > 0;
  const hasVoice= voiceSelect.value !== '';
  playBtn.disabled = !(hasKey && hasText && hasVoice);
}

apiKeyInput.addEventListener('input', refreshPlayButton);
voiceSelect.addEventListener('change', refreshPlayButton);

// ── Status helper ─────────────────────────────────────────────────
function setStatus(msg, type = '') {
  statusBar.className = `status-bar ${type}`;
  if (type === 'info') {
    statusBar.innerHTML = `<div class="spinner"></div> ${msg}`;
  } else {
    statusBar.textContent = msg;
  }
}

// ── Load voices from ElevenLabs ───────────────────────────────────
async function loadVoices() {
  const key = apiKeyInput.value.trim();
  if (!key || key.length < 10) return;

  setStatus('Fetching voices…', 'info');

  try {
    const res = await fetch(`${ELEVENLABS_BASE}/voices`, {
      headers: { 'xi-api-key': key }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.detail?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const voices = data.voices || [];

    voiceSelect.innerHTML = '';
    voices
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voice_id;
        opt.textContent = `${v.name}${v.labels?.accent ? ` · ${v.labels.accent}` : ''}`;
        voiceSelect.appendChild(opt);
      });

    if (voices.length === 0) {
      voiceSelect.innerHTML = '<option value="">No voices found</option>';
      setStatus('No voices found for this API key.', 'error');
    } else {
      setStatus(`✓ Loaded ${voices.length} voices.`, 'success');
      voicesLoaded = true;
      refreshPlayButton();
    }
  } catch (e) {
    setStatus(`Error loading voices: ${e.message}`, 'error');
  }
}

// ── Generate speech ───────────────────────────────────────────────
playBtn.addEventListener('click', generateSpeech);

async function generateSpeech() {
  const key    = apiKeyInput.value.trim();
  const text   = textInput.value.trim();
  const voiceId= voiceSelect.value;
  const model  = modelSelect.value;

  if (!key || !text || !voiceId) return;

  // UI: loading state
  setPlayLoading(true);
  setStatus('Generating audio…', 'info');
  stopPreviousAudio();

  try {
    const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability:        parseFloat(stabilityRange.value),
          similarity_boost: parseFloat(similarityRange.value),
        },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.detail?.message || `HTTP ${res.status}`);
    }

    const blob = await res.blob();
    currentBlob = blob;

    // Revoke old object URL
    if (currentObjectURL) URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = URL.createObjectURL(blob);

    // Show audio player
    audioPlayer.src = currentObjectURL;
    audioSection.hidden = false;

    // Play
    await audioPlayer.play();
    setStatus('▶ Playing…', 'success');
    stopBtn.disabled = false;
    downloadBtn.disabled = false;

    // Waveform visualizer
    startVisualizer();

    audioPlayer.addEventListener('ended', onPlaybackEnded, { once: true });

  } catch (e) {
    setStatus(`Error: ${e.message}`, 'error');
  } finally {
    setPlayLoading(false);
  }
}

// ── Stop ──────────────────────────────────────────────────────────
stopBtn.addEventListener('click', () => {
  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  stopVisualizer();
  stopBtn.disabled = true;
  setStatus('Stopped.', '');
});

function stopPreviousAudio() {
  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  stopVisualizer();
}

function onPlaybackEnded() {
  stopVisualizer();
  stopBtn.disabled = true;
  setStatus('✓ Playback finished.', 'success');
}

// ── Download ──────────────────────────────────────────────────────
downloadBtn.addEventListener('click', () => {
  if (!currentObjectURL) return;
  const a = document.createElement('a');
  a.href = currentObjectURL;
  a.download = `elevenlabs_narration_${Date.now()}.mp3`;
  a.click();
});

// ── Loading state helpers ─────────────────────────────────────────
function setPlayLoading(loading) {
  playBtn.disabled = loading;
  playBtn.classList.toggle('loading', loading);
  playLabel.textContent = loading ? 'Generating…' : 'Generate & Play';
}

// ── Waveform Visualizer ───────────────────────────────────────────
function startVisualizer() {
  stopVisualizer(); // ensure clean state

  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 128;
  analyserNode.smoothingTimeConstant = 0.8;

  sourceNode = audioCtx.createMediaElementSource(audioPlayer);
  sourceNode.connect(analyserNode);
  analyserNode.connect(audioCtx.destination);

  const bufLen = analyserNode.frequencyBinCount;
  const dataArr = new Uint8Array(bufLen);

  const ctx = waveCanvas.getContext('2d');

  function draw() {
    animFrameId = requestAnimationFrame(draw);

    const W = waveCanvas.clientWidth;
    const H = waveCanvas.clientHeight;
    waveCanvas.width  = W;
    waveCanvas.height = H;

    analyserNode.getByteFrequencyData(dataArr);

    ctx.clearRect(0, 0, W, H);

    const barW  = (W / bufLen) * 1.8;
    let   barX  = 0;

    for (let i = 0; i < bufLen; i++) {
      const barH = (dataArr[i] / 255) * H;

      // gradient bar
      const grad = ctx.createLinearGradient(0, H - barH, 0, H);
      grad.addColorStop(0, '#9d5af5');
      grad.addColorStop(1, '#7c3aed88');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(barX, H - barH, barW - 2, barH, 2);
      ctx.fill();

      barX += barW + 1;
    }
  }

  draw();
}

function stopVisualizer() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (sourceNode) {
    try { sourceNode.disconnect(); } catch (_) {}
    sourceNode = null;
  }
  if (analyserNode) {
    try { analyserNode.disconnect(); } catch (_) {}
    analyserNode = null;
  }
  // Clear canvas
  const ctx = waveCanvas.getContext('2d');
  ctx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
}

// ── Init ──────────────────────────────────────────────────────────
(function init() {
  setStatus('Enter your ElevenLabs API key to get started.');
})();
