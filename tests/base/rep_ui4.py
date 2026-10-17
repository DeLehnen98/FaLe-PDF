from rep import apply
R = [
('''<span class="tag" style="color:var(--blue)" title="${esc(t("wiederherstellbar"))}">↩</span>''', '''<span class="tag" style="color:var(--blue)">↩</span>'''),
# --- Autostart
('''    el.innerHTML = `<div class="card" id="b-card"><div class="row"><h4 class="grow" style="margin:0">Startzeit</h4><button class="btn sm" id="b-ref">Neu messen</button></div><div id="b-body" class="muted small" style="margin-top:8px">Lese Windows-Ereignisse …</div></div>
      <h3>Autostart-Programme</h3>
      <div class="row"><button class="btn" id="s-ref" data-busy>Aktualisieren</button><span class="grow"></span><span class="status"></span></div>''',
 '''    el.innerHTML = `<div class="card" id="b-card"><div class="row"><h4 class="grow" style="margin:0">${t("Startzeit")}</h4><button class="btn sm" id="b-ref">${t("Neu messen")}</button></div><div id="b-body" class="muted small" style="margin-top:8px">${t("Lese Windows-Ereignisse …")}</div></div>
      <h3>${t("Autostart-Programme")}</h3>
      <div class="row"><button class="btn" id="s-ref" data-busy>${t("Aktualisieren")}</button><span class="grow"></span><span class="status"></span></div>'''),
('''      const up = r.uptime_s, upTxt = up > 86400 ? `${Math.floor(up / 86400)} Tagen` : up > 3600 ? `${Math.floor(up / 3600)} Std.` : `${Math.floor(up / 60)} Min.`;''',
 '''      const up = r.uptime_s, upTxt = up > 86400 ? t("{n} Tagen", {n: Math.floor(up / 86400)}) : up > 3600 ? t("{n} Std.", {n: Math.floor(up / 3600)}) : t("{n} Min.", {n: Math.floor(up / 60)});'''),
('''        b.innerHTML = `Windows speichert die genaue Startzeit in einem geschützten Protokoll. <b>Als Administrator starten</b>, um sie zu sehen.<br><span class="dim">Läuft seit ${upTxt}.</span>` + (INFO.windows && !INFO.admin ? ` <button class="btn sm" data-adm style="margin-left:8px">Als Admin neu starten</button>` : "");''',
 '''        b.innerHTML = t("Windows speichert die genaue Startzeit in einem geschützten Protokoll. <b>Als Administrator starten</b>, um sie zu sehen.") + `<br><span class="dim">${t("Läuft seit {t}.", {t: upTxt})}</span>` + (INFO.windows && !INFO.admin ? ` <button class="btn sm" data-adm style="margin-left:8px">${t("Als Admin neu starten")}</button>` : "");'''),
('''      if (!r.boots.length) { b.innerHTML = `Noch keine Messung vorhanden.` + (r.fast_startup ? ` Bei aktivem <b>Schnellstart</b> misst Windows nur bei einem echten Neustart (Start → Neu starten).` : ""); return; }''',
 '''      if (!r.boots.length) { b.innerHTML = t("Noch keine Messung vorhanden.") + (r.fast_startup ? t(" Bei aktivem <b>Schnellstart</b> misst Windows nur bei einem echten Neustart (Start → Neu starten).") : ""); return; }'''),
('''      const sec = ms => (ms / 1000).toFixed(1).replace(".", ",") + " s";''', '''      const sec = ms => dec(ms / 1000) + " s";'''),
('''      const verdict = last.main < 30000 ? ["ok", "schnell"] : last.main < 60000 ? ["warn", "okay"] : ["bad", "langsam"];''',
 '''      const verdict = last.main < 30000 ? ["ok", t("schnell")] : last.main < 60000 ? ["warn", t("okay")] : ["bad", t("langsam")];'''),
('''          <div><div class="dim small">Letzter Start bis Desktop</div>''', '''          <div><div class="dim small">${t("Letzter Start bis Desktop")}</div>'''),
('''          <div><div class="dim small">Bis alles geladen war</div>''', '''          <div><div class="dim small">${t("Bis alles geladen war")}</div>'''),
('''          <div><div class="dim small">Durchschnitt (${r.boots.length} Starts)</div>''', '''          <div><div class="dim small">${t("Durchschnitt ({n} Starts)", {n: r.boots.length})}</div>'''),
('''          <div class="grow"><div class="bars" title="Letzte Starts (rechts = neuester)">${r.boots.slice().reverse().map(x => `<i style="height:${(x.total / max * 100).toFixed(0)}%" title="${sec(x.total)} · ${new Date(x.time).toLocaleDateString("de-DE")}"></i>`).join("")}</div></div></div>
        ${r.slow.length ? `<div style="margin-top:14px"><div class="small dim" style="margin-bottom:6px">Diese Programme haben den Start laut Windows gebremst:</div>''',
 '''          <div class="grow"><div class="bars" title="${esc(t("Letzte Starts (rechts = neuester)"))}">${r.boots.slice().reverse().map(x => `<i style="height:${(x.total / max * 100).toFixed(0)}%" title="${sec(x.total)} · ${new Date(x.time).toLocaleDateString(LOC)}"></i>`).join("")}</div></div></div>
        ${r.slow.length ? `<div style="margin-top:14px"><div class="small dim" style="margin-bottom:6px">${t("Diese Programme haben den Start laut Windows gebremst:")}</div>'''),
('''        ${r.fast_startup ? `<div class="small dim" style="margin-top:10px">Schnellstart ist aktiv – gemessen wird nur bei einem echten Neustart.</div>` : ""}
        ${r.cached ? `<div class="small dim" style="margin-top:4px">Stand der letzten Messung mit Admin-Rechten (${fmtDate(r.cache_time)}).</div>` : ""}`;''',
 '''        ${r.fast_startup ? `<div class="small dim" style="margin-top:10px">${t("Schnellstart ist aktiv – gemessen wird nur bei einem echten Neustart.")}</div>` : ""}
        ${r.cached ? `<div class="small dim" style="margin-top:4px">${t("Stand der letzten Messung mit Admin-Rechten ({date}).", {date: fmtDate(r.cache_time)})}</div>` : ""}`;'''),
('''      $(".status", this.el).textContent = `${on} von ${rows.length} aktiv`;''', '''      $(".status", this.el).textContent = t("{on} von {n} aktiv", {on, n: rows.length});'''),
('''${r.admin && !INFO.admin ? "disabled title='Admin-Rechte nötig'" : ""}''', '''${r.admin && !INFO.admin ? `disabled title="${esc(t("Admin-Rechte nötig"))}"` : ""}'''),
('''title="Laut Windows hat dieses Programm den Start um bis zu so viel verlangsamt">''', '''title="${esc(t("Laut Windows hat dieses Programm den Start um bis zu so viel verlangsamt"))}">'''),
('''      {k:"x", t:"", cls:"r", f: () => `<button class="btn sm op">Öffnen</button>`},
      ], rows, {key: r => r.key,''', '''      {k:"x", t:"", cls:"r", f: () => `<button class="btn sm op">${t("Öffnen")}</button>`},
      ], rows, {key: r => r.key,'''),
('''              if (res.denied.length) { e.target.checked = !e.target.checked; toast("Keine Berechtigung – als Administrator starten", "warn"); }
              else { r.enabled = e.target.checked; toast(`${r.name} ${r.enabled ? "aktiviert" : "deaktiviert"}`); P.health.ran = false; }''',
 '''              if (res.denied.length) { e.target.checked = !e.target.checked; toast(t("Keine Berechtigung – als Administrator starten"), "warn"); }
              else { r.enabled = e.target.checked; toast(t(r.enabled ? "{name} aktiviert" : "{name} deaktiviert", {name: r.name})); P.health.ran = false; }'''),
# --- Leistung
('''    el.innerHTML = `<div class="note">Schlafende Programme reagieren nicht, bis du sie aufweckst – Windows zeigt dann evtl. „Keine Rückmeldung“. Systemprozesse sind geschützt und werden nicht angezeigt.</div>
      <div class="row"><button class="btn" id="f-ref" data-busy>Aktualisieren</button>
        <button class="btn primary" id="f-sleep" disabled>Schlafen legen</button><button class="btn" id="f-wake" disabled>Aufwecken</button><button class="btn danger" id="f-kill" disabled>Beenden</button>
        <span class="grow"></span><button class="btn" id="f-wakeall">Alle aufwecken</button></div>
      <div class="prog"><i></i></div><div class="status"></div><div id="f-tbl"></div>
      <h3>Energiesparplan</h3>
      <div class="card row"><select id="f-plan" class="grow" style="max-width:360px"></select><button class="btn" id="f-plan-set">Aktivieren</button><button class="btn" id="f-ult">„Ultimative Leistung“ hinzufügen</button></div>`;''',
 '''    el.innerHTML = `<div class="note">${t("Schlafende Programme reagieren nicht, bis du sie aufweckst – Windows zeigt dann evtl. „Keine Rückmeldung“. Systemprozesse sind geschützt und werden nicht angezeigt.")}</div>
      <div class="row"><button class="btn" id="f-ref" data-busy>${t("Aktualisieren")}</button>
        <button class="btn primary" id="f-sleep" disabled>${t("Schlafen legen")}</button><button class="btn" id="f-wake" disabled>${t("Aufwecken")}</button><button class="btn danger" id="f-kill" disabled>${t("Beenden")}</button>
        <span class="grow"></span><button class="btn" id="f-wakeall">${t("Alle aufwecken")}</button></div>
      <div class="prog"><i></i></div><div class="status"></div><div id="f-tbl"></div>
      <h3>${t("Energiesparplan")}</h3>
      <div class="card row"><select id="f-plan" class="grow" style="max-width:360px"></select><button class="btn" id="f-plan-set">${t("Aktivieren")}</button><button class="btn" id="f-ult">${t("„Ultimative Leistung“ hinzufügen")}</button></div>`;'''),
('''      if (a === "kill" && !await confirmBox("Programme beenden?", `${esc(names.join(", "))} wird beendet. Ungespeicherte Daten gehen verloren.`, "Beenden", "danger")) return;
      try { const n = await call("perf_action", {names, action: a}); toast(`${n} Prozesse ${a === "sleep" ? "schlafen gelegt" : a === "wake" ? "aufgeweckt" : "beendet"}`); this.t.clear(); this.load(); } catch (e) { err(e); }''',
 '''      if (a === "kill" && !await confirmBox(t("Programme beenden?"), t("{names} wird beendet. Ungespeicherte Daten gehen verloren.", {names: esc(names.join(", "))}), "Beenden", "danger")) return;
      try { const n = await call("perf_action", {names, action: a}); toast(t(a === "sleep" ? "{n} Prozesse schlafen gelegt" : a === "wake" ? "{n} Prozesse aufgeweckt" : "{n} Prozesse beendet", {n})); this.t.clear(); this.load(); } catch (e) { err(e); }'''),
('''toast(`${n || 0} Prozesse aufgeweckt`); this.load(); };''', '''toast(t("{n} Prozesse aufgeweckt", {n: n || 0})); this.load(); };'''),
('''toast(ok ? "Energiesparplan aktiviert" : "Fehlgeschlagen", ok ? "" : "err"); this.plans(); };''', '''toast(t(ok ? "Energiesparplan aktiviert" : "Fehlgeschlagen"), ok ? "" : "err"); this.plans(); };'''),
('''toast(m || "Hinzugefügt"); this.plans(); };''', '''toast(m || t("Hinzugefügt")); this.plans(); };'''),
('''${esc(p.name)}${p.active ? " (aktiv)" : ""}</option>`).join("") : `<option>Nicht verfügbar</option>`;''', '''${esc(p.name)}${p.active ? t(" (aktiv)") : ""}</option>`).join("") : `<option>${t("Nicht verfügbar")}</option>`;'''),
('''    busy(this.el, true, "Messe CPU- und RAM-Verbrauch …");''', '''    busy(this.el, true, t("Messe CPU- und RAM-Verbrauch …"));'''),
('''        {k:"cpu", t:"CPU", cls:"r", f: r => r.cpu.toFixed(1).replace(".", ",") + " %"},
        {k:"sleeping", t:"Status", sv: r => r.sleeping ? 1 : 0, f: r => r.sleeping ? `<span class="pill blue">schläft</span>` : `<span class="pill ok">aktiv</span>`},''',
 '''        {k:"cpu", t:"CPU", cls:"r", f: r => dec(r.cpu) + " %"},
        {k:"sleeping", t:"Status", sv: r => r.sleeping ? 1 : 0, f: r => r.sleeping ? `<span class="pill blue">${t("schläft")}</span>` : `<span class="pill ok">${t("aktiv")}</span>`},'''),
('''      busy(this.el, false, `${rows.length} Programme · ${human(rows.reduce((a, r) => a + r.mem, 0))} RAM`);''',
 '''      busy(this.el, false, t("{n} Programme · {size} RAM", {n: rows.length, size: human(rows.reduce((a, r) => a + r.mem, 0))}));'''),
# --- Software-Updater
('''    el.innerHTML = `<div class="row"><button class="btn" id="u-scan" data-busy>Nach Updates suchen</button>
        <button class="btn primary" id="u-sel" data-busy disabled>Ausgewählte aktualisieren</button><button class="btn" id="u-all" data-busy disabled>Alle aktualisieren</button>
        <span class="grow"></span><button class="btn" id="u-drv">Treiber-Updates (Windows Update)</button></div>''',
 '''    el.innerHTML = `<div class="row"><button class="btn" id="u-scan" data-busy>${t("Nach Updates suchen")}</button>
        <button class="btn primary" id="u-sel" data-busy disabled>${t("Ausgewählte aktualisieren")}</button><button class="btn" id="u-all" data-busy disabled>${t("Alle aktualisieren")}</button>
        <span class="grow"></span><button class="btn" id="u-drv">${t("Treiber-Updates (Windows Update)")}</button></div>'''),
('''.then(() => toast("Windows Update wird geöffnet – Treiber findest du unter „Optionale Updates“")).catch(err);''', '''.then(() => toast(t("Windows Update wird geöffnet – Treiber findest du unter „Optionale Updates“"))).catch(err);'''),
('''else if (!INFO.winget) busy(this.el, false, "winget nicht gefunden – installiere den „App-Installer“ aus dem Microsoft Store."); },''',
 '''else if (!INFO.winget) busy(this.el, false, t("winget nicht gefunden – installiere den „App-Installer“ aus dem Microsoft Store.")); },'''),
('''    this.ran = true; busy(this.el, true, "Suche nach Updates …");''', '''    this.ran = true; busy(this.el, true, t("Suche nach Updates …"));'''),
('''      busy(this.el, false, rows.length ? `${rows.length} Updates verfügbar` : "Alles aktuell");''', '''      busy(this.el, false, rows.length ? t("{n} Updates verfügbar", {n: rows.length}) : t("Alles aktuell"));'''),
('''    busy(this.el, true, "Installiere Updates … (Programme können sich kurz schließen)");
    try { await task("updates_install", {ids}, {onLine: l => { lg.textContent += l + "\\n"; lg.scrollTop = 1e9; }}).promise; toast("Updates abgeschlossen"); }''',
 '''    busy(this.el, true, t("Installiere Updates … (Programme können sich kurz schließen)"));
    try { await task("updates_install", {ids}, {onLine: l => { lg.textContent += l + "\\n"; lg.scrollTop = 1e9; }}).promise; toast(t("Updates abgeschlossen")); }'''),
# --- Programme
('''    el.innerHTML = `<div class="row"><input type="text" id="a-q" placeholder="Suchen …" style="width:300px"><button class="btn" id="a-ref" data-busy>Aktualisieren</button><span class="grow"></span><span class="status"></span></div>''',
 '''    el.innerHTML = `<div class="row"><input type="text" id="a-q" placeholder="${esc(t("Suchen …"))}" style="width:300px"><button class="btn" id="a-ref" data-busy>${t("Aktualisieren")}</button><span class="grow"></span><span class="status"></span></div>'''),
('''    busy(this.el, false, `${(this.rows || []).length} Programme · ${human((this.rows || []).reduce((a, r) => a + r.size, 0))}`);''',
 '''    busy(this.el, false, t("{n} Programme · {size}", {n: (this.rows || []).length, size: human((this.rows || []).reduce((a, r) => a + r.size, 0))}));'''),
('''      {k:"date", t:"Installiert", sv: r => r.date.split(".").reverse().join("")},
      {k:"x", t:"", cls:"r", f: () => `<button class="btn sm danger un">Deinstallieren</button>`},''',
 '''      {k:"date", t:"Installiert", sv: r => r.date.split(".").reverse().join(""), f: r => esc(fmtDMY(r.date))},
      {k:"x", t:"", cls:"r", f: () => `<button class="btn sm danger un">${t("Deinstallieren")}</button>`},'''),
('''        if (!await confirmBox("Deinstallieren?", `<b>${esc(r.name)}</b> wird mit seinem eigenen Deinstallationsprogramm entfernt.`, "Deinstallieren", "danger")) return;
        const ok = await call("uninstall", {key: r.key}).catch(err);
        toast(ok ? "Deinstallation gestartet – folge dem Assistenten" : "Konnte nicht gestartet werden", ok ? "" : "err");''',
 '''        if (!await confirmBox(t("Deinstallieren?"), t("<b>{name}</b> wird mit seinem eigenen Deinstallationsprogramm entfernt.", {name: esc(r.name)}), "Deinstallieren", "danger")) return;
        const ok = await call("uninstall", {key: r.key}).catch(err);
        toast(t(ok ? "Deinstallation gestartet – folge dem Assistenten" : "Konnte nicht gestartet werden"), ok ? "" : "err");'''),
('''    b.innerHTML = `<div class="grow"><b>${esc(r.name)}</b> wird deinstalliert. Wenn der Assistent fertig ist, findet FaLe Clean übrig gebliebene Ordner und Registry-Einträge.</div><button class="btn primary sm" id="a-lo">Reste suchen</button><button class="btn sm" id="a-lox">✕</button>`;''',
 '''    b.innerHTML = `<div class="grow">${t("<b>{name}</b> wird deinstalliert. Wenn der Assistent fertig ist, findet FaLe Clean übrig gebliebene Ordner und Registry-Einträge.", {name: esc(r.name)})}</div><button class="btn primary sm" id="a-lo">${t("Reste suchen")}</button><button class="btn sm" id="a-lox">✕</button>`;'''),
('''    const sh = sheet(`Reste von ${r.name}`, `<div id="lo-body"><div class="prog on"><i></i></div><div class="status small muted">Suche …</div></div>`,''',
 '''    const sh = sheet(t("Reste von {name}", {name: r.name}), `<div id="lo-body"><div class="prog on"><i></i></div><div class="status small muted">${t("Suche …")}</div></div>`,'''),
('''        try { const res = await call("leftovers_remove", {items, label: r.name}); toast(`${res.ok} Reste entfernt – ${res.failed.length ? res.failed.length + " fehlgeschlagen · " : ""}7 Tage unter „Rückgängig“ wiederherstellbar`); close(true);''',
 '''        try { const res = await call("leftovers_remove", {items, label: r.name}); toast(t("{n} Reste entfernt", {n: res.ok}) + " – " + (res.failed.length ? t("{n} fehlgeschlagen", {n: res.failed.length}) + " · " : "") + t("7 Tage unter „Rückgängig“ wiederherstellbar")); close(true);'''),
('''        body.innerHTML = still ? `<div class="empty">${esc(r.name)} ist noch installiert. Schließe zuerst den Deinstallations-Assistenten.</div>` : `<div class="empty">Keine Reste gefunden – sauber deinstalliert. 🎉</div>`;''',
 '''        body.innerHTML = still ? `<div class="empty">${t("{name} ist noch installiert. Schließe zuerst den Deinstallations-Assistenten.", {name: esc(r.name)})}</div>` : `<div class="empty">${t("Keine Reste gefunden – sauber deinstalliert. 🎉")}</div>`;'''),
('''      body.innerHTML = `<div class="muted small">Nur Einträge, die genau nach dem Programm benannt sind. Ordner landen 7 Tage in der Quarantäne, Registry-Schlüssel werden vorher gesichert.</div>''',
 '''      body.innerHTML = `<div class="muted small">${t("Nur Einträge, die genau nach dem Programm benannt sind. Ordner landen 7 Tage in der Quarantäne, Registry-Schlüssel werden vorher gesichert.")}</div>'''),
]
apply("/home/claude/FaLeClean/ui.html", R)
