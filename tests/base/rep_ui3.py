from rep import apply
R = [
('''      <div><div class="checks" id="c-list"><div class="empty">Lade …</div></div>
        <div class="row" style="margin-top:10px"><button class="btn sm" id="c-def">Standard</button><button class="btn sm" id="c-save">Auswahl speichern</button><button class="btn sm" id="c-ck">Cookies behalten …</button></div>
        <div class="small dim" style="margin-top:6px">Die gespeicherte Auswahl nutzen auch Gesundheitscheck und Automatik.</div></div>
      <div>
        <div class="row"><button class="btn" id="c-an" data-busy>Analysieren</button><button class="btn primary" id="c-cl" data-busy>Bereinigen</button></div>''',
 '''      <div><div class="checks" id="c-list"><div class="empty">${t("Lade …")}</div></div>
        <div class="row" style="margin-top:10px"><button class="btn sm" id="c-def">${t("Standard")}</button><button class="btn sm" id="c-save">${t("Auswahl speichern")}</button><button class="btn sm" id="c-ck">${t("Cookies behalten …")}</button></div>
        <div class="small dim" style="margin-top:6px">${t("Die gespeicherte Auswahl nutzen auch Gesundheitscheck und Automatik.")}</div></div>
      <div>
        <div class="row"><button class="btn" id="c-an" data-busy>${t("Analysieren")}</button><button class="btn primary" id="c-cl" data-busy>${t("Bereinigen")}</button></div>'''),
('''toast("Auswahl gespeichert"); };''', '''toast(t("Auswahl gespeichert")); };'''),
('''    const groups = [...new Set(this.targets.map(t => t.group))];
    $("#c-list").innerHTML = groups.map((g, gi) => {
      const ts = this.targets.filter(t => t.group === g);''',
 '''    const groups = [...new Set(this.targets.map(x => x.group))];
    $("#c-list").innerHTML = groups.map((g, gi) => {
      const ts = this.targets.filter(x => x.group === g);'''),
('''        ts.map(t => `<label class="it"><input type="checkbox" data-id="${esc(t.id)}" data-g="${gi}" data-def="${t.default ? 1 : 0}" ${t.selected ? "checked" : ""}><span class="lbl">${esc(t.label)}${t.admin ? `<span class="tag">Admin</span>` : ""}${t.undo ? `<span class="tag" style="color:var(--blue)">↩</span>` : ""}${t.note ? `<small>${esc(t.note)}</small>` : ""}</span></label>`).join("")}</div>`;''',
 '''        ts.map(x => `<label class="it"><input type="checkbox" data-id="${esc(x.id)}" data-g="${gi}" data-def="${x.default ? 1 : 0}" ${x.selected ? "checked" : ""}><span class="lbl">${esc(x.label)}${x.admin ? `<span class="tag">Admin</span>` : ""}${x.undo ? `<span class="tag" style="color:var(--blue)" title="${esc(t("wiederherstellbar"))}">↩</span>` : ""}${x.note ? `<small>${esc(x.note)}</small>` : ""}</span></label>`).join("")}</div>`;'''),
('''{empty: "Klicke auf „Analysieren“, um zu sehen, was entfernt werden kann.", sort: "size", key: r => r.id});''',
 '''{empty: "Klicke auf „Analysieren“, um zu sehen, was entfernt werden kann.", sort: "size", key: r => r.id});'''),
('''      {k:"status", t:"Status", f: r => { const s = r.status; const c = /Bereinigt|Geleert|Bereit/.test(s) ? "ok" : /Übersprungen|geöffnet|Admin|Fehl/.test(s) ? "warn" : ""; return `<span class="pill ${c}">${esc(s)}</span>`; }},''',
 '''      {k:"status", t:"Status", f: r => { const c = r.state === "ok" ? "ok" : r.state === "warn" ? "warn" : ""; return `<span class="pill ${c}">${esc(r.status)}</span>`; }},'''),
('''tr.title = "Klicken: Dateien anzeigen";''', '''tr.title = t("Klicken: Dateien anzeigen");'''),
('''    const sh = sheet(`${r.group} – ${r.label}`, `<div class="muted small">Die größten Dateien in diesem Bereich (max. 300). Nichts davon ist persönlich wichtig – es sind Zwischenspeicher, die Programme bei Bedarf neu anlegen.</div><div class="scroll" id="dt-body"><div class="prog on"><i></i></div></div>`,''',
 '''    const sh = sheet(`${r.group} – ${r.label}`, `<div class="muted small">${t("Die größten Dateien in diesem Bereich (max. 300). Nichts davon ist persönlich wichtig – es sind Zwischenspeicher, die Programme bei Bedarf neu anlegen.")}</div><div class="scroll" id="dt-body"><div class="prog on"><i></i></div></div>`,'''),
(''': `<div class="empty">Keine Dateien</div>`;''', ''': `<div class="empty">${t("Keine Dateien")}</div>`;'''),
('''    const sh = sheet("Cookies behalten", `<div class="muted small">Auf diesen Seiten bleibst du angemeldet, auch wenn Cookies gelöscht werden. Angehakt = behalten. Gilt für alle Browser.</div>
      <div class="row" style="margin-top:12px"><input type="text" id="ck-add" placeholder="Domain hinzufügen, z. B. google.com" class="grow"><button class="btn" id="ck-addb">Hinzufügen</button></div>''',
 '''    const sh = sheet(t("Cookies behalten"), `<div class="muted small">${t("Auf diesen Seiten bleibst du angemeldet, auch wenn Cookies gelöscht werden. Angehakt = behalten. Gilt für alle Browser.")}</div>
      <div class="row" style="margin-top:12px"><input type="text" id="ck-add" placeholder="${esc(t("Domain hinzufügen, z. B. google.com"))}" class="grow"><button class="btn" id="ck-addb">${t("Hinzufügen")}</button></div>'''),
('''toast(`${keep.length} Domains werden behalten`); close(true);''', '''toast(t("{n} Domains werden behalten", {n: keep.length})); close(true);'''),
('''<span class="small dim">${d.count ? d.count + " Cookies" : "manuell"}</span></label>`).join("") : `<div class="empty">Keine Cookies gefunden (Browser geöffnet?)</div>`;''',
 '''<span class="small dim">${d.count ? t("{n} Cookies", {n: d.count}) : t("manuell")}</span></label>`).join("") : `<div class="empty">${t("Keine Cookies gefunden (Browser geöffnet?)")}</div>`;'''),
('''    $("#c-sum").innerHTML = `<div class="big ${done ? "acc" : ""}">${human(total)}</div><div class="muted">${done ? "freigegeben" : "können entfernt werden"}<br>${fmtInt(files)} Dateien</div>`;''',
 '''    $("#c-sum").innerHTML = `<div class="big ${done ? "acc" : ""}">${human(total)}</div><div class="muted">${t(done ? "freigegeben" : "können entfernt werden")}<br>${t("{n} Dateien", {n: fmtInt(files)})}</div>`;'''),
('''    const ids = this.sel(); if (!ids.length) return toast("Nichts ausgewählt", "warn");
    busy(this.el, true, "Analysiere …");''',
 '''    const ids = this.sel(); if (!ids.length) return toast(t("Nichts ausgewählt"), "warn");
    busy(this.el, true, t("Analysiere …"));'''),
('''    const ids = this.sel(); if (!ids.length) return toast("Nichts ausgewählt", "warn");
    let close = [];''',
 '''    const ids = this.sel(); if (!ids.length) return toast(t("Nichts ausgewählt"), "warn");
    let close = [];'''),
('''      const a = await modal("Programme sind geöffnet", `<b>${esc(names)}</b> läuft gerade. Geöffnete Programme sperren ihre Dateien.<br><br>Soll FaLe Clean sie jetzt schließen? Tabs werden beim nächsten Start normalerweise wiederhergestellt.`,''',
 '''      const a = await modal(t("Programme sind geöffnet"), t("<b>{names}</b> läuft gerade. Geöffnete Programme sperren ihre Dateien.<br><br>Soll FaLe Clean sie jetzt schließen? Tabs werden beim nächsten Start normalerweise wiederhergestellt.", {names: esc(names)}),'''),
('''    busy(this.el, true, "Bereinige …");
    try {
      const rows = await task("clean", {ids, close}, {onProgress: s => busy(this.el, true, s)}).promise;
      this.tbl = table($("#c-tbl"), this.cols(), rows, this.topt()); this.summary(rows, true);
      toast(`${human(rows.reduce((a, r) => a + r.freed, 0))} freigegeben`);''',
 '''    busy(this.el, true, t("Bereinige …"));
    try {
      const rows = await task("clean", {ids, close}, {onProgress: s => busy(this.el, true, s)}).promise;
      this.tbl = table($("#c-tbl"), this.cols(), rows, this.topt()); this.summary(rows, true);
      toast(t("{size} freigegeben", {size: human(rows.reduce((a, r) => a + r.freed, 0))}));'''),
]
apply("/home/claude/FaLeClean/ui.html", R)
