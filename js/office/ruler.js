// Lineal über der Seite: Seitenränder, Einzüge des aktuellen Absatzes (Erstzeile, links/hängend, rechts)
// zum Ziehen sowie Tabstopps (Klick ins Lineal setzt einen, Ziehen aus dem Lineal entfernt ihn).
const PX = 96 / 72;
const CM = 28.3465; // pt

export function createRuler(el, o) {
  // o: { getPage, getZoom, getBlocks, getPageRect, onChange(props), capture }
  el.innerHTML = '<div class="rl-in"><div class="rl-m rl-ml"></div><div class="rl-m rl-mr"></div><div class="rl-ticks"></div>'
    + '<button class="rl-k rl-first" type="button" tabindex="-1" aria-label="Einzug erste Zeile" title="Einzug erste Zeile"></button>'
    + '<button class="rl-k rl-left" type="button" tabindex="-1" aria-label="Einzug links" title="Einzug links / hängend"></button>'
    + '<button class="rl-k rl-right" type="button" tabindex="-1" aria-label="Einzug rechts" title="Einzug rechts"></button><div class="rl-tabs"></div></div>';
  const inner = el.querySelector('.rl-in');
  const ticks = el.querySelector('.rl-ticks');
  const kFirst = el.querySelector('.rl-first'), kLeft = el.querySelector('.rl-left'), kRight = el.querySelector('.rl-right');
  const tabsEl = el.querySelector('.rl-tabs');
  let lastW = 0;
  let cur = { indent: 0, indentR: 0, firstLine: 0, tabs: [] };

  function paintTicks(p, z) {
    const w = p.w * PX * z;
    if (Math.abs(w - lastW) < 0.5) return;
    lastW = w;
    const n = Math.floor(p.w / CM);
    let html = '';
    for (let i = 0; i <= n * 4; i++) {
      const x = (i * CM / 4) * PX * z;
      const cls = i % 4 === 0 ? 'big' : i % 2 === 0 ? 'mid' : '';
      html += `<i class="${cls}" style="left:${x}px"></i>`;
    }
    ticks.innerHTML = html;
  }
  function paint() {
    const p = o.getPage(), z = o.getZoom();
    const r = o.getPageRect();
    if (!r) { el.hidden = true; return; }
    el.hidden = false;
    const host = el.getBoundingClientRect();
    inner.style.left = `${r.left - host.left}px`;
    inner.style.width = `${p.w * PX * z}px`;
    paintTicks(p, z);
    // numbers relative to the left margin (like desktop word processors)
    const ml = p.ml * PX * z, mr = p.mr * PX * z, W = p.w * PX * z;
    el.querySelector('.rl-ml').style.width = `${ml}px`;
    el.querySelector('.rl-mr').style.width = `${mr}px`;
    const b = (o.getBlocks() || [])[0];
    if (b) {
      const cs = getComputedStyle(b);
      const toPt = v => parseFloat(v || 0) * 0.75;
      // indentation relative to the content box of the page
      const edRect = o.getContentRect();
      const br = b.getBoundingClientRect();
      const left = (br.left - edRect.left) / z * 0.75 + toPt(cs.paddingLeft);
      const right = (edRect.right - br.right) / z * 0.75;
      cur = { indent: Math.round(left * 10) / 10, indentR: Math.round(right * 10) / 10, firstLine: toPt(cs.textIndent), tabs: (b.getAttribute('data-tabs') || '').split(',').map(Number).filter(x => x > 0) };
    } else cur = { indent: 0, indentR: 0, firstLine: 0, tabs: [] };
    const X = v => ml + v * PX * z;
    kLeft.style.left = `${X(cur.indent)}px`;
    kFirst.style.left = `${X(cur.indent + cur.firstLine)}px`;
    kRight.style.left = `${W - mr - cur.indentR * PX * z}px`;
    tabsEl.innerHTML = cur.tabs.map(t => `<i class="rl-tab" data-t="${t}" style="left:${X(t)}px" title="Tabstopp"></i>`).join('');
  }

  function drag(kind, e) {
    e.preventDefault();
    const p = o.getPage(), z = o.getZoom();
    const startX = e.clientX;
    const start = { ...cur };
    let moved = false;
    const snap = v => Math.round(v / (CM / 4)) * (CM / 4);
    const mv = ev => {
      const d = (ev.clientX - startX) / (PX * z);
      if (!moved && Math.abs(ev.clientX - startX) < 2) return;
      if (!moved) { o.capture(); moved = true; }
      const maxW = p.w - p.ml - p.mr;
      let props;
      if (kind === 'first') props = { firstLine: Math.round(snap(start.firstLine + d) * 10) / 10 };
      else if (kind === 'left') { const ni = Math.max(0, Math.min(maxW - 36, snap(start.indent + d))); props = { indent: Math.round(ni * 10) / 10, firstLine: Math.round((start.indent + start.firstLine - ni) * 10) / 10 }; }
      else props = { indentR: Math.max(0, Math.min(maxW - 36, Math.round(snap(start.indentR - d) * 10) / 10)) };
      o.onChange(props);
      paint();
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (moved) o.onDone && o.onDone(); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }
  kFirst.addEventListener('pointerdown', e => drag('first', e));
  kLeft.addEventListener('pointerdown', e => drag('left', e));
  kRight.addEventListener('pointerdown', e => drag('right', e));
  // tab stops
  inner.addEventListener('pointerdown', e => {
    if (e.target.closest('.rl-k')) return;
    const tab = e.target.closest('.rl-tab');
    const p = o.getPage(), z = o.getZoom();
    const ir = inner.getBoundingClientRect();
    const toPt = x => (x - ir.left) / (PX * z) - p.ml;
    if (tab) {
      e.preventDefault();
      const t0 = +tab.dataset.t;
      o.capture();
      const mv = ev => { tab.style.left = `${ev.clientX - ir.left}px`; tab.classList.toggle('off', Math.abs(ev.clientY - ir.top - ir.height / 2) > 22); };
      const up = ev => {
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
        let tabs = cur.tabs.filter(x => x !== t0);
        if (Math.abs(ev.clientY - ir.top - ir.height / 2) <= 22) tabs.push(Math.round(Math.max(0, toPt(ev.clientX)) * 10) / 10);
        o.onChange({ tabs: tabs.sort((a, b) => a - b) }); paint(); o.onDone && o.onDone();
      };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      return;
    }
    const v = toPt(e.clientX);
    if (v <= 0 || v >= p.w - p.ml - p.mr) return;
    e.preventDefault();
    o.capture();
    o.onChange({ tabs: [...cur.tabs, Math.round(Math.round(v / (CM / 4)) * (CM / 4) * 10) / 10].sort((a, b) => a - b) });
    paint(); o.onDone && o.onDone();
  });
  return { paint };
}
