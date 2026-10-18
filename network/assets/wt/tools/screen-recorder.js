// Tool: screen recorder (Bildschirm aufnehmen). Whole screen, a window or a tab via the browser's screen
// sharing; microphone and the sound of the shared tab/screen mixed together; a camera window (picture-in-
// picture, stays on top, so it is in the recording when the whole screen is shared); 3-2-1 countdown, pause,
// live microphone level. No time limit, no watermark. While recording, every second is written to a private
// file of the browser (lib/rec-store.js) – a crashed or closed tab can be recovered on the next visit. WebM
// gets its duration written in (lib/rec-webm.js) so players can seek. MP4 where the browser records it.
import { el, icon, clear } from '../lib/dom.js';
import { ensureCss, T, segmented, check } from '../lib/img-core.js';
import { openSink, recoverable, removeRecording } from '../lib/rec-store.js';
import { withDuration } from '../lib/rec-webm.js';
import { formatSize } from '../lib/format.js';

ensureCss();

const QUALITY = {
  high: { h: 1080, fps: 30, vbps: 4_000_000 },
  std: { h: 720, fps: 30, vbps: 2_000_000 },
  small: { h: 720, fps: 15, vbps: 900_000 },
};
const MIMES = {
  mp4: ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4;codecs=avc1'],
  webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
};
/** First type this browser records, per container. */
export function pickMime(kind, isSupported = t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
  return MIMES[kind].find(t => { try { return isSupported(t); } catch { return false; } }) || null;
}
export const clock = ms => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')}`; };

let stageApi = null;

export default {
  labels: { back_to_files: { de: 'Zurück zur Aufnahme', en: 'Back to the recording' } },
  mountStage(stage, state, ctx) { stageApi = recorder(stage, state, ctx); },
  status(v) {
    if (!v.rec) return { ok: false, hint: { de: 'Starte eine Aufnahme – danach kannst du sie hier speichern.', en: 'Start a recording – you can save it here afterwards.' } };
    return { summary: { de: `Aufnahme · ${clock(v.rec.ms)} · ${formatSize(v.rec.blob.size, 'de')}`, en: `Recording · ${clock(v.rec.ms)} · ${formatSize(v.rec.blob.size, 'en')}` } };
  },
  async run(inputs, opts, ctx) {
    const r = opts.rec;
    const d = new Date(r.started || Date.now());
    const p = n => String(n).padStart(2, '0');
    const name = `${ctx.t({ de: 'Bildschirmaufnahme', en: 'Screen recording' })} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}.${/mp4/.test(r.blob.type) ? 'mp4' : 'webm'}`;
    return { outputs: [{ name, blob: r.blob, note: ctx.t({ de: `${clock(r.ms)} · ohne Wasserzeichen`, en: `${clock(r.ms)} · no watermark` }) }] };
  },
};

function recorder(stage, state, ctx) {
  const lang = ctx.lang;
  const w = (de, en) => T(lang, { de, en });
  const v = state.values;
  const set = (v.recSet ||= { mic: true, sys: true, countdown: true, quality: 'std', format: null });
  const can = {
    display: !!navigator.mediaDevices?.getDisplayMedia,
    mp4: pickMime('mp4'), webm: pickMime('webm'),
    docPip: 'documentPictureInPicture' in window, pip: !!document.pictureInPictureEnabled,
  };
  set.format ||= can.mp4 ? 'mp4' : 'webm';
  const box = el('section', { class: 'img-box rec', aria: { labelledby: 'rec-h' } }, el('h2', { class: 'img-h', id: 'rec-h' }, w('Bildschirm aufnehmen', 'Record your screen')));
  stage.append(box);

  if (!can.display || !(can.mp4 || can.webm)) {
    box.append(el('div', { class: 'rec-unsupported' },
      el('p', {}, w('Dieser Browser kann den Bildschirm nicht aufnehmen. Am Computer klappt es in aktuellen Versionen von Chrome, Edge, Firefox und Safari.',
        'This browser can’t record the screen. On a computer it works in current versions of Chrome, Edge, Firefox and Safari.')),
      el('p', { class: 'img-muted' }, w('Auf dem Handy hat das System eine eigene Bildschirmaufnahme: iPhone und iPad im Kontrollzentrum, Android in den Schnelleinstellungen (Wischen von oben).',
        'Phones have their own screen recorder: on iPhone and iPad in Control Center, on Android in Quick Settings (swipe down from the top).'))));
    return { };
  }

  // ---------------------------------------------------------------- recovery of a cut-off recording
  const recover = el('div', { class: 'rec-recover', hidden: true });
  box.append(recover);
  recoverable().then(list => {
    if (!list.length) return;
    recover.hidden = false;
    recover.append(el('p', { class: 'rec-recover-h' }, icon('alert'), el('span', {}, w('Eine Aufnahme wurde nicht zu Ende gespeichert – etwa weil der Tab geschlossen wurde.', 'A recording wasn’t finished – e.g. because the tab was closed.'))));
    for (const r of list) {
      const when = r.when.toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
      const row = el('div', { class: 'rec-recover-row' }, el('span', {}, `${when} · ${formatSize(r.file.size, lang)}`),
        el('button', { type: 'button', class: 'wt-btn wt-btn-sm', onclick: async () => {
          finishWith(new Blob([r.file], { type: r.mime }), 0, +r.when || Date.now(), r.name);
          recover.hidden = true;
        } }, w('Wiederherstellen', 'Recover')),
        el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: async () => { await removeRecording(r.name); row.remove(); if (!recover.querySelector('.rec-recover-row')) recover.hidden = true; } }, w('Löschen', 'Delete')));
      recover.append(row);
    }
  }).catch(() => {});

  // ---------------------------------------------------------------- setup
  const setup = el('div', { class: 'rec-setup' });
  const meter = el('div', { class: 'rec-meter', role: 'meter', aria: { label: w('Mikrofon-Pegel', 'Microphone level'), valuemin: '0', valuemax: '100', valuenow: '0' } }, el('span', {}));
  const meterRow = el('div', { class: 'rec-meter-row', hidden: true }, el('span', { class: 'img-muted' }, w('Mikrofon', 'Microphone')), meter);
  const camBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', id: 'rec-cam' }, icon('camera'), el('span', {}, w('Kamera-Fenster einblenden', 'Show camera window')));
  const camHint = el('p', { class: 'img-muted' }, w('Das Kamera-Fenster bleibt über allen Programmen und lässt sich verschieben. Es ist in der Aufnahme zu sehen, wenn du den ganzen Bildschirm teilst.',
    'The camera window stays on top of everything and can be moved. It shows in the recording when you share the whole screen.'));
  setup.append(...[
    check({ id: 'rec-mic', label: { de: 'Mikrofon aufnehmen', en: 'Record microphone' }, checked: set.mic, lang, onChange: x => { set.mic = x; } }),
    check({ id: 'rec-sys', label: { de: 'Ton vom Bildschirm oder Tab aufnehmen', en: 'Record sound from the screen or tab' }, checked: set.sys, lang,
      hint: { de: 'Beim Teilen im Browser-Dialog „Audio teilen“ anhaken. Auf dem Mac geht das nur für Tabs.', en: 'Tick “Share audio” in the browser’s dialog. On a Mac this only works for tabs.' }, onChange: x => { set.sys = x; } }),
    check({ id: 'rec-count', label: { de: '3 Sekunden Countdown vor dem Start', en: '3-second countdown before starting' }, checked: set.countdown, lang, onChange: x => { set.countdown = x; } }),
    segmented({ name: 'rec-quality', label: { de: 'Qualität', en: 'Quality' }, lang, value: set.quality, onChange: x => { set.quality = x; },
      choices: [{ value: 'high', label: { de: 'Hoch (1080p)', en: 'High (1080p)' } }, { value: 'std', label: { de: 'Standard (720p)', en: 'Standard (720p)' } }, { value: 'small', label: { de: 'Klein (720p, 15 fps)', en: 'Small (720p, 15 fps)' } }] }).root,
    can.mp4 && can.webm ? segmented({ name: 'rec-format', label: { de: 'Format', en: 'Format' }, lang, value: set.format, onChange: x => { set.format = x; },
      choices: [{ value: 'mp4', label: { de: 'MP4 (läuft überall)', en: 'MP4 (plays everywhere)' } }, { value: 'webm', label: 'WebM' }] }).root : null,
    (can.docPip || can.pip) ? el('div', { class: 'rec-cam' }, camBtn, camHint) : null].filter(Boolean));
  const startBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-primary wt-btn-lg rec-start', id: 'rec-start' }, el('span', { class: 'rec-dot', aria: { hidden: 'true' } }), el('span', {}, w('Aufnahme starten', 'Start recording')));
  const msg = el('p', { class: 'img-note', hidden: true, role: 'alert' });

  // ---------------------------------------------------------------- live
  const timeEl = el('span', { class: 'rec-time', id: 'rec-time' }, '0:00');
  const sizeEl = el('span', { class: 'img-muted', id: 'rec-size' });
  const pauseBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', id: 'rec-pause' }, w('Pause', 'Pause'));
  const stopBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-primary', id: 'rec-stop' }, w('Aufnahme beenden', 'Stop recording'));
  const live = el('div', { class: 'rec-live', hidden: true, role: 'status' },
    el('div', { class: 'rec-live-row' }, el('span', { class: 'rec-dot is-on', aria: { hidden: 'true' } }), timeEl, sizeEl),
    meterRow,
    el('div', { class: 'rec-live-row' }, pauseBtn, stopBtn),
    el('p', { class: 'img-muted' }, w('Du kannst die Aufnahme auch über „Freigabe beenden“ des Browsers stoppen.', 'You can also stop via the browser’s “Stop sharing” button.')));
  const count = el('p', { class: 'rec-count', hidden: true, aria: { live: 'assertive' } });

  // ---------------------------------------------------------------- done
  const video = el('video', { class: 'rec-video', controls: true, playsinline: true, preload: 'metadata' });
  const info = el('p', { class: 'img-muted', id: 'rec-info' });
  const againBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', id: 'rec-again' }, w('Neu aufnehmen', 'Record again'));
  const done = el('div', { class: 'rec-done', hidden: true }, video, info, el('div', { class: 'rec-live-row' }, againBtn),
    el('p', { class: 'img-muted' }, w('Speichern geht unten. Die Aufnahme liegt nur in diesem Browser und wird beim nächsten Besuch oder mit „Neu aufnehmen“ gelöscht.',
      'Save it below. The recording only lives in this browser and is deleted on your next visit or with “Record again”.')));

  box.append(setup, startBtn, msg, count, live, done,
    el('p', { class: 'img-muted rec-foot' }, w('Kein Zeitlimit, kein Wasserzeichen, kein Upload: Bild und Ton bleiben auf deinem Gerät.', 'No time limit, no watermark, no upload: picture and sound stay on your device.')));

  // ---------------------------------------------------------------- state
  let display = null, micStream = null, camStream = null, pipWin = null, pipVideo = null, audioCtx = null, analyser = null;
  let mr = null, sink = null, started = 0, elapsed = 0, runFrom = 0, timer = 0, meterTimer = 0, url = null, recName = null;
  const baseTitle = document.title;
  const showMsg = text => { clear(msg).append(icon('alert'), el('span', {}, text)); msg.hidden = !text; };
  const phase = p => {
    setup.hidden = startBtn.hidden = p !== 'setup';
    live.hidden = !(p === 'rec' || p === 'paused');
    count.hidden = p !== 'count';
    done.hidden = p !== 'done';
    box.dataset.phase = p;
  };
  phase('setup');

  function stopTracks() {
    for (const s of [display, micStream]) s?.getTracks().forEach(t => t.stop());
    display = micStream = null;
    clearInterval(meterTimer); meterTimer = 0; meterRow.hidden = true;
    audioCtx?.close().catch(() => {}); audioCtx = null; analyser = null;
  }
  function closeCam() {
    camStream?.getTracks().forEach(t => t.stop()); camStream = null;
    try { pipWin?.close(); } catch { /* closed */ }
    pipWin = null;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    pipVideo = null;
    camBtn.lastChild.textContent = w('Kamera-Fenster einblenden', 'Show camera window');
  }

  camBtn.addEventListener('click', async () => {
    if (camStream) { closeCam(); return; }
    showMsg('');
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: 'user' }, audio: false });
      pipVideo = el('video', { muted: true, playsinline: true, autoplay: true });
      pipVideo.muted = true;
      pipVideo.srcObject = camStream;
      if (can.docPip) {
        pipWin = await window.documentPictureInPicture.requestWindow({ width: 240, height: 240 });
        const d = pipWin.document;
        Object.assign(d.body.style, { margin: '0', background: '#111', overflow: 'hidden', display: 'grid', placeItems: 'center', height: '100vh' });
        Object.assign(pipVideo.style, { width: '96vmin', height: '96vmin', objectFit: 'cover', borderRadius: '50%', transform: 'scaleX(-1)' });
        d.title = w('Kamera', 'Camera');
        d.body.append(pipVideo);
        await pipVideo.play().catch(() => {});
        pipWin.addEventListener('pagehide', () => { if (camStream) closeCam(); });
      } else {
        await pipVideo.play();
        await pipVideo.requestPictureInPicture();
        pipVideo.addEventListener('leavepictureinpicture', () => { if (camStream) closeCam(); });
      }
      camBtn.lastChild.textContent = w('Kamera-Fenster schließen', 'Close camera window');
    } catch (err) {
      closeCam();
      showMsg(err?.name === 'NotAllowedError' ? w('Kein Zugriff auf die Kamera. Erlaube ihn über das Symbol in der Adressleiste.', 'No access to the camera. Allow it via the icon in the address bar.')
        : w('Das Kamera-Fenster ließ sich nicht öffnen.', 'The camera window could not be opened.'));
    }
  });

  function meterLoop() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    meterRow.hidden = false;
    meterTimer = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const x of data) peak = Math.max(peak, Math.abs(x - 128));
      const pct = Math.min(100, Math.round((peak / 128) * 160));
      meter.firstChild.style.width = pct + '%';
      meter.setAttribute('aria-valuenow', String(pct));
    }, 120);
  }

  startBtn.addEventListener('click', async () => {
    showMsg('');
    const q = QUALITY[set.quality] || QUALITY.std;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { height: { ideal: q.h, max: q.h }, frameRate: { ideal: q.fps, max: q.fps }, cursor: 'always' },
        audio: set.sys ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
        systemAudio: set.sys ? 'include' : 'exclude', selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
      });
    } catch (err) {
      display = null;
      showMsg(err?.name === 'NotAllowedError' ? w('Die Bildschirmfreigabe wurde abgebrochen oder ist blockiert.', 'Screen sharing was cancelled or is blocked.') : w('Der Bildschirm ließ sich nicht freigeben.', 'The screen could not be shared.'));
      return;
    }
    if (set.mic) {
      try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch {
        showMsg(w('Kein Zugriff aufs Mikrofon – die Aufnahme läuft ohne deine Stimme.', 'No access to the microphone – recording without your voice.'));
      }
    }
    const sysTracks = display.getAudioTracks();
    if (set.sys && !sysTracks.length && !msg.textContent) showMsg(w('Der Browser gibt für diese Auswahl keinen Ton frei – aufgenommen wird nur das Bild' + (micStream ? ' und das Mikrofon.' : '.'), 'The browser shares no sound for this choice – only the picture' + (micStream ? ' and the microphone are' : ' is') + ' recorded.'));
    // audio: mix microphone and screen sound into one track
    const tracks = [...display.getVideoTracks()];
    const micTracks = micStream?.getAudioTracks() || [];
    if (micTracks.length || sysTracks.length) {
      audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      for (const s of [micStream, sysTracks.length ? new MediaStream(sysTracks) : null]) if (s) audioCtx.createMediaStreamSource(s).connect(dest);
      if (micStream) { analyser = audioCtx.createAnalyser(); analyser.fftSize = 512; audioCtx.createMediaStreamSource(micStream).connect(analyser); meterLoop(); }
      tracks.push(...dest.stream.getAudioTracks());
    }
    display.getVideoTracks()[0].addEventListener('ended', () => { if (mr && mr.state !== 'inactive') stop(); else if (!mr) { cancelCount = true; stopTracks(); phase('setup'); } });
    if (set.countdown) {
      phase('count');
      cancelCount = false;
      for (const n of [3, 2, 1]) {
        count.textContent = String(n); document.title = `${n} … ${baseTitle}`;
        await new Promise(r => setTimeout(r, 1000));
        if (cancelCount) { document.title = baseTitle; return; }
      }
    }
    const mime = set.format === 'mp4' && can.mp4 ? can.mp4 : (can.webm || can.mp4);
    try {
      sink = await openSink(mime);
      mr = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: q.vbps, audioBitsPerSecond: 128000 });
    } catch {
      stopTracks(); phase('setup');
      showMsg(w('Die Aufnahme konnte nicht starten.', 'The recording could not start.'));
      return;
    }
    recName = sink.name || null;
    mr.ondataavailable = e => { if (e.data?.size) sink.write(e.data); };
    mr.onstop = onStopped;
    mr.onerror = () => { showMsg(w('Die Aufnahme wurde vom Browser abgebrochen. Was bis dahin aufgenommen wurde, bleibt erhalten.', 'The browser stopped the recording. What was recorded up to then is kept.')); stop(); };
    started = Date.now(); elapsed = 0; runFrom = performance.now();
    mr.start(1000);
    phase('rec');
    pauseBtn.textContent = w('Pause', 'Pause');
    timer = setInterval(tickTime, 250);
    window.addEventListener('beforeunload', guard);
    tickTime();
  });
  let cancelCount = false;
  const now = () => elapsed + (mr?.state === 'recording' ? performance.now() - runFrom : 0);
  function tickTime() {
    const t = clock(now());
    timeEl.textContent = t;
    sizeEl.textContent = sink ? formatSize(sink.size, lang) : '';
    document.title = `${mr?.state === 'paused' ? '❚❚' : '●'} ${t} · ${baseTitle}`;
  }
  function guard(e) { e.preventDefault(); e.returnValue = ''; }

  pauseBtn.addEventListener('click', () => {
    if (!mr) return;
    if (mr.state === 'recording') { mr.pause(); elapsed += performance.now() - runFrom; pauseBtn.textContent = w('Fortsetzen', 'Resume'); phase('paused'); }
    else if (mr.state === 'paused') { mr.resume(); runFrom = performance.now(); pauseBtn.textContent = w('Pause', 'Pause'); phase('rec'); }
    tickTime();
  });
  stopBtn.addEventListener('click', () => stop());
  function stop() {
    if (!mr || mr.state === 'inactive') return;
    if (mr.state === 'recording') elapsed += performance.now() - runFrom;
    mr.requestData?.();
    mr.stop();
  }
  async function onStopped() {
    clearInterval(timer);
    window.removeEventListener('beforeunload', guard);
    document.title = baseTitle;
    stopTracks(); closeCam();
    const ms = Math.round(elapsed);
    info.textContent = w('Wird fertig gespeichert …', 'Finishing …');
    phase('done');
    let blob = await sink.finish();
    mr = null; sink = null;
    finishWith(blob, ms, started, recName);
  }
  async function finishWith(blob, ms, startedAt, name) {
    if (/webm/.test(blob.type)) blob = await withDuration(blob, ms || await probeDuration(blob));
    if (!ms) ms = Math.round(await probeDuration(blob)) || 0;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    video.src = url;
    v.rec = { blob, ms, started: startedAt, name };
    info.textContent = `${clock(ms)} · ${formatSize(blob.size, lang)} · ${/mp4/.test(blob.type) ? 'MP4' : 'WebM'}`;
    phase('done');
    state.results.clear(); ctx.refresh();
  }
  againBtn.addEventListener('click', async () => {
    const old = v.rec;
    v.rec = null;
    video.removeAttribute('src'); video.load();
    if (url) { URL.revokeObjectURL(url); url = null; }
    if (old?.name) await removeRecording(old.name);
    phase('setup'); state.results.clear(); ctx.refresh();
  });
  return {};
}

/** Length of a recovered WebM without duration: let the browser seek to the end. */
async function probeDuration(blob) {
  const u = URL.createObjectURL(blob);
  try {
    const vid = document.createElement('video');
    vid.preload = 'metadata'; vid.muted = true; vid.src = u;
    await new Promise((res, rej) => { vid.onloadedmetadata = res; vid.onerror = rej; setTimeout(res, 4000); });
    if (Number.isFinite(vid.duration) && vid.duration > 0) return vid.duration * 1000;
    vid.currentTime = 1e9;
    await new Promise(res => { vid.ontimeupdate = res; setTimeout(res, 4000); });
    return Number.isFinite(vid.duration) ? vid.duration * 1000 : 0;
  } catch { return 0; } finally { URL.revokeObjectURL(u); }
}
