from rep import apply
R = [
# --- Gaming
('''        <div class="grow"><h2 id="g-title" style="margin:0 0 4px">Gaming-Modus ist aus</h2><div class="muted" id="g-text">–</div></div>
        <button class="btn primary big" id="g-btn" data-busy>Starten</button></div>''',
 '''        <div class="grow"><h2 id="g-title" style="margin:0 0 4px">${t("Gaming-Modus ist aus")}</h2><div class="muted" id="g-text">–</div></div>
        <button class="btn primary big" id="g-btn" data-busy>${t("Starten")}</button></div>'''),
('''        <div class="card"><h4>Diese Apps schlafen legen</h4><div class="muted small">Während du spielst, bekommen sie keine CPU-Zeit. Discord & Co. kannst du aktiv lassen.</div>
          <div class="sheet-list" id="g-apps" style="margin-top:10px;max-height:300px;overflow:auto"><div class="dim small">Lade laufende Programme …</div></div></div>
        <div class="card"><h4>Automatisch bei diesen Spielen</h4><div class="muted small">Startet eines dieser Spiele, schaltet sich der Gaming-Modus von selbst ein – und nach dem Beenden wieder aus.</div>
          <div class="row" style="margin-top:12px"><span>Automatik</span><label class="sw"><input type="checkbox" id="g-auto"><span></span></label></div>
          <div class="chips" id="g-games" style="margin-top:12px"></div>
          <div class="row" style="margin-top:10px"><select id="g-pick" class="grow"><option value="">Laufendes Programm wählen …</option></select><button class="btn sm" id="g-add">Hinzufügen</button></div>
          <div class="row" style="margin-top:6px"><input type="text" id="g-exe" placeholder="oder Dateiname, z. B. FortniteClient-Win64-Shipping.exe" class="grow"><button class="btn sm" id="g-add2">+</button></div></div>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn" id="g-save">Einstellungen speichern</button></div>
      <div class="note" style="margin-top:14px">Was passiert: Energiesparplan „Höchstleistung“ bzw. „Ultimative Leistung“ (falls vorhanden) und die gewählten Apps werden pausiert. Beim Beenden kommt dein vorheriger Energiesparplan zurück und alle Apps werden aufgeweckt. Tipp: unter „Privatsphäre“ lässt sich zusätzlich die Hintergrundaufnahme (Game DVR) abschalten.</div>`;''',
 '''        <div class="card"><h4>${t("Diese Apps schlafen legen")}</h4><div class="muted small">${t("Während du spielst, bekommen sie keine CPU-Zeit. Discord & Co. kannst du aktiv lassen.")}</div>
          <div class="sheet-list" id="g-apps" style="margin-top:10px;max-height:300px;overflow:auto"><div class="dim small">${t("Lade laufende Programme …")}</div></div></div>
        <div class="card"><h4>${t("Automatisch bei diesen Spielen")}</h4><div class="muted small">${t("Startet eines dieser Spiele, schaltet sich der Gaming-Modus von selbst ein – und nach dem Beenden wieder aus.")}</div>
          <div class="row" style="margin-top:12px"><span>${t("Automatik")}</span><label class="sw"><input type="checkbox" id="g-auto"><span></span></label></div>
          <div class="chips" id="g-games" style="margin-top:12px"></div>
          <div class="row" style="margin-top:10px"><select id="g-pick" class="grow"><option value="">${t("Laufendes Programm wählen …")}</option></select><button class="btn sm" id="g-add">${t("Hinzufügen")}</button></div>
          <div class="row" style="margin-top:6px"><input type="text" id="g-exe" placeholder="${esc(t("oder Dateiname, z. B. FortniteClient-Win64-Shipping.exe"))}" class="grow"><button class="btn sm" id="g-add2">+</button></div></div>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn" id="g-save">${t("Einstellungen speichern")}</button></div>
      <div class="note" style="margin-top:14px">${t("Was passiert: Energiesparplan „Höchstleistung“ bzw. „Ultimative Leistung“ (falls vorhanden) und die gewählten Apps werden pausiert. Beim Beenden kommt dein vorheriger Energiesparplan zurück und alle Apps werden aufgeweckt. Tipp: unter „Privatsphäre“ lässt sich zusätzlich die Hintergrundaufnahme (Game DVR) abschalten.")}</div>`;'''),
('''return toast("Bitte einen .exe-Dateinamen angeben", "warn");''', '''return toast(t("Bitte einen .exe-Dateinamen angeben"), "warn");'''),
('''${running.includes(n) ? "" : `<span class="small dim">läuft nicht</span>`}</label>`).join("") : `<div class="dim small">Keine Programme gefunden</div>`;
      $("#g-pick").innerHTML = `<option value="">Laufendes Programm wählen …</option>`''',
 '''${running.includes(n) ? "" : `<span class="small dim">${t("läuft nicht")}</span>`}</label>`).join("") : `<div class="dim small">${t("Keine Programme gefunden")}</div>`;
      $("#g-pick").innerHTML = `<option value="">${t("Laufendes Programm wählen …")}</option>`'''),
(''': `<span class="dim small">Noch keine Spiele eingetragen.</span>`;''', ''': `<span class="dim small">${t("Noch keine Spiele eingetragen.")}</span>`;'''),
('''    $("#g-title").textContent = on ? "Gaming-Modus ist aktiv" : "Gaming-Modus ist aus";
    $("#g-btn").textContent = on ? "Beenden" : "Starten";''',
 '''    $("#g-title").textContent = t(on ? "Gaming-Modus ist aktiv" : "Gaming-Modus ist aus");
    $("#g-btn").textContent = t(on ? "Beenden" : "Starten");'''),
('''    const plan = c.best_plan ? `„${c.best_plan.name}“` : "dein aktueller Energiesparplan (kein Hochleistungsplan vorhanden)";
    $("#g-text").textContent = on ? `Seit ${new Date(c.since * 1000).toLocaleTimeString("de-DE", {hour: "2-digit", minute: "2-digit"})}${c.by_auto ? " (automatisch)" : ""} · ${c.suspended.length} Apps schlafen · Energiesparplan ${plan}`
      : `Beim Start: Energiesparplan ${plan}, ${c.apps.length} Apps werden pausiert.`;''',
 '''    const plan = c.best_plan ? t("„{name}“", {name: c.best_plan.name}) : t("dein aktueller Energiesparplan (kein Hochleistungsplan vorhanden)");
    $("#g-text").textContent = on ? t("Seit {time}{auto} · {n} Apps schlafen · Energiesparplan {plan}", {time: new Date(c.since * 1000).toLocaleTimeString(LOC, {hour: "2-digit", minute: "2-digit"}), auto: c.by_auto ? t(" (automatisch)") : "", n: c.suspended.length, plan})
      : t("Beim Start: Energiesparplan {plan}, {n} Apps werden pausiert.", {plan, n: c.apps.length});'''),
('''this.hero(); if (!silent) toast("Gespeichert"); } catch (e) { err(e); }''', '''this.hero(); if (!silent) toast(t("Gespeichert")); } catch (e) { err(e); }'''),
('''    busy(this.el, true, on ? "Starte Gaming-Modus …" : "Stelle alles wieder her …");
    try { const g = await task("gaming_toggle", {on}).promise; this.cfg = {...this.cfg, ...g}; this.hero(); toast(on ? "Gaming-Modus aktiv – viel Spaß!" : "Alles zurückgesetzt"); }''',
 '''    busy(this.el, true, t(on ? "Starte Gaming-Modus …" : "Stelle alles wieder her …"));
    try { const g = await task("gaming_toggle", {on}).promise; this.cfg = {...this.cfg, ...g}; this.hero(); toast(t(on ? "Gaming-Modus aktiv – viel Spaß!" : "Alles zurückgesetzt")); }'''),
# --- Privatsphäre
('''    el.innerHTML = `<div class="row"><button class="btn primary" id="pv-rec">Empfohlene anwenden</button><button class="btn" id="pv-exp" style="display:none">Explorer neu starten</button><span class="grow"></span>
        <span class="small muted">Nach Windows-Updates automatisch wiederherstellen</span><label class="sw"><input type="checkbox" id="pv-auto"><span></span></label></div>
      <div class="note" style="margin-top:12px">Jede Einstellung speichert vorher den Originalwert. Ausschalten stellt genau diesen Zustand wieder her. Windows-Updates setzen manches zurück – mit dem Schalter oben korrigiert FaLe Clean das stündlich im Hintergrund.</div>
      <div id="pv-list"></div>
      <h3>Bloatware</h3>
      <div class="card"><div class="row"><div class="grow muted small">Vorinstallierte Apps, die die meisten nie nutzen. Systemwichtige Apps (Store, Rechner, Fotos, Sicherheit …) werden nie angezeigt. Entfernte Apps lassen sich jederzeit aus dem Microsoft Store neu installieren.</div><button class="btn" id="bl-scan" data-busy>Apps suchen</button></div>
        <div id="bl-list" style="margin-top:10px"></div>
        <div class="row" style="margin-top:10px;display:none" id="bl-acts"><span class="grow small muted" id="bl-info"></span><button class="btn danger" id="bl-go" data-busy>Ausgewählte entfernen</button></div>''',
 '''    el.innerHTML = `<div class="row"><button class="btn primary" id="pv-rec">${t("Empfohlene anwenden")}</button><button class="btn" id="pv-exp" style="display:none">${t("Explorer neu starten")}</button><span class="grow"></span>
        <span class="small muted">${t("Nach Windows-Updates automatisch wiederherstellen")}</span><label class="sw"><input type="checkbox" id="pv-auto"><span></span></label></div>
      <div class="note" style="margin-top:12px">${t("Jede Einstellung speichert vorher den Originalwert. Ausschalten stellt genau diesen Zustand wieder her. Windows-Updates setzen manches zurück – mit dem Schalter oben korrigiert FaLe Clean das stündlich im Hintergrund.")}</div>
      <div id="pv-list"></div>
      <h3>Bloatware</h3>
      <div class="card"><div class="row"><div class="grow muted small">${t("Vorinstallierte Apps, die die meisten nie nutzen. Systemwichtige Apps (Store, Rechner, Fotos, Sicherheit …) werden nie angezeigt. Entfernte Apps lassen sich jederzeit aus dem Microsoft Store neu installieren.")}</div><button class="btn" id="bl-scan" data-busy>${t("Apps suchen")}</button></div>
        <div id="bl-list" style="margin-top:10px"></div>
        <div class="row" style="margin-top:10px;display:none" id="bl-acts"><span class="grow small muted" id="bl-info"></span><button class="btn danger" id="bl-go" data-busy>${t("Ausgewählte entfernen")}</button></div>'''),
('''$("#pv-exp").style.display = "none"; toast("Explorer neu gestartet"); };''', '''$("#pv-exp").style.display = "none"; toast(t("Explorer neu gestartet")); };'''),
('''.then(() => toast(e.target.checked ? "Wird nach Updates automatisch korrigiert" : "Automatik aus")).catch(err);''', '''.then(() => toast(t(e.target.checked ? "Wird nach Updates automatisch korrigiert" : "Automatik aus"))).catch(err);'''),
('''      const groups = [...new Set(d.list.map(t => t.group))];
      $("#pv-list").innerHTML = groups.map(g => `<h3>${esc(g)}</h3><div class="card" style="padding:4px 16px">${d.list.filter(t => t.group === g).map(t => `
        <div class="tw"><label class="sw" style="margin-top:2px"><input type="checkbox" data-t="${t.id}" ${t.on ? "checked" : ""} ${t.can ? "" : "disabled"}><span></span></label>
          <div class="grow"><div class="t">${esc(t.title)} ${t.rec ? `<span class="pill ok">empfohlen</span>` : ""} ${t.admin ? `<span class="pill ${t.can ? "" : "warn"}">Admin</span>` : ""}</div><div class="d">${esc(t.desc)}</div></div></div>`).join("")}</div>`).join("");''',
 '''      const groups = [...new Set(d.list.map(x => x.group))];
      $("#pv-list").innerHTML = groups.map(g => `<h3>${esc(g)}</h3><div class="card" style="padding:4px 16px">${d.list.filter(x => x.group === g).map(x => `
        <div class="tw"><label class="sw" style="margin-top:2px"><input type="checkbox" data-t="${x.id}" ${x.on ? "checked" : ""} ${x.can ? "" : "disabled"}><span></span></label>
          <div class="grow"><div class="t">${esc(x.title)} ${x.rec ? `<span class="pill ok">${t("empfohlen")}</span>` : ""} ${x.admin ? `<span class="pill ${x.can ? "" : "warn"}">Admin</span>` : ""}</div><div class="d">${esc(x.desc)}</div></div></div>`).join("")}</div>`).join("");'''),
('''      if (!r.ok) { cb && (cb.checked = !on); return toast("Dafür sind Admin-Rechte nötig", "warn"); }
      if (r.explorer) $("#pv-exp").style.display = "";
      toast(on ? "Angewendet" : "Original wiederhergestellt");''',
 '''      if (!r.ok) { cb && (cb.checked = !on); return toast(t("Dafür sind Admin-Rechte nötig"), "warn"); }
      if (r.explorer) $("#pv-exp").style.display = "";
      toast(t(on ? "Angewendet" : "Original wiederhergestellt"));'''),
('''    const todo = this.tw.filter(t => t.rec && t.can && !t.on);
    if (!todo.length) return toast("Alle empfohlenen Einstellungen sind schon aktiv");
    if (!await confirmBox("Empfohlene Einstellungen anwenden?", `${todo.length} Einstellungen werden gesetzt:<br><br>${todo.map(t => "• " + esc(t.title)).join("<br>")}<br><br>Jede lässt sich einzeln wieder ausschalten.`, "Anwenden")) return;
    let exp = false, done = 0;
    for (const t of todo) { try { const r = await call("tweak_set", {id: t.id, on: true}); if (r.ok) { done++; exp = exp || r.explorer; } } catch (e) {} }
    if (exp) $("#pv-exp").style.display = "";
    toast(`${done} von ${todo.length} Einstellungen angewendet`, done < todo.length ? "warn" : ""); this.load();''',
 '''    const todo = this.tw.filter(x => x.rec && x.can && !x.on);
    if (!todo.length) return toast(t("Alle empfohlenen Einstellungen sind schon aktiv"));
    if (!await confirmBox(t("Empfohlene Einstellungen anwenden?"), `${t("{n} Einstellungen werden gesetzt:", {n: todo.length})}<br><br>${todo.map(x => "• " + esc(x.title)).join("<br>")}<br><br>${t("Jede lässt sich einzeln wieder ausschalten.")}`, "Anwenden")) return;
    let exp = false, done = 0;
    for (const x of todo) { try { const r = await call("tweak_set", {id: x.id, on: true}); if (r.ok) { done++; exp = exp || r.explorer; } } catch (e) {} }
    if (exp) $("#pv-exp").style.display = "";
    toast(t("{done} von {n} Einstellungen angewendet", {done, n: todo.length}), done < todo.length ? "warn" : ""); this.load();'''),
('''    busy(this.el, true, "Suche vorinstallierte Apps …");''', '''    busy(this.el, true, t("Suche vorinstallierte Apps …"));'''),
('''${a.rec ? `<span class="pill ok">empfohlen</span>` : `<span class="pill">optional</span>`}</label>`).join("")}</div>` : `<div class="empty">Keine bekannte Bloatware gefunden 🎉</div>`;''',
 '''${a.rec ? `<span class="pill ok">${t("empfohlen")}</span>` : `<span class="pill">${t("optional")}</span>`}</label>`).join("")}</div>` : `<div class="empty">${t("Keine bekannte Bloatware gefunden 🎉")}</div>`;'''),
('''      const upd = () => $("#bl-info").textContent = `${$$("#bl-list input:checked").length} ausgewählt`;''', '''      const upd = () => $("#bl-info").textContent = t("{n} ausgewählt", {n: $$("#bl-list input:checked").length});'''),
('''    if (!await confirmBox("Apps entfernen?", `${sel.map(a => "• " + esc(a.label)).join("<br>")}<br><br>Neu installieren geht jederzeit über „Rückgängig“ → Microsoft Store.`, "Entfernen", "danger")) return;''',
 '''    if (!await confirmBox(t("Apps entfernen?"), `${sel.map(a => "• " + esc(a.label)).join("<br>")}<br><br>${t("Neu installieren geht jederzeit über „Rückgängig“ → Microsoft Store.")}`, "Entfernen", "danger")) return;'''),
('''    busy(this.el, true, "Entferne Apps …");
    try { const r = await task("bloat_remove", {fulls: sel.map(a => a.full)}, {onLine: l => { lg.textContent += l + "\\n"; lg.scrollTop = 1e9; }}).promise; toast(`${r.ok} Apps entfernt`); }''',
 '''    busy(this.el, true, t("Entferne Apps …"));
    try { const r = await task("bloat_remove", {fulls: sel.map(a => a.full)}, {onLine: l => { lg.textContent += l + "\\n"; lg.scrollTop = 1e9; }}).promise; toast(t("{n} Apps entfernt", {n: r.ok})); }'''),
# --- Rückgängig
('''      <h3>Wiederherstellbar</h3><div class="qs" id="u-q"></div>
      <h3>Entfernte Apps</h3><div class="qs" id="u-apps"></div>
      <div class="note" style="margin-top:16px">Caches und Temp-Dateien werden sofort gelöscht – Programme legen sie bei Bedarf neu an. Verlauf, Cookies, alte Installer und Programm-Reste landen dagegen erst in der Quarantäne. Duplikate liegen im Windows-Papierkorb.</div>`;''',
 '''      <h3>${t("Wiederherstellbar")}</h3><div class="qs" id="u-q"></div>
      <h3>${t("Entfernte Apps")}</h3><div class="qs" id="u-apps"></div>
      <div class="note" style="margin-top:16px">${t("Caches und Temp-Dateien werden sofort gelöscht – Programme legen sie bei Bedarf neu an. Verlauf, Cookies, alte Installer und Programm-Reste landen dagegen erst in der Quarantäne. Duplikate liegen im Windows-Papierkorb.")}</div>`;'''),
('''      $("#u-stats").innerHTML = [["Insgesamt freigegeben", human(st.freed_total || 0), `in ${st.cleanings || 0} Reinigungen`], ["In der Quarantäne", human(qsize), `${d.sessions.length} Vorgänge · ${d.days} Tage aufbewahrt`], ["Entfernte Apps", String(d.apps.length), "aus dem Store wiederherstellbar"]]''',
 '''      $("#u-stats").innerHTML = [[t("Insgesamt freigegeben"), human(st.freed_total || 0), t("in {n} Reinigungen", {n: st.cleanings || 0})], [t("In der Quarantäne"), human(qsize), t("{n} Vorgänge · {d} Tage aufbewahrt", {n: d.sessions.length, d: d.days})], [t("Entfernte Apps"), String(d.apps.length), t("aus dem Store wiederherstellbar")]]'''),
('''        return `<div class="q"><div class="meta"><b>${esc(q.label)}</b> <span class="small dim">${fmtDate(q.time)} · ${q.count} Einträge · ${human(q.size)} · noch ${left} ${left === 1 ? "Tag" : "Tage"}</span><div class="sample">${q.sample.map(esc).join(" · ")}</div></div>
          <button class="btn sm primary" data-r="${esc(q.id)}">Wiederherstellen</button><button class="btn sm danger" data-d="${esc(q.id)}">Endgültig löschen</button></div>`;
      }).join("") : `<div class="empty card">Nichts in der Quarantäne.</div>`;
      $("#u-apps").innerHTML = d.apps.length ? d.apps.map(a => `<div class="q"><div class="meta"><b>${esc(a.label)}</b> <span class="small dim">entfernt am ${fmtDate(a.time)}</span></div><button class="btn sm" data-f="${esc(a.family)}">Im Store neu installieren</button></div>`).join("") : `<div class="empty card">Keine Apps entfernt.</div>`;
      $$("[data-r]", this.el).forEach(b => b.onclick = async () => { try { const r = await call("undo_restore", {id: b.dataset.r}); if (r.blocked && r.blocked.length) return toast(`Bitte zuerst schließen: ${r.blocked.join(", ")}`, "warn"); toast(`${r.restored} wiederhergestellt` + (r.failed.length ? ` · ${r.failed.length} fehlgeschlagen` : ""), r.failed.length ? "warn" : ""); this.load(); } catch (e) { err(e); } });
      $$("[data-d]", this.el).forEach(b => b.onclick = async () => { if (await confirmBox("Endgültig löschen?", "Diese Dateien können danach nicht mehr wiederhergestellt werden.", "Löschen", "danger")) { await call("undo_delete", {id: b.dataset.d}).catch(err); this.load(); } });
      $$("[data-f]", this.el).forEach(b => b.onclick = () => call("reinstall_app", {family: b.dataset.f}).then(() => toast("Microsoft Store wird geöffnet")).catch(err));''',
 '''        return `<div class="q"><div class="meta"><b>${esc(q.label)}</b> <span class="small dim">${t("{date} · {n} Einträge · {size} · noch {left}", {date: fmtDate(q.time), n: q.count, size: human(q.size), left: t(left === 1 ? "{n} Tag" : "{n} Tage", {n: left})})}</span><div class="sample">${q.sample.map(esc).join(" · ")}</div></div>
          <button class="btn sm primary" data-r="${esc(q.id)}">${t("Wiederherstellen")}</button><button class="btn sm danger" data-d="${esc(q.id)}">${t("Endgültig löschen")}</button></div>`;
      }).join("") : `<div class="empty card">${t("Nichts in der Quarantäne.")}</div>`;
      $("#u-apps").innerHTML = d.apps.length ? d.apps.map(a => `<div class="q"><div class="meta"><b>${esc(a.label)}</b> <span class="small dim">${t("entfernt am {date}", {date: fmtDate(a.time)})}</span></div><button class="btn sm" data-f="${esc(a.family)}">${t("Im Store neu installieren")}</button></div>`).join("") : `<div class="empty card">${t("Keine Apps entfernt.")}</div>`;
      $$("[data-r]", this.el).forEach(b => b.onclick = async () => { try { const r = await call("undo_restore", {id: b.dataset.r}); if (r.blocked && r.blocked.length) return toast(t("Bitte zuerst schließen: {list}", {list: r.blocked.join(", ")}), "warn"); toast(t("{n} wiederhergestellt", {n: r.restored}) + (r.failed.length ? t(" · {n} fehlgeschlagen", {n: r.failed.length}) : ""), r.failed.length ? "warn" : ""); this.load(); } catch (e) { err(e); } });
      $$("[data-d]", this.el).forEach(b => b.onclick = async () => { if (await confirmBox(t("Endgültig löschen?"), t("Diese Dateien können danach nicht mehr wiederhergestellt werden."), "Löschen", "danger")) { await call("undo_delete", {id: b.dataset.d}).catch(err); this.load(); } });
      $$("[data-f]", this.el).forEach(b => b.onclick = () => call("reinstall_app", {family: b.dataset.f}).then(() => toast(t("Microsoft Store wird geöffnet"))).catch(err));'''),
# --- Werkzeuge
('''      <div class="card"><h4>Wiederherstellungspunkt</h4><p class="muted small">Sicherungspunkt des Systems anlegen, bevor du größere Änderungen machst. Benötigt Admin-Rechte.</p><button class="btn" data-busy data-t="restore">Erstellen</button></div>
      <div class="card"><h4>Windows-Komponentenspeicher</h4><p class="muted small">Entfernt alte, ersetzte Systemkomponenten (DISM). Gibt oft mehrere GB frei. Admin, dauert einige Minuten.</p><button class="btn" data-busy data-t="dism">Bereinigen</button></div>
      <div class="card"><h4>DNS-Cache leeren</h4><p class="muted small">Hilft, wenn Webseiten nach einem Umzug oder Fehler nicht richtig laden.</p><button class="btn" data-busy data-t="dns">Leeren</button></div>
      <div class="card"><h4>Freien Speicher sicher löschen</h4><p class="muted small">Überschreibt den freien Platz, damit gelöschte Dateien nicht wiederhergestellt werden können. Deine Dateien bleiben unberührt. Dauert lange.</p><div class="row"><select id="t-drv"></select><button class="btn" data-busy data-t="wipe">Starten</button></div></div>
      <div class="card"><h4>Windows-Datenträgerbereinigung</h4><p class="muted small">Öffnet das eingebaute Windows-Werkzeug.</p><button class="btn" id="t-cm">Öffnen</button></div>
    </div>
    <div class="row" style="margin-top:14px"><span class="status grow"></span><button class="btn" id="t-stop" disabled>Abbrechen</button></div>
    <div class="prog"><i></i></div><div class="console" id="t-log">Bereit.</div>`;
    call("drives").then(d => $("#t-drv").innerHTML = d.map(x => `<option value="${esc(x.path)}">${esc(x.path)} (${human(x.free)} frei)</option>`).join("")).catch(() => {});''',
 '''      <div class="card"><h4>${t("Wiederherstellungspunkt")}</h4><p class="muted small">${t("Sicherungspunkt des Systems anlegen, bevor du größere Änderungen machst. Benötigt Admin-Rechte.")}</p><button class="btn" data-busy data-t="restore">${t("Erstellen")}</button></div>
      <div class="card"><h4>${t("Windows-Komponentenspeicher")}</h4><p class="muted small">${t("Entfernt alte, ersetzte Systemkomponenten (DISM). Gibt oft mehrere GB frei. Admin, dauert einige Minuten.")}</p><button class="btn" data-busy data-t="dism">${t("Bereinigen")}</button></div>
      <div class="card"><h4>${t("DNS-Cache leeren")}</h4><p class="muted small">${t("Hilft, wenn Webseiten nach einem Umzug oder Fehler nicht richtig laden.")}</p><button class="btn" data-busy data-t="dns">${t("Leeren")}</button></div>
      <div class="card"><h4>${t("Freien Speicher sicher löschen")}</h4><p class="muted small">${t("Überschreibt den freien Platz, damit gelöschte Dateien nicht wiederhergestellt werden können. Deine Dateien bleiben unberührt. Dauert lange.")}</p><div class="row"><select id="t-drv"></select><button class="btn" data-busy data-t="wipe">${t("Starten")}</button></div></div>
      <div class="card"><h4>${t("Windows-Datenträgerbereinigung")}</h4><p class="muted small">${t("Öffnet das eingebaute Windows-Werkzeug.")}</p><button class="btn" id="t-cm">${t("Öffnen")}</button></div>
    </div>
    <div class="row" style="margin-top:14px"><span class="status grow"></span><button class="btn" id="t-stop" disabled>${t("Abbrechen")}</button></div>
    <div class="prog"><i></i></div><div class="console" id="t-log">${t("Bereit.")}</div>`;
    call("drives").then(d => $("#t-drv").innerHTML = d.map(x => `<option value="${esc(x.path)}">${esc(x.path)} (${t("{size} frei", {size: human(x.free)})})</option>`).join("")).catch(() => {});'''),
('''    if (name === "wipe" && !await confirmBox("Freien Speicher überschreiben?", "Das kann je nach Laufwerk Stunden dauern. Vorhandene Dateien bleiben erhalten.", "Starten")) return;''',
 '''    if (name === "wipe" && !await confirmBox(t("Freien Speicher überschreiben?"), t("Das kann je nach Laufwerk Stunden dauern. Vorhandene Dateien bleiben erhalten."), "Starten")) return;'''),
('''    busy(this.el, true, "Läuft …"); $("#t-stop").disabled = false;''', '''    busy(this.el, true, t("Läuft …")); $("#t-stop").disabled = false;'''),
('''lg.textContent += `\\n${code === 0 ? "✔ Fertig." : "Beendet mit Code " + code + (INFO.admin ? "" : " – evtl. Admin-Rechte nötig.")}\\n`; }''',
 '''lg.textContent += `\\n${code === 0 ? t("✔ Fertig.") : t("Beendet mit Code {code}", {code}) + (INFO.admin ? "" : t(" – evtl. Admin-Rechte nötig."))}\\n`; }'''),
# --- Start
('''if (ok) { toast("Starte neu als Administrator …"); setTimeout(() => window.close(), 800); }''', '''if (ok) { toast(t("Starte neu als Administrator …")); setTimeout(() => window.close(), 800); }'''),
('''  $("#nav").innerHTML = NAV.map(n => n[0] === "sec" ? `<div class="sec">${n[1]}</div>` : `<a data-p="${n[0]}">${svg(n[0])}<span>${n[1]}</span>${n[2] ? `<span class="pro">PRO</span>` : ""}</a>`).join("");
  $$("nav a").forEach(a => a.onclick = () => go(a.dataset.p));
  $("#adm-btn").onclick = restartAdmin;''',
 '''  $("#nav").innerHTML = NAV.map(n => n[0] === "sec" ? `<div class="sec">${esc(t(n[1]))}</div>` : `<a data-p="${n[0]}">${svg(n[0])}<span>${esc(t(n[1]))}</span>${n[2] ? `<span class="pro">PRO</span>` : ""}</a>`).join("");
  $$("nav a").forEach(a => a.onclick = () => go(a.dataset.p));
  $("#adm-btn").textContent = t("Als Administrator neu starten");
  $("#adm-btn").onclick = restartAdmin;
  $$("#lang-sw [data-l]").forEach(b => {
    b.classList.toggle("on", b.dataset.l === LANG);
    b.onclick = async () => { if (b.dataset.l === LANG) return; try { await call("set_lang", {lang: b.dataset.l}); location.reload(); } catch (e) { err(e); } };
  });'''),
('''    $("#adm-txt").textContent = INFO.admin ? "Administrator-Modus" : "Eingeschränkter Modus";''', '''    $("#adm-txt").textContent = t(INFO.admin ? "Administrator-Modus" : "Eingeschränkter Modus");'''),
]
apply("/home/claude/FaLeClean/ui.html", R)
