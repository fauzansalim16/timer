'use strict';

/* ==========================================================
   DOM REFERENCES
   ========================================================== */
const settingScreen = document.getElementById('settingScreen');
const timerScreen = document.getElementById('timerScreen');
const finishOverlay = document.getElementById('finishOverlay');

const inputHours = document.getElementById('inputHours');
const inputMinutes = document.getElementById('inputMinutes');
const inputSeconds = document.getElementById('inputSeconds');
const inputReminder = document.getElementById('inputReminder');

const durationError = document.getElementById('durationError');
const reminderError = document.getElementById('reminderError');

const startBtn = document.getElementById('startBtn');
const resetSettingBtn = document.getElementById('resetSettingBtn');

const timeDisplay = document.getElementById('timeDisplay');
const timeSubLabel = document.getElementById('timeSubLabel');
const statusBadge = document.getElementById('statusBadge');
const ringProgress = document.getElementById('ringProgress');
const tickMarksGroup = document.getElementById('tickMarks');

const pauseResumeBtn = document.getElementById('pauseResumeBtn');
const pauseResumeLabel = document.getElementById('pauseResumeLabel');
const iconPause = document.getElementById('iconPause');
const iconPlay = document.getElementById('iconPlay');
const resetTimerBtn = document.getElementById('resetTimerBtn');
const muteBtn = document.getElementById('muteBtn');
const iconSoundOn = document.getElementById('iconSoundOn');
const iconSoundOff = document.getElementById('iconSoundOff');

const finishResetBtn = document.getElementById('finishResetBtn');

/* ==========================================================
   STATE
   ========================================================== */
const state = {
    totalSeconds: 0,      // durasi awal yang di-set user
    remainingSeconds: 0,  // sisa waktu saat ini
    reminderAt: null,     // titik reminder (detik tersisa), null = nonaktif
    reminderFired: false, // flag agar reminder hanya bunyi 1x
    finishFired: false,
    isRunning: false,
    isPaused: false,
    intervalId: null,
    isMuted: false,
};

const RING_RADIUS = 158;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const WARNING_THRESHOLD = 10; // detik

/* ==========================================================
   AUDIO SYSTEM
   Strategi: coba pakai file audio user (reminder.mp3 / finish.mp3)
   jika tersedia & berhasil dimuat. Jika tidak ada / gagal,
   fallback ke beep sintetis via Web Audio API.
   ========================================================== */
const AudioSystem = (() => {
    let audioCtx = null;
    let reminderBuffer = null;
    let finishBuffer = null;
    let filesReady = { reminder: false, finish: false };

    function getCtx() {
        if (!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AC();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    // Coba muat file audio opsional. Jika file tidak ada (404 / fetch gagal),
    // sistem otomatis tetap berjalan dengan fallback beep — tidak ada error
    // yang mengganggu pengguna.
    async function tryLoadFile(url) {
        try {
            const res = await fetch(url, { method: 'GET' });
            if (!res.ok) return null;
            const arrayBuffer = await res.arrayBuffer();
            const ctx = getCtx();
            return await ctx.decodeAudioData(arrayBuffer);
        } catch (err) {
            return null;
        }
    }

    async function init() {
        // Load optional audio files (file:// friendly version)
        const remAudio = new Audio('reminder.mp3');
        const finAudio = new Audio('finish.mp3');

        remAudio.preload = 'auto';
        finAudio.preload = 'auto';

        // Detect load success/failure
        const remLoaded = new Promise((resolve) => {
            remAudio.addEventListener('canplaythrough', () => resolve(true), { once: true });
            remAudio.addEventListener('error', () => resolve(false), { once: true });
        });

        const finLoaded = new Promise((resolve) => {
            finAudio.addEventListener('canplaythrough', () => resolve(true), { once: true });
            finAudio.addEventListener('error', () => resolve(false), { once: true });
        });

        const [rem, fin] = await Promise.all([remLoaded, finLoaded]);

        console.log('Audio files load status:', {
            reminderLoaded: rem,
            finishLoaded: fin,
        });

        if (rem) {
            reminderBuffer = remAudio;
            filesReady.reminder = true;
        }

        if (fin) {
            finishBuffer = finAudio;
            filesReady.finish = true;
        }
    }

    function playBuffer(buffer) {
        // Accept either an AudioBuffer (Web Audio API) or an HTMLAudioElement.
        if (buffer instanceof AudioBuffer) {
            const ctx = getCtx();
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            const gain = ctx.createGain();
            gain.gain.value = 0.85;
            source.connect(gain).connect(ctx.destination);
            source.start(0);
        } else if (buffer instanceof HTMLAudioElement) {
            // Fallback: use the native audio element playback.
            // Ensure the element is allowed to play (user interaction already unlocked).
            buffer.currentTime = 0;
            buffer.play();
        } else {
            console.warn('Unsupported audio buffer type:', buffer);
        }
    }

    // Beep sintetis sederhana via oscillator.
    function playBeep({ frequency, duration, type = 'sine', volume = 0.3, delay = 0 }) {
        const ctx = getCtx();
        const startAt = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(frequency, startAt);

        gain.gain.setValueAtTime(0, startAt);
        gain.gain.linearRampToValueAtTime(volume, startAt + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

        osc.connect(gain).connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + duration + 0.05);
    }

    function playReminder() {
        if (state.isMuted) return;
        if (filesReady.reminder && reminderBuffer) {
            playBuffer(reminderBuffer);
        } else {
            // Reminder beep: ringan, nada tunggal pendek
            playBeep({ frequency: 880, duration: 0.18, type: 'sine', volume: 0.25 });
        }
    }

    function playFinish() {
        if (state.isMuted) return;
        if (filesReady.finish && finishBuffer) {
            playBuffer(finishBuffer);
        } else {
            // Finish beep: lebih kuat, dua nada berbeda (terasa seperti "selesai")
            playBeep({ frequency: 660, duration: 0.22, type: 'square', volume: 0.3, delay: 0 });
            playBeep({ frequency: 880, duration: 0.32, type: 'square', volume: 0.32, delay: 0.22 });
        }
    }

    function unlock() {
        // Beberapa browser butuh interaksi user untuk membuka AudioContext.
        getCtx();
    }

    init();

    return { playReminder, playFinish, unlock };
})();

/* ==========================================================
   UTIL: FORMAT & VALIDASI
   ========================================================== */
function clampDigits(value) {
    return value.replace(/[^0-9]/g, '');
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function formatHMS(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
        return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
    }
    return `${pad2(m)}:${pad2(s)}`;
}

function getInputSeconds() {
    const h = parseInt(clampDigits(inputHours.value) || '0', 10);
    const m = parseInt(clampDigits(inputMinutes.value) || '0', 10);
    const s = parseInt(clampDigits(inputSeconds.value) || '0', 10);
    return { h, m, s, total: h * 3600 + m * 60 + s };
}

function getReminderValue() {
    const raw = clampDigits(inputReminder.value);
    if (raw === '') return null;
    return parseInt(raw, 10);
}

/* ==========================================================
   VALIDASI SETTING SCREEN (live)
   ========================================================== */
function validateSettings() {
    const { total } = getInputSeconds();
    const reminder = getReminderValue();

    let durationValid = true;
    let reminderValid = true;

    durationError.textContent = '';
    reminderError.textContent = '';
    [inputHours, inputMinutes, inputSeconds].forEach(el => el.classList.remove('is-invalid'));
    inputReminder.classList.remove('is-invalid');

    // Durasi minimal mengandung angka valid & > 0
    if (total <= 0) {
        durationValid = false;
        durationError.textContent = 'Durasi harus lebih dari 0 detik.';
        [inputHours, inputMinutes, inputSeconds].forEach(el => el.classList.add('is-invalid'));
    }

    // Reminder harus <= total waktu (jika diisi)
    if (reminder !== null) {
        if (reminder <= 0) {
            reminderValid = false;
            reminderError.textContent = 'Reminder harus lebih dari 0 detik.';
            inputReminder.classList.add('is-invalid');
        } else if (total > 0 && reminder > total) {
            reminderValid = false;
            reminderError.textContent = 'Reminder tidak boleh melebihi total durasi.';
            inputReminder.classList.add('is-invalid');
        }
    }

    const allValid = durationValid && reminderValid;
    startBtn.disabled = !allValid;
    return allValid;
}

/* ==========================================================
   INPUT HANDLING — Setting Screen
   ========================================================== */
function bindDigitInput(el, maxValue) {
    el.addEventListener('input', () => {
        let digits = clampDigits(el.value);
        if (digits.length > 2) digits = digits.slice(0, 2);
        if (digits !== '' && maxValue !== undefined) {
            const num = parseInt(digits, 10);
            if (num > maxValue) digits = String(maxValue);
        }
        el.value = digits;
        validateSettings();
    });

    el.addEventListener('blur', () => {
        if (el.value === '') {
            el.value = '00';
        } else if (el.value.length === 1) {
            el.value = pad2(parseInt(el.value, 10));
        }
        validateSettings();
    });

    el.addEventListener('focus', () => {
        el.select();
    });
}

bindDigitInput(inputHours, 99);
bindDigitInput(inputMinutes, 59);
bindDigitInput(inputSeconds, 59);

inputReminder.addEventListener('input', () => {
    inputReminder.value = clampDigits(inputReminder.value).slice(0, 5);
    validateSettings();
});

resetSettingBtn.addEventListener('click', () => {
    inputHours.value = '00';
    inputMinutes.value = '05';
    inputSeconds.value = '00';
    inputReminder.value = '';
    validateSettings();
    inputHours.focus();
});

/* ==========================================================
   CIRCULAR PROGRESS RING — setup tick marks (visual: track lane)
   ========================================================== */
function buildTickMarks() {
    const cx = 180, cy = 180;
    const outerR = 158 + 14;
    const innerR = 158 + 4;
    const count = 60;
    let svgMarkup = '';
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * 2 * Math.PI;
        const isMajor = i % 5 === 0;
        const r1 = isMajor ? outerR : innerR;
        const x1 = cx + r1 * Math.cos(angle);
        const y1 = cy + r1 * Math.sin(angle);
        const x2 = cx + (158 + 2) * Math.cos(angle);
        const y2 = cy + (158 + 2) * Math.sin(angle);
        svgMarkup += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke-width="${isMajor ? 2 : 1}" />`;
    }
    tickMarksGroup.innerHTML = svgMarkup;
}
buildTickMarks();

ringProgress.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;

function setRingProgress(fraction) {
    // fraction: 1 = penuh (awal), 0 = habis
    const clamped = Math.max(0, Math.min(1, fraction));
    const offset = RING_CIRCUMFERENCE * (1 - clamped);
    ringProgress.style.strokeDashoffset = offset.toFixed(2);
}

/* ==========================================================
   TIMER SCREEN — RENDER
   ========================================================== */
function renderTime() {
    timeDisplay.textContent = formatHMS(state.remainingSeconds);

    const fraction = state.totalSeconds > 0 ? state.remainingSeconds / state.totalSeconds : 0;
    setRingProgress(fraction);

    const isWarning = state.remainingSeconds <= WARNING_THRESHOLD && state.remainingSeconds > 0;
    timeDisplay.classList.toggle('is-warning', isWarning);
    ringProgress.classList.toggle('is-warning', isWarning);

    if (state.isPaused) {
        statusBadge.textContent = 'Dijeda';
        statusBadge.className = 'status-badge paused';
        timeSubLabel.textContent = 'dijeda';
    } else if (isWarning) {
        statusBadge.textContent = 'Hampir Selesai';
        statusBadge.className = 'status-badge warning';
        timeSubLabel.textContent = 'tersisa';
    } else {
        statusBadge.textContent = 'Berjalan';
        statusBadge.className = 'status-badge';
        timeSubLabel.textContent = 'tersisa';
    }
}

/* ==========================================================
   TIMER LOGIC
   ========================================================== */
function tick() {
    if (state.isPaused) return;

    state.remainingSeconds -= 1;

    // Reminder: hanya bunyi SEKALI saat tepat mencapai threshold
    if (
        state.reminderAt !== null &&
        !state.reminderFired &&
        state.remainingSeconds === state.reminderAt
    ) {
        state.reminderFired = true;
        AudioSystem.playReminder();
        pulseBadgeOnce();
    }

    if (state.remainingSeconds <= 0) {
        state.remainingSeconds = 0;
        renderTime();
        finishTimer();
        return;
    }

    renderTime();
}

function pulseBadgeOnce() {
    statusBadge.style.transform = 'scale(1.12)';
    setTimeout(() => { statusBadge.style.transform = 'scale(1)'; }, 220);
}

function startTimerLoop() {
    clearInterval(state.intervalId);
    state.intervalId = setInterval(tick, 1000);
}

function stopTimerLoop() {
    clearInterval(state.intervalId);
    state.intervalId = null;
}

function finishTimer() {
    stopTimerLoop();
    state.isRunning = false;
    state.isPaused = false;
    if (!state.finishFired) {
        state.finishFired = true;
        AudioSystem.playFinish();
    }
    showFinishOverlay();
}

/* ==========================================================
   SCREEN TRANSITIONS
   ========================================================== */
function goToTimerScreen() {
    AudioSystem.unlock();

    const { total } = getInputSeconds();
    const reminder = getReminderValue();

    state.totalSeconds = total;
    state.remainingSeconds = total;
    state.reminderAt = reminder;
    state.reminderFired = false;
    state.finishFired = false;
    state.isRunning = true;
    state.isPaused = false;

    settingScreen.classList.add('is-hidden');
    timerScreen.classList.add('is-active');
    timerScreen.setAttribute('aria-hidden', 'false');
    settingScreen.setAttribute('aria-hidden', 'true');

    setPauseUI(false);
    renderTime();
    setRingProgress(1);
    startTimerLoop();
}

function goToSettingScreen() {
    stopTimerLoop();
    state.isRunning = false;
    state.isPaused = false;

    timerScreen.classList.remove('is-active');
    settingScreen.classList.remove('is-hidden');
    timerScreen.setAttribute('aria-hidden', 'true');
    settingScreen.setAttribute('aria-hidden', 'false');

    hideFinishOverlay();
    validateSettings();
}

function showFinishOverlay() {
    finishOverlay.classList.add('is-active');
    finishOverlay.setAttribute('aria-hidden', 'false');
}

function hideFinishOverlay() {
    finishOverlay.classList.remove('is-active');
    finishOverlay.setAttribute('aria-hidden', 'true');
}

/* ==========================================================
   PAUSE / RESUME UI
   ========================================================== */
function setPauseUI(isPaused) {
    state.isPaused = isPaused;
    iconPause.style.display = isPaused ? 'none' : 'inline';
    iconPlay.style.display = isPaused ? 'inline' : 'none';
    pauseResumeLabel.textContent = isPaused ? 'Resume' : 'Pause';
    renderTime();
}

function togglePauseResume() {
    if (!state.isRunning) return;
    setPauseUI(!state.isPaused);
}

/* ==========================================================
   EVENT LISTENERS — Buttons
   ========================================================== */
startBtn.addEventListener('click', () => {
    if (!validateSettings()) return;
    goToTimerScreen();
});

pauseResumeBtn.addEventListener('click', togglePauseResume);

resetTimerBtn.addEventListener('click', () => {
    goToSettingScreen();
});

finishResetBtn.addEventListener('click', () => {
    goToSettingScreen();
});

muteBtn.addEventListener('click', () => {
    state.isMuted = !state.isMuted;
    iconSoundOn.style.display = state.isMuted ? 'none' : 'inline';
    iconSoundOff.style.display = state.isMuted ? 'inline' : 'none';
    muteBtn.title = state.isMuted ? 'Aktifkan suara' : 'Bisukan suara';
});

/* ==========================================================
   KEYBOARD SHORTCUTS
   ========================================================== */
document.addEventListener('keydown', (e) => {
    const isTimerActive = timerScreen.classList.contains('is-active');
    const isFinishActive = finishOverlay.classList.contains('is-active');

    // Enter = Start (hanya di setting screen, dan bukan saat fokus di tombol)
    if (e.key === 'Enter' && !isTimerActive && !isFinishActive) {
        e.preventDefault();
        if (!startBtn.disabled) {
            goToTimerScreen();
        }
        return;
    }

    // Space = Pause/Resume (hanya saat timer aktif & belum selesai)
    if (e.code === 'Space' && isTimerActive && !isFinishActive) {
        e.preventDefault();
        togglePauseResume();
        return;
    }

    // Escape = Reset ke setting screen
    if (e.key === 'Escape') {
        if (isTimerActive || isFinishActive) {
            e.preventDefault();
            goToSettingScreen();
        }
    }
});

/* ==========================================================
   INIT
   ========================================================== */
function init() {
    validateSettings();
    renderTime();
}

init();