// "Geräte verbinden / Übertragen": phone ↔ PC transfer over a WebRTC data channel, with an encrypted
// relay (share storage, 1 h expiry) as automatic fallback when no direct connection is possible.
//
// Pairing: device A (host) opens a short-lived room on our API and shows a QR code + 6-digit code.
//   QR code  = link …#/verbinden?r=<room id>&s=<32-byte secret S>   (S lives only in the fragment)
//   6 digits = the room's code (issued by the server)
// Device B (guest) scans the QR code or types the code. Signalling messages (SDP offer/answer) are
// encrypted with AES-GCM under K = HKDF(S) (QR) or K = HKDF(code, room) (typed code) and relayed by
// our API, which only sees ciphertext. The data channel itself is DTLS-encrypted end to end.
// STUN: Google's public STUN servers tell each device its public address (they see the IP addresses,
// no content). There is no TURN server: if the devices cannot reach each other directly, files go
// through the encrypted relay instead (key derived from K, uploaded as ciphertext, deleted after receipt
// or after 1 hour at the latest).
//
// Threat model:
//   - network attackers / other users: cannot join (one guest per room, code attempts rate-limited per
//     IP, room expires after 1 h), cannot read signalling, DTLS or relay data.
//   - our server (honest-but-curious): sees room ids, timing, sizes; with the QR path it cannot read or
//     alter the signalling (K from S never reaches it) → cannot man-in-the-middle the DTLS session.
//     With the typed 6-digit code it could brute-force the code offline and MITM the session; both
//     screens therefore show a "Prüfnummer" derived from both DTLS fingerprints – if they match, nobody
//     sits in between. QR pairing is the recommended (strong) path.
//   - a compromised device is out of scope.
import * as db from '../db.js';
import { h, esc, toast, formatSize, pickFiles, openDialog } from '../ui.js';
import { oicon, kindTile, kindOf, openHash, detectKind } from '../office/kinds.js';
import { saveFile } from '../platform.js';
import { b64u, randomBytes, deriveKey, sealMsg, openMsg, sha256Hex, hasWebCrypto } from './crypto.js';
import { transferApi, shareApi, uploadEncrypted, downloadDecrypted, linkBase, online } from './api.js';
import { offlineBanner, progressBar, qrSvg, shareErrorText, sicon } from './common.js';

const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const CHUNK = 64 * 1024;
const P2P_TIMEOUT_MS = 15000;
const te = new TextEncoder();

export async function mount(screen, { params }) {
  const wrap = h('<div class="screen-inner sh-transfer"></div>');
  screen.body.appendChild(wrap);
  const off = offlineBanner(on => { wrap.querySelectorAll('[data-net]').forEach(b => { b.disabled = !on; }); });
  wrap.appendChild(off.el);
  const main = h('<div class="sh-tr-main"></div>');
  wrap.appendChild(main);
  let session = null;
  let scanner = null;
  const destroy = () => { off.destroy(); if (scanner) scanner.stop(); if (session) session.close(); };

  if (!hasWebCrypto()) { main.appendChild(h('<div class="card card-pad"><strong>Dieser Browser kann nicht verschlüsseln.</strong><p class="muted">Bitte nutze einen aktuellen Browser über HTTPS.</p></div>')); return destroy; }

  const r = params.get('r'), s = params.get('s');
  if (r && s) { joinWith({ room: r, secret: s }); return destroy; }
  renderChoice();

  function renderChoice() {
    main.innerHTML = '';
    const c = h(`<div>
      <div class="sh-hero card">${sicon('devices')}<div><strong>Handy ↔ PC – direkt und verschlüsselt</strong>
        <p>Öffne FaLe PDF auf beiden Geräten. Ein Gerät zeigt einen QR-Code, das andere scannt ihn – fertig. Funktioniert auch zwischen App und Browser.</p></div></div>
      <div class="sh-tr-choice">
        <button class="action-card" type="button" data-host data-net><span class="tile-ic sh-ic">${oicon('qr')}</span><span><strong>Code anzeigen</strong><span class="muted small">Dieses Gerät zeigt einen QR-Code und einen 6-stelligen Code.</span></span></button>
        <button class="action-card" type="button" data-scan data-net><span class="tile-ic sh-ic">${oicon('camera')}</span><span><strong>QR-Code scannen</strong><span class="muted small">Mit der Kamera dieses Geräts.</span></span></button>
      </div>
      <form class="card card-pad sh-tr-code" data-codeform>
        <label class="field"><span class="field-label">Oder 6-stelligen Code eingeben</span>
          <input class="input sh-code-input" inputmode="numeric" pattern="[0-9 ]*" maxlength="7" autocomplete="one-time-code" placeholder="123 456" data-code></label>
        <button class="btn btn-primary" type="submit" data-net>${oicon('link')} Verbinden</button>
      </form>
      <p class="muted small sh-tr-note">${sicon('shield')}<span>Die Übertragung läuft direkt zwischen den Geräten (WebRTC, verschlüsselt). Klappt keine direkte Verbindung, gehen die Dateien Ende-zu-Ende-verschlüsselt über unseren Server und werden nach dem Empfang, spätestens nach 1 Stunde gelöscht. Für den Verbindungsaufbau werden die öffentlichen STUN-Server von Google genutzt.</span></p>
    </div>`);
    main.appendChild(c);
    c.querySelector('[data-host]').addEventListener('click', host);
    c.querySelector('[data-scan]').addEventListener('click', scan);
    c.querySelector('[data-codeform]').addEventListener('submit', e => {
      e.preventDefault();
      const code = c.querySelector('[data-code]').value.replace(/\D/g, '');
      if (code.length !== 6) { toast('Bitte gib den 6-stelligen Code ein.', 'error'); return; }
      joinWith({ code });
    });
    c.querySelectorAll('[data-net]').forEach(b => { b.disabled = !online(); });
  }

  async function host() {
    main.innerHTML = '<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span>Verbindung wird vorbereitet …</span></div></div>';
    try {
      const room = await transferApi.create();
      const S = randomBytes(32);
      const url = `${linkBase()}#/verbinden?r=${room.room}&s=${b64u.enc(S)}`;
      session = new Session({ role: 'host', room: room.room, auth: room.auth, qrSecret: S, code: room.code, ui: sessionUi() });
      main.innerHTML = '';
      const c = h(`<div class="card card-pad sh-tr-host">
        <div class="sh-tr-qr" data-qr></div>
        <div class="sh-tr-codebox"><span class="muted small">Code</span><strong class="sh-tr-code-big" data-no-i18n>${room.code.slice(0, 3)} ${room.code.slice(3)}</strong>
          <span class="muted small">gültig bis ${new Date(room.expiresAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div class="sh-tr-wait"><span class="spinner dark" aria-hidden="true"></span><span data-wait>Warte auf das andere Gerät …</span></div>
        <p class="muted small">Scanne den QR-Code mit dem anderen Gerät (Kamera-App oder FaLe → „Geräte verbinden“ → „QR-Code scannen“) oder gib dort den Code ein.</p>
        <button class="btn btn-ghost btn-sm" type="button" data-cancel>Abbrechen</button></div>`);
      main.appendChild(c);
      c.querySelector('[data-cancel]').addEventListener('click', () => { session.close(); session = null; renderChoice(); });
      try { c.querySelector('[data-qr]').innerHTML = await qrSvg(url, 230); } catch { c.querySelector('[data-qr]').hidden = true; }
      c.querySelector('[data-qr]').dataset.url = url;
      session.start();
    } catch (e) {
      toast(shareErrorText(e, 'Die Verbindung konnte nicht vorbereitet werden.'), 'error', { timeout: 6000 });
      renderChoice();
    }
  }

  async function scan() {
    const { getDetector } = await import('../tools/qrscan.js');
    const det = await getDetector();
    if (!det || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Dieser Browser kann keine QR-Codes scannen. Nutze die Kamera-App deines Handys oder gib den 6-stelligen Code ein.', 'info', { timeout: 7000 });
      return;
    }
    main.innerHTML = '';
    const c = h(`<div class="card card-pad sh-tr-scan"><div class="sh-tr-video"><video playsinline muted></video><span class="sh-tr-frame" aria-hidden="true"></span></div>
      <p class="muted small">Halte die Kamera auf den QR-Code des anderen Geräts.</p><button class="btn btn-ghost btn-sm" type="button" data-cancel>Abbrechen</button></div>`);
    main.appendChild(c);
    const video = c.querySelector('video');
    let stream = null, timer = null, busy = false;
    scanner = { stop() { clearInterval(timer); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; } };
    c.querySelector('[data-cancel]').addEventListener('click', () => { scanner.stop(); scanner = null; renderChoice(); });
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
      video.srcObject = stream;
      await video.play().catch(() => {});
    } catch { toast('Kein Kamerazugriff. Gib stattdessen den 6-stelligen Code ein.', 'error', { timeout: 6000 }); scanner.stop(); scanner = null; renderChoice(); return; }
    timer = setInterval(async () => {
      if (busy || video.readyState < 2) return;
      busy = true;
      try {
        const codes = await det.detect(video);
        const hit = (codes || []).map(x => parsePairing(x.rawValue)).find(Boolean);
        if (hit) { scanner.stop(); scanner = null; joinWith(hit); }
      } catch { /* frame not ready */ } finally { busy = false; }
    }, 300);
  }

  async function joinWith({ room = null, secret = null, code = null }) {
    main.innerHTML = '<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span>Verbinde …</span></div></div>';
    try {
      const j = await transferApi.join(room ? { room } : { code });
      // the pairing secret should not linger in the address bar / history (a reload could not re-join anyway)
      if (room) try { history.replaceState(null, '', `${location.pathname}${location.search}#/verbinden`); } catch {}
      session = new Session({ role: 'guest', room: j.room, auth: j.auth, qrSecret: secret ? b64u.dec(secret) : null, code, ui: sessionUi() });
      session.start();
    } catch (e) {
      toast(shareErrorText(e, 'Verbinden fehlgeschlagen.'), 'error', { timeout: 6000 });
      if (params.get('r')) history.replaceState(null, '', '#/verbinden');
      renderChoice();
    }
  }

  // ---------------------------------------------------------------- connected UI
  function sessionUi() {
    let box = null, list = null;
    const rows = new Map();
    return {
      connecting(text) {
        const w = main.querySelector('[data-wait]');
        if (w) { w.textContent = text; return; }
        if (box) return;
        main.innerHTML = `<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span data-wait>${esc(text)}</span></div></div>`;
      },
      connected({ mode, sas, verified }) {
        if (!box) {
          main.innerHTML = '';
          box = h(`<div class="sh-tr-session">
            <div class="card sh-tr-status"><span class="sh-tr-dot" aria-hidden="true"></span><div><strong>Verbunden</strong>
              <span class="muted small" data-mode></span></div>
              <div class="sh-tr-sas"><span class="muted small">Prüfnummer</span><strong data-sas data-no-i18n></strong></div>
              <button class="btn btn-ghost btn-sm" type="button" data-close>Trennen</button></div>
            <p class="hint sh-tr-sashint" data-sashint></p>
            <div class="sh-tr-send card card-pad"><strong>Dateien senden</strong>
              <div class="sh-actions-row"><button class="btn btn-primary" type="button" data-lib>${oicon('folder')} Aus meinen Dateien</button>
              <button class="btn btn-soft" type="button" data-dev>${oicon('upload')} Vom Gerät</button></div>
              <p class="muted small">Empfangene Dateien landen automatisch in deinen Dateien (Quelle „Empfangen“).</p></div>
            <h2 class="section-title">Übertragungen</h2><div class="sh-tr-list" data-list><p class="panel-empty" data-empty>Noch keine Dateien übertragen.</p></div></div>`);
          main.appendChild(box);
          list = box.querySelector('[data-list]');
          box.querySelector('[data-close]').addEventListener('click', () => { session.close(); session = null; box = null; renderChoice(); toast('Verbindung getrennt.'); });
          box.querySelector('[data-dev]').addEventListener('click', async () => { const files = await pickFiles({ accept: '*/*', multiple: true }); if (files.length) session.sendFiles(files); });
          box.querySelector('[data-lib]').addEventListener('click', async () => { const files = await pickLibraryFiles(); if (files.length) session.sendFiles(files); });
        }
        box.querySelector('[data-mode]').textContent = mode === 'p2p' ? 'Direkt zwischen den Geräten (Peer-to-Peer, DTLS-verschlüsselt)' : 'Über das verschlüsselte Relais (Ende-zu-Ende-verschlüsselt, max. 1 Stunde gespeichert)';
        box.querySelector('[data-sas]').textContent = sas || '–';
        box.querySelector('.sh-tr-sas').hidden = !sas;
        box.querySelector('[data-sashint]').textContent = sas ? (verified ? 'Per QR-Code gekoppelt. Die Prüfnummer muss auf beiden Geräten gleich sein.' : 'Vergleiche die Prüfnummer auf beiden Geräten – stimmt sie überein, ist die Verbindung sicher.') : 'Kopplung über den Code. Die Dateien sind trotzdem Ende-zu-Ende-verschlüsselt.';
      },
      file(id, { name, size, dir }) {
        if (!list) return null;
        const e = list.querySelector('[data-empty]'); if (e) e.remove();
        const row = h(`<div class="card sh-tr-row" data-fid="${esc(id)}"><span class="sh-tr-dir ${dir}">${oicon(dir === 'in' ? 'download' : 'upload')}</span>
          <div class="sh-tr-info"><strong data-no-i18n>${esc(name)}</strong><span class="muted small" data-st>${formatSize(size)} · ${dir === 'in' ? 'wird empfangen' : 'wird gesendet'}</span><div class="sh-bar"><span></span></div></div>
          <span data-act></span></div>`);
        list.prepend(row);
        rows.set(id, row);
        return row;
      },
      progress(id, frac) { const r = rows.get(id); if (r) r.querySelector('.sh-bar span').style.width = `${Math.round(Math.min(1, frac) * 100)}%`; },
      done(id, text, doc, file) {
        const r = rows.get(id);
        if (!r) return;
        r.classList.add('done');
        r.querySelector('.sh-bar span').style.width = '100%';
        r.querySelector('[data-st]').textContent = text;
        if (doc) { const a = h(`<a class="btn btn-ghost btn-sm" href="${openHash(doc)}">Öffnen</a>`); r.querySelector('[data-act]').appendChild(a); }
        if (file) {
          const b = h(`<button class="btn btn-soft btn-sm" type="button" data-save-file>${oicon('download')} Speichern</button>`);
          b.addEventListener('click', () => saveFile(file, file.name, file.type));
          r.querySelector('[data-act]').appendChild(b);
        }
      },
      failed(id, text) { const r = rows.get(id); if (r) { r.classList.add('failed'); r.querySelector('[data-st]').textContent = text; } },
      closed(text) {
        if (!session) return;
        session = null; box = null;
        toast(text || 'Die Verbindung wurde beendet.', 'info', { timeout: 5000 });
        renderChoice();
      },
    };
  }

  return destroy;
}

/** "…#/verbinden?r=<room>&s=<secret>" → {room, secret} */
export function parsePairing(text) {
  const m = /#\/verbinden\?(?:.*&)?r=([A-Za-z0-9_-]{16,32})&s=([A-Za-z0-9_-]{43})/.exec(String(text || ''));
  return m ? { room: m[1], secret: m[2] } : null;
}

async function pickLibraryFiles() {
  const docs = await db.listFiles().catch(() => []);
  if (!docs.length) { toast('Noch keine Dateien vorhanden.', 'info'); return []; }
  const r = await openDialog({
    title: 'Dateien senden', wide: true,
    body: `<div class="pick-list sh-pick-list" role="group" aria-label="Dateien">${docs.slice(0, 200).map(d => `<label class="pick-item"><input type="checkbox" value="${esc(d.id)}">${kindTile(kindOf(d))}<span class="doc-info"><span class="doc-name">${esc(d.name)}</span><span class="doc-meta">${formatSize(d.size)}</span></span></label>`).join('')}</div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Senden', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => ({ collect: () => Array.from(dlg.querySelectorAll('input:checked')).map(i => i.value) }),
  });
  if (r.value !== 'ok' || !r.data || !r.data.length) return [];
  const out = [];
  for (const id of r.data) {
    const d = docs.find(x => x.id === id);
    const blob = await db.getFile(id);
    if (d && blob) out.push(new File([blob], d.name, { type: blob.type || '' }));
  }
  return out;
}

// ==================================================================== session
class Session {
  constructor({ role, room, auth, qrSecret, code, ui }) {
    Object.assign(this, { role, room, auth, qrSecret, code, ui });
    this.after = 0;
    this.alive = true;
    this.keys = null;     // candidate signalling keys
    this.K = null;        // agreed signalling key material
    this.mode = null;     // 'p2p' | 'relay'
    this.pc = null; this.dc = null;
    this.sendQueue = Promise.resolve();
    this.incoming = null; // current P2P file being received
    this.pending = new Map(); // fid → {resolve}
    this.relayOwned = new Map(); // object id → owner auth (to delete after receipt)
    this.sas = '';
  }

  async keyCandidates() {
    if (this.keys) return this.keys;
    const list = [];
    if (this.qrSecret) list.push({ via: 'qr', k: await deriveKey(this.qrSecret, this.room, 'fale-transfer-v1/qr') });
    if (this.code) list.push({ via: 'code', k: await deriveKey(te.encode(this.code), this.room, 'fale-transfer-v1/code') });
    this.keys = list;
    return list;
  }

  async start() {
    await this.keyCandidates();
    if (this.role === 'guest') {
      this.K = this.keys[0]; // guest knows how it joined
      this.ui.connecting('Verbunden mit dem Raum – baue direkte Verbindung auf …');
      if (forceRelay() || typeof RTCPeerConnection !== 'function') this.toRelay('no-webrtc');
      else this.makeOffer().catch(e => { console.warn(e); this.toRelay('offer-failed'); });
    }
    this.poll();
  }

  async poll() {
    while (this.alive) {
      try {
        const r = await transferApi.poll(this.room, this.auth, this.after);
        if (!this.alive) return;
        if (this.role === 'host' && r.joined && !this.peerJoined) { this.peerJoined = true; this.ui.connecting('Das andere Gerät ist da – baue Verbindung auf …'); }
        for (const m of r.msgs) { this.after = Math.max(this.after, m.seq); await this.onSignal(m.body); }
      } catch (e) {
        if (!this.alive) return;
        if (e && (e.status === 404 || e.status === 403)) { this.alive = false; this.cleanupPc(); this.ui.closed('Die Verbindung ist abgelaufen oder wurde beendet.'); return; }
      }
      await sleep(this.mode === 'p2p' ? 4000 : 1000);
    }
  }

  async seal(obj) { return sealMsg(this.K.k, obj); }
  async signal(obj) { await transferApi.send(this.room, this.auth, await this.seal(obj)); }

  async onSignal(body) {
    let msg = null;
    const cands = this.K ? [this.K] : this.keys;
    for (const c of cands) { try { msg = await openMsg(c.k, body); this.K = c; break; } catch { /* next */ } }
    if (!msg) { console.warn('transfer: undecryptable signalling message'); return; }
    if (msg.t === 'offer' && this.role === 'host') {
      if (forceRelay() || typeof RTCPeerConnection !== 'function') { this.toRelay('no-webrtc'); return; }
      try { await this.answer(msg.sdp); } catch (e) { console.warn(e); this.toRelay('answer-failed'); }
    } else if (msg.t === 'answer' && this.role === 'guest' && this.pc) {
      try { await this.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }); } catch (e) { console.warn(e); this.toRelay('answer-failed'); }
    } else if (msg.t === 'relay') {
      this.setRelay();
    } else if (msg.t === 'rfile') {
      this.receiveRelay(msg);
    } else if (msg.t === 'rgot') {
      const auth = this.relayOwned.get(msg.id);
      if (auth) { this.relayOwned.delete(msg.id); shareApi.remove(msg.id, auth).catch(() => {}); }
      const p = this.pending.get(msg.fid); if (p) { this.pending.delete(msg.fid); p.resolve(); }
    } else if (msg.t === 'bye') {
      this.alive = false; this.cleanupPc(); this.ui.closed('Das andere Gerät hat die Verbindung beendet.');
    }
  }

  newPc() {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.pc = pc;
    pc.addEventListener('connectionstatechange', () => {
      if (['failed'].includes(pc.connectionState) && this.mode !== 'relay') this.toRelay('ice-failed');
      if (pc.connectionState === 'disconnected' && this.mode === 'p2p') setTimeout(() => { if (this.pc === pc && pc.connectionState !== 'connected' && this.alive) this.toRelay('disconnected'); }, 4000);
    });
    this.p2pTimer = setTimeout(() => { if (this.mode !== 'p2p' && this.alive) this.toRelay('timeout'); }, P2P_TIMEOUT_MS);
    return pc;
  }

  async makeOffer() {
    const pc = this.newPc();
    this.setupChannel(pc.createDataChannel('fale', { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    await this.signal({ t: 'offer', sdp: pc.localDescription.sdp });
  }

  async answer(sdp) {
    const pc = this.newPc();
    pc.addEventListener('datachannel', e => this.setupChannel(e.channel));
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    await this.signal({ t: 'answer', sdp: pc.localDescription.sdp });
  }

  setupChannel(dc) {
    this.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 1 << 20;
    const onOpen = async () => {
      if (this.mode === 'relay' || this.mode === 'p2p') return;
      clearTimeout(this.p2pTimer);
      this.mode = 'p2p';
      this.sas = await sasFrom(this.pc);
      this.ui.connected({ mode: 'p2p', sas: this.sas, verified: this.K && this.K.via === 'qr' });
    };
    if (dc.readyState === 'open') onOpen(); else dc.addEventListener('open', onOpen);
    dc.addEventListener('message', e => this.onData(e.data));
    dc.addEventListener('close', () => { if (this.mode === 'p2p' && this.alive) this.toRelay('closed'); });
  }

  async toRelay(reason) {
    if (this.mode === 'relay' || !this.alive) return;
    console.info('transfer: relay mode', reason);
    this.setRelay();
    try { await this.signal({ t: 'relay' }); } catch {}
  }
  setRelay() {
    if (this.mode === 'relay') return;
    clearTimeout(this.p2pTimer);
    this.mode = 'relay';
    this.cleanupPc();
    this.ui.connected({ mode: 'relay', sas: '', verified: this.K && this.K.via === 'qr' });
  }
  cleanupPc() { clearTimeout(this.p2pTimer); try { this.dc && this.dc.close(); } catch {} try { this.pc && this.pc.close(); } catch {} this.dc = null; this.pc = null; }

  // ---------------------------------------------------------------- sending
  sendFiles(files) {
    for (const f of files) {
      const fid = b64u.enc(randomBytes(9));
      this.ui.file(fid, { name: f.name, size: f.size, dir: 'out' });
      this.sendQueue = this.sendQueue.then(() => (this.mode === 'p2p' ? this.sendP2p(f, fid) : this.sendRelay(f, fid)))
        .then(() => this.ui.done(fid, `${formatSize(f.size)} · gesendet`))
        .catch(e => { console.warn(e); this.ui.failed(fid, shareErrorText(e, 'Senden fehlgeschlagen.')); });
    }
  }

  async sendP2p(file, fid) {
    const dc = this.dc;
    if (!dc || dc.readyState !== 'open') return this.sendRelay(file, fid);
    const acked = new Promise((resolve, reject) => { this.pending.set(fid, { resolve, reject }); });
    dc.send(JSON.stringify({ t: 'file', fid, name: file.name, size: file.size, type: file.type || '' }));
    let off = 0;
    while (off < file.size) {
      if (dc.readyState !== 'open') throw new Error('channel closed');
      if (dc.bufferedAmount > 4 * CHUNK * 16) await new Promise(r => { const fn = () => { dc.removeEventListener('bufferedamountlow', fn); r(); }; dc.addEventListener('bufferedamountlow', fn); });
      const buf = await file.slice(off, off + CHUNK).arrayBuffer();
      dc.send(buf);
      off += buf.byteLength;
      this.ui.progress(fid, (off / Math.max(1, file.size)) * 0.98);
    }
    dc.send(JSON.stringify({ t: 'eof', fid }));
    await Promise.race([acked, sleep(120000).then(() => { throw new Error('timeout'); })]);
  }

  async relayKey() { return deriveKey(this.K.k, this.room, 'fale-transfer-v1/relay'); }

  async sendRelay(file, fid) {
    const ck = await this.relayKey();
    const meta = { name: file.name, type: file.type || 'application/octet-stream', size: file.size };
    const up = await uploadEncrypted(file, {
      ck, meta,
      announce: ({ size, chunks, header }) => shareApi.create({ kind: 'relay', size, chunks, header, expiresIn: 3600 }),
      onProgress: f => this.ui.progress(fid, f * 0.9),
    });
    await shareApi.finish(up.id, up.auth);
    this.relayOwned.set(up.id, up.auth);
    const got = new Promise((resolve) => { this.pending.set(fid, { resolve }); });
    await this.signal({ t: 'rfile', id: up.id, fid, name: file.name, size: file.size });
    await Promise.race([got, sleep(300000)]);
  }

  // ---------------------------------------------------------------- receiving
  onData(data) {
    if (typeof data === 'string') {
      let m; try { m = JSON.parse(data); } catch { return; }
      if (m.t === 'file') {
        this.incoming = { fid: m.fid, name: String(m.name || 'Datei').slice(0, 200), size: Number(m.size) || 0, type: String(m.type || ''), parts: [], got: 0 };
        this.ui.file('in-' + m.fid, { name: this.incoming.name, size: this.incoming.size, dir: 'in' });
      } else if (m.t === 'eof' && this.incoming && this.incoming.fid === m.fid) {
        const inc = this.incoming; this.incoming = null;
        const blob = new Blob(inc.parts, { type: inc.type });
        if (blob.size !== inc.size) { this.ui.failed('in-' + inc.fid, 'Unvollständig empfangen.'); return; }
        try { this.dc && this.dc.readyState === 'open' && this.dc.send(JSON.stringify({ t: 'ack', fid: inc.fid })); } catch {}
        this.store(inc.fid, new File([blob], inc.name, { type: inc.type }));
      } else if (m.t === 'ack') {
        const p = this.pending.get(m.fid); if (p) { this.pending.delete(m.fid); p.resolve(); }
      }
      return;
    }
    const inc = this.incoming;
    if (!inc) return;
    inc.parts.push(data);
    inc.got += data.byteLength;
    this.ui.progress('in-' + inc.fid, inc.got / Math.max(1, inc.size));
  }

  async receiveRelay(msg) {
    const id = 'in-' + msg.fid;
    this.ui.file(id, { name: String(msg.name || 'Datei'), size: Number(msg.size) || 0, dir: 'in' });
    try {
      const ck = await this.relayKey();
      const r = await shareApi.open(msg.id);
      const res = await downloadDecrypted({ ...r.object, ticket: r.ticket }, ck, { onProgress: f => this.ui.progress(id, f) });
      await this.signal({ t: 'rgot', id: msg.id, fid: msg.fid }).catch(() => {});
      await this.store(msg.fid, new File([res.blob], String(res.meta.name || msg.name || 'Datei'), { type: res.meta.type || '' }));
    } catch (e) { this.ui.failed(id, shareErrorText(e, 'Empfang fehlgeschlagen.')); }
  }

  async store(fid, file) {
    try {
      if (!detectKind(file)) { // a type FaLe cannot keep in its library: offer to save it on the device instead
        this.ui.done('in-' + fid, `${formatSize(file.size)} · empfangen`, null, file);
        return;
      }
      const { importFiles } = await import('../library.js');
      const docs = await importFiles([file], { source: 'Empfangen', any: true, quiet: true });
      this.ui.done('in-' + fid, `${formatSize(file.size)} · empfangen und gespeichert`, docs[0] || null);
      if (!docs.length) this.ui.failed('in-' + fid, 'Empfangen, aber dieser Dateityp kann nicht gespeichert werden.');
    } catch (e) { this.ui.failed('in-' + fid, shareErrorText(e, 'Speichern fehlgeschlagen.')); }
  }

  close() {
    if (!this.alive) return;
    this.alive = false;
    const room = this.room, auth = this.auth;
    (this.K ? this.signal({ t: 'bye' }) : Promise.resolve()).catch(() => {}).finally(() => transferApi.close(room, auth).catch(() => {}));
    for (const [id, a] of this.relayOwned) shareApi.remove(id, a).catch(() => {});
    this.cleanupPc();
  }
}

function iceServers() {
  if (typeof window !== 'undefined' && Array.isArray(window.__FALE_ICE__)) return window.__FALE_ICE__;
  return DEFAULT_ICE;
}
function forceRelay() { return typeof window !== 'undefined' && window.__FALE_FORCE_RELAY__ === true; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Wait for ICE gathering (non-trickle signalling), max. 4 s. */
function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', chk); resolve(); };
    const chk = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, 4000);
    pc.addEventListener('icegatheringstatechange', chk);
  });
}

/** 6-digit check number from both DTLS certificate fingerprints. */
async function sasFrom(pc) {
  try {
    const fp = sdp => ((/a=fingerprint:(\S+ \S+)/i.exec(sdp || '') || [])[1] || '').toUpperCase();
    const a = fp(pc.localDescription && pc.localDescription.sdp), b = fp(pc.remoteDescription && pc.remoteDescription.sdp);
    if (!a || !b) return '';
    const hex = await sha256Hex(te.encode([a, b].sort().join('|')));
    const n = parseInt(hex.slice(0, 8), 16) % 1000000;
    const s = String(n).padStart(6, '0');
    return `${s.slice(0, 3)} ${s.slice(3)}`;
  } catch { return ''; }
}
