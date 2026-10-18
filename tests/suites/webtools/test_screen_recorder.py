"""Screen recorder: DE/EN × phone/desktop render (CSP, a11y), screen + microphone + tab sound recorded through
stubbed capture streams (canvas + oscillators), pause excluded from the length, WebM with duration (ffprobe),
video and audio stream present and decodable, recovery of a recording cut off by a reload (OPFS), no recovery
offer after a normal finish, cancelled sharing explains itself, capture allowed only on this page, no freeze."""
import json, subprocess, urllib.request
from wtlib import Suite, ORIGIN

P = ('/werkzeuge/bildschirm-aufnehmen/', '/en/tools/screen-recorder/')

STUB = r"""
(() => {
  const fakeVideo = () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d'); let n = 0;
    setInterval(() => { g.fillStyle = `hsl(${(n += 7) % 360},70%,50%)`; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText(String(n), 40, 200); }, 40);
    return c.captureStream(25);
  };
  const tone = f => { const ac = new AudioContext(); const o = ac.createOscillator(); o.frequency.value = f; const d = ac.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream; };
  window.__deny = false;
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getDisplayMedia = async (c) => {
      if (window.__deny) throw new DOMException('denied', 'NotAllowedError');
      const s = fakeVideo();
      if (c && c.audio) tone(330).getAudioTracks().forEach(t => s.addTrack(t));
      window.__display = s; return s;
    };
    navigator.mediaDevices.getUserMedia = async (c) => (c && c.audio ? tone(660) : fakeVideo());
  }
})();
"""


def ffprobe(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', str(path)], capture_output=True, text=True)
    j = json.loads(r.stdout or '{}')
    dur = j.get('format', {}).get('duration')
    return (float(dur) if dur not in (None, 'N/A') else None), sorted(st['codec_type'] for st in j.get('streams', []))


def decodes(path):
    return subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'null', '-'], capture_output=True).returncode == 0


with Suite('screen-recorder') as s:
    for v in s.variants():
        v.ctx.add_init_script(STUB)
        page = s.open(v, P[0 if v.lang == 'de' else 1])
        page.wait_for_selector('#rec-start')
        s.expect(s.primary(page).is_disabled(), f'{v}: nothing to save yet')
        if v.device == 'desktop' and v.lang == 'de':
            s.shot(page, 'screen_recorder_desktop', top='.rec')
        s.check_page(page)
        page.close()

    # capture allowed on this page only
    pol = urllib.request.urlopen(ORIGIN + P[0]).headers.get('Permissions-Policy', '')
    other = urllib.request.urlopen(ORIGIN + '/werkzeuge/pdf-zusammenfuegen/').headers.get('Permissions-Policy', '')
    s.expect('display-capture=(self)' in pol and 'microphone=(self)' in pol and 'display-capture=()' in other, 'display capture allowed only here')

    ctx = s.context('desktop', 'de')
    ctx.add_init_script(STUB)
    page = s.open(ctx, P[0])
    page.on('dialog', lambda d: d.accept())
    page.wait_for_selector('#rec-start')
    page.locator('#rec-count').uncheck()
    # ------------------------------------------------ record, pause, resume, stop
    page.click('#rec-start')
    page.wait_for_selector('#rec-stop:visible')
    page.wait_for_timeout(2200)
    s.expect(page.locator('.rec-meter-row').is_visible(), 'microphone level shown')
    s.expect(page.title().startswith('●'), f'recording shown in the tab title ({page.title()})')
    page.click('#rec-pause'); page.wait_for_timeout(1500)
    t_paused = page.locator('#rec-time').inner_text()
    page.wait_for_timeout(600)
    s.expect(page.locator('#rec-time').inner_text() == t_paused, 'timer stands still while paused')
    page.click('#rec-pause'); page.wait_for_timeout(1300)
    page.click('#rec-stop')
    page.wait_for_selector('#rec-again:visible')
    page.wait_for_function("() => !document.querySelector('.wt-bar .wt-btn-primary').disabled", timeout=15000)
    s.expect(page.evaluate("() => window.__display.getTracks().every(t => t.readyState === 'ended')"), 'screen sharing ended after stop')
    if s.run(page):
        f = s.download(page, 0)
        dur, streams = ffprobe(f)
        s.expect(f.name.startswith('Bildschirmaufnahme') and f.suffix in ('.webm', '.mp4'), f'file name {f.name}')
        s.expect(dur is not None and 2.6 <= dur <= 4.6, f'duration written, pause excluded ({dur})')
        s.expect(streams == ['audio', 'video'], f'audio + video {streams}')
        s.expect(decodes(f), 'decodes cleanly')
        page.locator('.wt-restart button').first.click()
    # finished normally → no recovery offer on the next visit
    page.reload(); page.wait_for_selector('#rec-start')
    page.wait_for_timeout(500)
    s.expect(page.locator('.rec-recover').is_hidden(), 'no recovery offer after a normal finish')

    # ------------------------------------------------ cut off by a reload → recover
    page.locator('#rec-count').uncheck()
    page.click('#rec-start')
    page.wait_for_selector('#rec-stop:visible')
    page.wait_for_timeout(3200)
    page.reload(); page.wait_for_selector('#rec-start')
    page.wait_for_selector('.rec-recover-row', timeout=5000)
    page.locator('.rec-recover-row button', has_text='Wiederherstellen').click()
    page.wait_for_function("() => !document.querySelector('.wt-bar .wt-btn-primary').disabled", timeout=15000)
    if s.run(page):
        f = s.download(page, 0)
        dur, streams = ffprobe(f)
        s.expect(decodes(f) and 'video' in streams, f'recovered recording decodes {streams}')
        s.expect(dur is not None and dur >= 1.5, f'recovered length {dur}')
        page.locator('.wt-restart button').first.click()
    page.click('#rec-again')
    page.reload(); page.wait_for_selector('#rec-start'); page.wait_for_timeout(500)
    s.expect(page.locator('.rec-recover').is_hidden(), 'recovered recording removed after “record again”')

    # ------------------------------------------------ cancelled sharing
    page.evaluate("() => { window.__deny = true; }")
    page.click('#rec-start')
    page.wait_for_timeout(300)
    s.expect('abgebrochen' in page.locator('.rec .img-note').inner_text(), 'cancelled sharing explained')
    s.check_page(page)
    s.record_freeze(page)
    page.close()
