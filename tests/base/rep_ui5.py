from rep import apply
R = [
# --- Ordnerwahl
('''  el.innerHTML = `<div class="row"><input type="text" id="${id}" class="grow" placeholder="Ordner oder Laufwerk, z. B. C:\\\\Users\\\\Name" style="min-width:260px">
    <button class="btn" data-pick>Durchsuchen …</button></div><div class="row" style="margin-top:8px" data-chips></div>`;''',
 '''  el.innerHTML = `<div class="row"><input type="text" id="${id}" class="grow" placeholder="${esc(t("Ordner oder Laufwerk, z. B. C:\\\\Users\\\\Name"))}" style="min-width:260px">
    <button class="btn" data-pick>${t("Durchsuchen …")}</button></div><div class="row" style="margin-top:8px" data-chips></div>`;'''),
('''...dr.map(d => ({name: d.path + " · " + human(d.free) + " frei", path: d.path}))''', '''...dr.map(d => ({name: d.path + " · " + t("{size} frei", {size: human(d.free)}), path: d.path}))'''),
# --- Speicheranalyse
('''      <div class="row" style="margin-top:12px"><button class="btn primary" id="d-go" data-busy>Analysieren</button><button class="btn" id="d-stop" disabled>Abbrechen</button></div>''',
 '''      <div class="row" style="margin-top:12px"><button class="btn primary" id="d-go" data-busy>${t("Analysieren")}</button><button class="btn" id="d-stop" disabled>${t("Abbrechen")}</button></div>'''),
('''    busy(this.el, true, "Scanne …"); $("#d-stop").disabled = false;''', '''    busy(this.el, true, t("Scanne …")); $("#d-stop").disabled = false;'''),
('''<div class="muted">${fmtInt(r.count)} Dateien in<br>${esc(path)}${r.cancelled ? " (abgebrochen)" : ""}</div></div>''',
 '''<div class="muted">${t("{n} Dateien in", {n: fmtInt(r.count)})}<br>${esc(path)}${r.cancelled ? t(" (abgebrochen)") : ""}</div></div>'''),
('''        <div class="card"><h4>Ordner</h4>''', '''        <div class="card"><h4>${t("Ordner")}</h4>'''),
('''.join("") || `<div class="dim">Leer</div>`}</div></div>
        <div class="card"><h4>Dateitypen</h4>''', '''.join("") || `<div class="dim">${t("Leer")}</div>`}</div></div>
        <div class="card"><h4>${t("Dateitypen")}</h4>'''),
('''      </div><h3>Größte Dateien</h3><div id="d-big"></div>`;''', '''      </div><h3>${t("Größte Dateien")}</h3><div id="d-big"></div>`;'''),
('''      {k:"x", t:"", cls:"r", f: () => `<button class="btn sm op">Im Explorer zeigen</button>`},''', '''      {k:"x", t:"", cls:"r", f: () => `<button class="btn sm op">${t("Im Explorer zeigen")}</button>`},'''),
# --- Duplikate
('''      <div class="row" style="margin-top:12px"><span class="muted">Mindestgröße</span>''', '''      <div class="row" style="margin-top:12px"><span class="muted">${t("Mindestgröße")}</span>'''),
('''      <button class="btn primary" id="x-go" data-busy>Suchen</button><button class="btn" id="x-stop" disabled>Abbrechen</button></div>
      <div class="small dim" style="margin-top:8px">Systemordner (Windows, Programme, AppData …) werden übersprungen.</div>''',
 '''      <button class="btn primary" id="x-go" data-busy>${t("Suchen")}</button><button class="btn" id="x-stop" disabled>${t("Abbrechen")}</button></div>
      <div class="small dim" style="margin-top:8px">${t("Systemordner (Windows, Programme, AppData …) werden übersprungen.")}</div>'''),
('''<button class="btn" id="x-auto">Alle außer der ältesten markieren</button><button class="btn" id="x-none">Markierung aufheben</button><span class="grow"></span><span id="x-info" class="muted"></span><button class="btn danger" id="x-del" disabled>In den Papierkorb</button></div>''',
 '''<button class="btn" id="x-auto">${t("Alle außer der ältesten markieren")}</button><button class="btn" id="x-none">${t("Markierung aufheben")}</button><span class="grow"></span><span id="x-info" class="muted"></span><button class="btn danger" id="x-del" disabled>${t("In den Papierkorb")}</button></div>'''),
('''    busy(this.el, true, "Durchsuche …"); $("#x-stop").disabled = false;''', '''    busy(this.el, true, t("Durchsuche …")); $("#x-stop").disabled = false;'''),
('''    busy(this.el, false, g.length ? `${g.length} Gruppen · ${human(waste)} doppelt belegt` : "Keine Duplikate gefunden");''',
 '''    busy(this.el, false, g.length ? t("{n} Gruppen · {size} doppelt belegt", {n: g.length, size: human(waste)}) : t("Keine Duplikate gefunden"));'''),
('''${i === 0 ? `<span class="pill ok">älteste</span>` : ""}<span class="small dim">${new Date(f.mtime * 1000).toLocaleDateString("de-DE")}</span></label>`''',
 '''${i === 0 ? `<span class="pill ok">${t("älteste")}</span>` : ""}<span class="small dim">${new Date(f.mtime * 1000).toLocaleDateString(LOC)}</span></label>`'''),
('''    $("#x-info").textContent = c.length ? `${c.length} markiert · ${human(c.reduce((a, x) => a + this.groups[+x.dataset.g].size, 0))}` : "";''',
 '''    $("#x-info").textContent = c.length ? t("{n} markiert · {size}", {n: c.length, size: human(c.reduce((a, x) => a + this.groups[+x.dataset.g].size, 0))}) : "";'''),
('''return toast("Behalte mindestens eine Datei pro Gruppe.", "warn");
    if (!await confirmBox("In den Papierkorb verschieben?", `${c.length} Dateien werden in den Papierkorb verschoben (wiederherstellbar).`, "Verschieben", "danger")) return;''',
 '''return toast(t("Behalte mindestens eine Datei pro Gruppe."), "warn");
    if (!await confirmBox(t("In den Papierkorb verschieben?"), t("{n} Dateien werden in den Papierkorb verschoben (wiederherstellbar).", {n: c.length}), "Verschieben", "danger")) return;'''),
('''      toast(`${r.ok} Dateien verschoben` + (r.failed.length ? ` · ${r.failed.length} fehlgeschlagen` : ""), r.failed.length ? "warn" : "");''',
 '''      toast(t("{n} Dateien verschoben", {n: r.ok}) + (r.failed.length ? t(" · {n} fehlgeschlagen", {n: r.failed.length}) : ""), r.failed.length ? "warn" : "");'''),
# --- Automatik
('''      <div class="card"><h4>Geplante Reinigung <span id="o-sp" class="pill">–</span></h4><div class="muted small">Läuft über die Windows-Aufgabenplanung – auch wenn FaLe Clean geschlossen ist. Nutzt deine gespeicherte Auswahl.</div>
        <div class="form">
          <span>Aktiv</span><label class="sw"><input type="checkbox" id="o-en"><span></span></label>
          <span>Häufigkeit</span><select id="o-freq"><option value="daily">Täglich</option><option value="weekly">Wöchentlich</option><option value="monthly">Monatlich (am 1.)</option></select>
          <span>Wochentag</span><select id="o-day"><option value="MON">Montag</option><option value="TUE">Dienstag</option><option value="WED">Mittwoch</option><option value="THU">Donnerstag</option><option value="FRI">Freitag</option><option value="SAT">Samstag</option><option value="SUN">Sonntag</option></select>
          <span>Uhrzeit</span><input type="time" id="o-time" style="width:130px">
        </div></div>
      <div class="card"><h4>Smart-Monitor <span id="o-mp" class="pill">–</span></h4><div class="muted small">Kleiner Hintergrundprozess, der Browser nach dem Schließen reinigt und auf Datenmüll achtet.</div>
        <div class="form">
          <span>Browser beim Schließen reinigen</span><label class="sw"><input type="checkbox" id="o-bc"><span></span></label>
          <span>Was?</span><div class="row"><label class="row" style="gap:6px"><input type="checkbox" data-bi="cache">Cache</label><label class="row" style="gap:6px"><input type="checkbox" data-bi="cookies">Cookies</label><label class="row" style="gap:6px"><input type="checkbox" data-bi="history">Verlauf</label></div>
          <span>Bei viel Datenmüll reinigen</span><label class="sw"><input type="checkbox" id="o-je"><span></span></label>
          <span>Schwelle</span><div class="row"><input type="number" id="o-jt" min="100" step="100" style="width:110px"><span class="muted">MB</span></div>
          <span>Mit Windows starten</span><label class="sw"><input type="checkbox" id="o-as"><span></span></label>
        </div></div></div>
      <div class="row" style="margin-top:16px"><button class="btn primary" id="o-save">Speichern & anwenden</button><button class="btn" id="o-now" data-busy>Reinigung jetzt ausführen</button><span class="status"></span></div>
      <div class="prog"><i></i></div>
      <h3>Protokoll</h3><div class="console" id="o-log"></div>`;''',
 '''      <div class="card"><h4>${t("Geplante Reinigung")} <span id="o-sp" class="pill">–</span></h4><div class="muted small">${t("Läuft über die Windows-Aufgabenplanung – auch wenn FaLe Clean geschlossen ist. Nutzt deine gespeicherte Auswahl.")}</div>
        <div class="form">
          <span>${t("Aktiv")}</span><label class="sw"><input type="checkbox" id="o-en"><span></span></label>
          <span>${t("Häufigkeit")}</span><select id="o-freq"><option value="daily">${t("Täglich")}</option><option value="weekly">${t("Wöchentlich")}</option><option value="monthly">${t("Monatlich (am 1.)")}</option></select>
          <span>${t("Wochentag")}</span><select id="o-day"><option value="MON">${t("Montag")}</option><option value="TUE">${t("Dienstag")}</option><option value="WED">${t("Mittwoch")}</option><option value="THU">${t("Donnerstag")}</option><option value="FRI">${t("Freitag")}</option><option value="SAT">${t("Samstag")}</option><option value="SUN">${t("Sonntag")}</option></select>
          <span>${t("Uhrzeit")}</span><input type="time" id="o-time" style="width:130px">
        </div></div>
      <div class="card"><h4>${t("Smart-Monitor")} <span id="o-mp" class="pill">–</span></h4><div class="muted small">${t("Kleiner Hintergrundprozess, der Browser nach dem Schließen reinigt und auf Datenmüll achtet.")}</div>
        <div class="form">
          <span>${t("Browser beim Schließen reinigen")}</span><label class="sw"><input type="checkbox" id="o-bc"><span></span></label>
          <span>${t("Was?")}</span><div class="row"><label class="row" style="gap:6px"><input type="checkbox" data-bi="cache">Cache</label><label class="row" style="gap:6px"><input type="checkbox" data-bi="cookies">Cookies</label><label class="row" style="gap:6px"><input type="checkbox" data-bi="history">${t("Verlauf")}</label></div>
          <span>${t("Bei viel Datenmüll reinigen")}</span><label class="sw"><input type="checkbox" id="o-je"><span></span></label>
          <span>${t("Schwelle")}</span><div class="row"><input type="number" id="o-jt" min="100" step="100" style="width:110px"><span class="muted">MB</span></div>
          <span>${t("Mit Windows starten")}</span><label class="sw"><input type="checkbox" id="o-as"><span></span></label>
        </div></div></div>
      <div class="row" style="margin-top:16px"><button class="btn primary" id="o-save">${t("Speichern & anwenden")}</button><button class="btn" id="o-now" data-busy>${t("Reinigung jetzt ausführen")}</button><span class="status"></span></div>
      <div class="prog"><i></i></div>
      <h3>${t("Protokoll")}</h3><div class="console" id="o-log"></div>`;'''),
('''    $("#o-now").onclick = async () => { busy(this.el, true, "Reinige …"); try { const f = await task("run_auto_clean", {}, {onProgress: s => busy(this.el, true, s)}).promise; toast(`${human(f)} freigegeben`); }''',
 '''    $("#o-now").onclick = async () => { busy(this.el, true, t("Reinige …")); try { const f = await task("run_auto_clean", {}, {onProgress: s => busy(this.el, true, s)}).promise; toast(t("{size} freigegeben", {size: human(f)})); }'''),
('''$("#o-sp").textContent = a.schedule_active ? "eingerichtet" : "aus";''', '''$("#o-sp").textContent = t(a.schedule_active ? "eingerichtet" : "aus");'''),
('''$("#o-mp").textContent = a.monitor_running ? "läuft" : "gestoppt";''', '''$("#o-mp").textContent = t(a.monitor_running ? "läuft" : "gestoppt");'''),
('''el.textContent = l.length ? l.join("\\n") : "Noch keine Einträge."; el.scrollTop = 1e9; },''', '''el.textContent = l.length ? l.join("\\n") : t("Noch keine Einträge."); el.scrollTop = 1e9; },'''),
('''      this.pills(r); toast(r.ok ? "Gespeichert" : "Aufgabenplanung: " + r.message, r.ok ? "" : "err");''', '''      this.pills(r); toast(r.ok ? t("Gespeichert") : t("Aufgabenplanung: {msg}", {msg: r.message}), r.ok ? "" : "err");'''),
]
apply("/home/claude/FaLeClean/ui.html", R)
