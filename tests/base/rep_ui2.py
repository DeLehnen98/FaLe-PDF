from rep import apply
R = [
# --- zentrale Helfer: Spaltentitel, leere Tabellen, Modal-Buttons
('''${esc(c.t)}</th>''', '''${esc(c.t ? t(c.t) : "")}</th>'''),
('''${esc(opt.empty || t("Keine Einträge"))}''', '''${esc(t(opt.empty || "Keine Einträge"))}'''),
('''      const el = document.createElement("button"); el.className = "btn " + (b.cls || ""); el.textContent = b.text;
      el.onclick = () => { ov.remove(); res(b.value); }; $(".acts", ov).appendChild(el);''',
 '''      const el = document.createElement("button"); el.className = "btn " + (b.cls || ""); el.textContent = t(b.text);
      el.onclick = () => { ov.remove(); res(b.value); }; $(".acts", ov).appendChild(el);'''),
('''  buttons.forEach(b => { const el = document.createElement("button"); el.className = "btn " + (b.cls || ""); el.textContent = b.text;''',
 '''  buttons.forEach(b => { const el = document.createElement("button"); el.className = "btn " + (b.cls || ""); el.textContent = t(b.text);'''),
('''modal(title, html, [{text:t("Abbrechen"), value:false}, {text:ok, value:true, cls}]);''',
 '''modal(title, html, [{text:"Abbrechen", value:false}, {text:ok, value:true, cls}]);'''),

# --- Gesundheitscheck
('''          <div class="ring-val"><b id="h-score">–</b><span>von 100</span></div></div>
        <div class="grow"><h2 id="h-title">Prüfe deinen PC …</h2><p class="muted" id="h-text">Speicher, Datenmüll, Autostart und Arbeitsspeicher werden analysiert.</p>
          <div class="row"><button class="btn primary big" id="h-fix" data-busy disabled>Jetzt optimieren</button><button class="btn" id="h-run" data-busy>Erneut prüfen</button></div>''',
 '''          <div class="ring-val"><b id="h-score">–</b><span>${t("von 100")}</span></div></div>
        <div class="grow"><h2 id="h-title">${t("Prüfe deinen PC …")}</h2><p class="muted" id="h-text">${t("Speicher, Datenmüll, Autostart und Arbeitsspeicher werden analysiert.")}</p>
          <div class="row"><button class="btn primary big" id="h-fix" data-busy disabled>${t("Jetzt optimieren")}</button><button class="btn" id="h-run" data-busy>${t("Erneut prüfen")}</button></div>'''),
('''      <h3>PC-Zustand</h3><div class="stats" id="h-sys"><div class="card stat"><div class="k">Akku, Laufwerke, Virenschutz</div><div class="d">wird geprüft …</div></div></div>
      <h3>Empfehlungen</h3><div class="recs" id="h-recs"><div class="dim">Noch keine Daten.</div></div>`;''',
 '''      <h3>${t("PC-Zustand")}</h3><div class="stats" id="h-sys"><div class="card stat"><div class="k">${t("Akku, Laufwerke, Virenschutz")}</div><div class="d">${t("wird geprüft …")}</div></div></div>
      <h3>${t("Empfehlungen")}</h3><div class="recs" id="h-recs"><div class="dim">${t("Noch keine Daten.")}</div></div>`;'''),
('''    this.ran = true; busy(this.el, true, "Analysiere …");''', '''    this.ran = true; busy(this.el, true, t("Analysiere …"));'''),
('''    $("#h-title").textContent = sc >= 80 ? "Dein PC ist in gutem Zustand" : sc >= 55 ? "Da geht noch was" : "Dein PC braucht Pflege";''',
 '''    $("#h-title").textContent = t(sc >= 80 ? "Dein PC ist in gutem Zustand" : sc >= 55 ? "Da geht noch was" : "Dein PC braucht Pflege");'''),
('''    $("#h-text").textContent = (nrec ? `${nrec} Punkte können verbessert werden.` : "Alles im grünen Bereich.") +
      (st.freed_total ? ` Bisher mit FaLe Clean freigegeben: ${human(st.freed_total)} in ${st.cleanings} Reinigungen.` : "");''',
 '''    $("#h-text").textContent = (nrec === 1 ? t("1 Punkt kann verbessert werden.") : nrec ? t("{n} Punkte können verbessert werden.", {n: nrec}) : t("Alles im grünen Bereich.")) +
      (st.freed_total ? t(" Bisher mit FaLe Clean freigegeben: {size} in {n} Reinigungen.", {size: human(st.freed_total), n: st.cleanings}) : "");'''),
('''      ["Speicher " + esc(h.disk.drive), human(h.disk.free) + " frei", `von ${human(h.disk.total)}`, usedPct],
      ["Arbeitsspeicher", Math.round(h.ram.percent) + " %", `belegt von ${human(h.ram.total)}`, h.ram.percent],
      ["Datenmüll", human(h.junk.size), `${fmtInt(h.junk.files)} Dateien`, null],
      ["Autostart", `${h.startup.enabled}`, `von ${h.startup.total} Einträgen aktiv`, null],''',
 '''      [t("Speicher {drive}", {drive: esc(h.disk.drive)}), t("{size} frei", {size: human(h.disk.free)}), t("von {size}", {size: human(h.disk.total)}), usedPct],
      [t("Arbeitsspeicher"), Math.round(h.ram.percent) + " %", t("belegt von {size}", {size: human(h.ram.total)}), h.ram.percent],
      [t("Datenmüll"), human(h.junk.size), t("{n} Dateien", {n: fmtInt(h.junk.files)}), null],
      [t("Autostart"), `${h.startup.enabled}`, t("von {n} Einträgen aktiv", {n: h.startup.total}), null],'''),
('''      r.page === "admin" ? (INFO.windows ? `<button class="btn sm" data-adm>Neu starten als Admin</button>` : "") : map[r.page] ? `<button class="btn sm" data-go="${map[r.page]}">Öffnen</button>` : ""}</div>`;''',
 '''      r.page === "admin" ? (INFO.windows ? `<button class="btn sm" data-adm>${t("Neu starten als Admin")}</button>` : "") : map[r.page] ? `<button class="btn sm" data-go="${map[r.page]}">${t("Öffnen")}</button>` : ""}</div>`;'''),
('''      : `<div class="rec good"><div class="ico">✓</div><div>Keine Probleme gefunden.</div></div>`;''',
 '''      : `<div class="rec good"><div class="ico">✓</div><div>${t("Keine Probleme gefunden.")}</div></div>`;'''),
('''        div.innerHTML = recHtml({page: "update", text: `${rows.length} Programme sind veraltet (z. B. ${rows.slice(0, 3).map(r => r.name).join(", ")}). Veraltete Software ist eines der häufigsten Einfallstore für Schadsoftware.`});''',
 '''        div.innerHTML = recHtml({page: "update", text: t("{n} Programme sind veraltet (z. B. {names}). Veraltete Software ist eines der häufigsten Einfallstore für Schadsoftware.", {n: rows.length, names: rows.slice(0, 3).map(r => r.name).join(", ")})});'''),
('''    const badDisk = disks.find(d => d.health !== "Gesund");''', '''    const badDisk = disks.find(d => d.state !== "ok");'''),
('''      b ? card("Akku-Gesundheit", b.health + " %", `${(b.full_mwh / 1000).toFixed(1).replace(".", ",")} von ${(b.design_mwh / 1000).toFixed(1).replace(".", ",")} Wh ursprünglich` + (b.cycles ? ` · ${b.cycles} Ladezyklen` : ""), b.health < 70 ? "bad" : b.health < 80 ? "warn" : "acc")
        : card("Akku", "–", "Kein Akku gefunden (Desktop-PC)"),
      disks.length ? card("Laufwerk" + (disks.length > 1 ? "e" : ""), badDisk ? esc(badDisk.health) : "Gesund", disks.map(d => `${esc(d.name)} · ${esc([d.bus, d.media].filter(Boolean).join(" "))} · ${human(d.size)}`).join("<br>"), badDisk ? "bad" : "acc")
        : card("Laufwerke", "–", "Zustand nicht lesbar"),
      card("Virenschutz", av.length ? "Aktiv" : "Kein aktiver Schutz", (av.length ? av.map(a => esc(a.name) + (a.uptodate ? "" : " (veraltet)")).join(", ") : "Windows-Sicherheitscenter meldet nichts") + (fw ? `<br>Firewall: ${fwOff.length ? "aus für " + esc(fwOff.join(", ")) : "an"}` : ""), av.length && !fwOff.length ? "acc" : "warn"),
      card("Neustart", y.reboot.length ? "Ausstehend" : "Nicht nötig", y.reboot.length ? "für " + esc(y.reboot.join(" & ")) : "Keine Updates warten auf einen Neustart", y.reboot.length ? "warn" : "acc"),''',
 '''      b ? card(t("Akku-Gesundheit"), b.health + " %", t("{now} von {orig} Wh ursprünglich", {now: dec(b.full_mwh / 1000), orig: dec(b.design_mwh / 1000)}) + (b.cycles ? t(" · {n} Ladezyklen", {n: b.cycles}) : ""), b.health < 70 ? "bad" : b.health < 80 ? "warn" : "acc")
        : card(t("Akku"), "–", t("Kein Akku gefunden (Desktop-PC)")),
      disks.length ? card(t(disks.length > 1 ? "Laufwerke" : "Laufwerk"), badDisk ? esc(badDisk.health) : t("Gesund"), disks.map(d => `${esc(d.name)} · ${esc([d.bus, d.media].filter(Boolean).join(" "))} · ${human(d.size)}`).join("<br>"), badDisk ? "bad" : "acc")
        : card(t("Laufwerke"), "–", t("Zustand nicht lesbar")),
      card(t("Virenschutz"), av.length ? t("Aktiv") : t("Kein aktiver Schutz"), (av.length ? av.map(a => esc(a.name) + (a.uptodate ? "" : t(" (veraltet)"))).join(", ") : t("Windows-Sicherheitscenter meldet nichts")) + (fw ? `<br>Firewall: ${fwOff.length ? t("aus für {list}", {list: esc(fwOff.join(", "))}) : t("an")}` : ""), av.length && !fwOff.length ? "acc" : "warn"),
      card(t("Neustart"), y.reboot.length ? t("Ausstehend") : t("Nicht nötig"), y.reboot.length ? t("für {list}", {list: esc(y.reboot.join(" & "))}) : t("Keine Updates warten auf einen Neustart"), y.reboot.length ? "warn" : "acc"),'''),
('''    if (disks.some(d => d.health === "Fehlerhaft" || d.health === "Warnung")) add.push({page: "", text: "Ein Laufwerk meldet Probleme. Sichere wichtige Daten jetzt – Windows erkennt einen möglichen Defekt."});
    if (b && b.health < 80) add.push({page: "", text: `Dein Akku hat nur noch ${b.health} % seiner ursprünglichen Kapazität. Tipp: In der Hersteller-App (z. B. MyASUS, Lenovo Vantage) die Ladegrenze auf 80 % stellen – das schont ihn deutlich.`});
    if (!(sec.av || []).some(a => a.active)) add.push({page: "", text: "Windows meldet keinen aktiven Virenschutz. Schalte Microsoft Defender in „Windows-Sicherheit“ ein."});
    if (sec.firewall && Object.values(sec.firewall).some(on => !on)) add.push({page: "", text: "Die Windows-Firewall ist nicht für alle Netzwerke aktiv."});
    if (y.reboot.length) add.push({page: "", text: `Windows wartet auf einen Neustart (${y.reboot.join(" & ")}). Erst danach sind Updates vollständig installiert.`});''',
 '''    if (disks.some(d => d.state === "bad" || d.state === "warn")) add.push({page: "", text: t("Ein Laufwerk meldet Probleme. Sichere wichtige Daten jetzt – Windows erkennt einen möglichen Defekt.")});
    if (b && b.health < 80) add.push({page: "", text: t("Dein Akku hat nur noch {pct} % seiner ursprünglichen Kapazität. Tipp: In der Hersteller-App (z. B. MyASUS, Lenovo Vantage) die Ladegrenze auf 80 % stellen – das schont ihn deutlich.", {pct: b.health})});
    if (!(sec.av || []).some(a => a.active)) add.push({page: "", text: t("Windows meldet keinen aktiven Virenschutz. Schalte Microsoft Defender in „Windows-Sicherheit“ ein.")});
    if (sec.firewall && Object.values(sec.firewall).some(on => !on)) add.push({page: "", text: t("Die Windows-Firewall ist nicht für alle Netzwerke aktiv.")});
    if (y.reboot.length) add.push({page: "", text: t("Windows wartet auf einen Neustart ({list}). Erst danach sind Updates vollständig installiert.", {list: y.reboot.join(" & ")})});'''),
('''    busy(this.el, true, "Bereinige …");
    try {
      const r = await task("quick_fix", {}, {onProgress: s => busy(this.el, true, s)}).promise;
      toast(`${human(r.freed)} freigegeben` + (r.skipped.length ? ` · übersprungen (geöffnet): ${r.skipped.join(", ")}` : ""));''',
 '''    busy(this.el, true, t("Bereinige …"));
    try {
      const r = await task("quick_fix", {}, {onProgress: s => busy(this.el, true, s)}).promise;
      toast(t("{size} freigegeben", {size: human(r.freed)}) + (r.skipped.length ? t(" · übersprungen (geöffnet): {list}", {list: r.skipped.join(", ")}) : ""));'''),
]
apply("/home/claude/FaLeClean/ui.html", R)
