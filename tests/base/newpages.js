// ---- Gaming-Modus ---------------------------------------------------------------
P.gaming = {
  title: "Gaming-Modus", sub: "Ein Klick: maximale Leistung fürs Spiel – danach stellt FaLe Clean alles wieder zurück.",
  init(el) {
    this.el = el;
    el.innerHTML = `<div class="card game-hero" id="g-hero"><div class="big-ico">${svg("gaming")}</div>
        <div class="grow"><h2 id="g-title" style="margin:0 0 4px">Gaming-Modus ist aus</h2><div class="muted" id="g-text">–</div></div>
        <button class="btn primary big" id="g-btn" data-busy>Starten</button></div>
      <div class="prog"><i></i></div><div class="status"></div>
      <div class="cards2" style="margin-top:6px">
        <div class="card"><h4>Diese Apps schlafen legen</h4><div class="muted small">Während du spielst, bekommen sie keine CPU-Zeit. Discord & Co. kannst du aktiv lassen.</div>
          <div class="sheet-list" id="g-apps" style="margin-top:10px;max-height:300px;overflow:auto"><div class="dim small">Lade laufende Programme …</div></div></div>
        <div class="card"><h4>Automatisch bei diesen Spielen</h4><div class="muted small">Startet eines dieser Spiele, schaltet sich der Gaming-Modus von selbst ein – und nach dem Beenden wieder aus.</div>
          <div class="row" style="margin-top:12px"><span>Automatik</span><label class="sw"><input type="checkbox" id="g-auto"><span></span></label></div>
          <div class="chips" id="g-games" style="margin-top:12px"></div>
          <div class="row" style="margin-top:10px"><select id="g-pick" class="grow"><option value="">Laufendes Programm wählen …</option></select><button class="btn sm" id="g-add">Hinzufügen</button></div>
          <div class="row" style="margin-top:6px"><input type="text" id="g-exe" placeholder="oder Dateiname, z. B. FortniteClient-Win64-Shipping.exe" class="grow"><button class="btn sm" id="g-add2">+</button></div></div>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn" id="g-save">Einstellungen speichern</button></div>
      <div class="note" style="margin-top:14px">Was passiert: Energiesparplan „Höchstleistung“ bzw. „Ultimative Leistung“ (falls vorhanden) und die gewählten Apps werden pausiert. Beim Beenden kommt dein vorheriger Energiesparplan zurück und alle Apps werden aufgeweckt. Tipp: unter „Privatsphäre“ lässt sich zusätzlich die Hintergrundaufnahme (Game DVR) abschalten.</div>`;
    $("#g-btn").onclick = () => this.toggle();
    $("#g-save").onclick = () => this.save();
    const add = v => { v = (v || "").trim(); if (!/^[\w .()\-]+\.exe$/i.test(v)) return toast("Bitte einen .exe-Dateinamen angeben", "warn"); this.games.add(v.toLowerCase()); this.drawGames(); };
    $("#g-add").onclick = () => add($("#g-pick").value);
    $("#g-add2").onclick = () => { add($("#g-exe").value); $("#g-exe").value = ""; };
  },
  async show() {
    try { this.cfg = await call("gaming_get"); } catch (e) { return err(e); }
    this.games = new Set(this.cfg.games); $("#g-auto").checked = this.cfg.auto; this.drawGames(); this.hero();
    try {
      const running = await task("running_apps").promise;
      const names = [...new Set([...this.cfg.apps, ...running])].sort((a, b) => a.localeCompare(b));
      const games = new Set(this.cfg.games);
      $("#g-apps").innerHTML = names.length ? names.map(n => `<label><input type="checkbox" value="${esc(n)}" ${this.cfg.apps.includes(n) ? "checked" : ""}><span class="grow">${esc(n)}</span>${running.includes(n) ? "" : `<span class="small dim">läuft nicht</span>`}</label>`).join("") : `<div class="dim small">Keine Programme gefunden</div>`;
      $("#g-pick").innerHTML = `<option value="">Laufendes Programm wählen …</option>` + running.filter(n => !games.has(n.toLowerCase())).map(n => `<option>${esc(n)}</option>`).join("");
    } catch (e) { err(e); }
  },
  drawGames() {
    $("#g-games").innerHTML = this.games.size ? [...this.games].map(g => `<span class="chip on" data-g="${esc(g)}">${esc(g)}<span class="x">✕</span></span>`).join("") : `<span class="dim small">Noch keine Spiele eingetragen.</span>`;
    $$("#g-games [data-g]").forEach(c => c.onclick = () => { this.games.delete(c.dataset.g); this.drawGames(); });
  },
  hero() {
    const c = this.cfg, on = c.active;
    $("#g-hero").classList.toggle("on", on);
    $("#g-title").textContent = on ? "Gaming-Modus ist aktiv" : "Gaming-Modus ist aus";
    $("#g-btn").textContent = on ? "Beenden" : "Starten";
    $("#g-btn").className = "btn big " + (on ? "danger" : "primary");
    const plan = c.best_plan ? `„${c.best_plan.name}“` : "dein aktueller Energiesparplan (kein Hochleistungsplan vorhanden)";
    $("#g-text").textContent = on ? `Seit ${new Date(c.since * 1000).toLocaleTimeString("de-DE", {hour: "2-digit", minute: "2-digit"})}${c.by_auto ? " (automatisch)" : ""} · ${c.suspended.length} Apps schlafen · Energiesparplan ${plan}`
      : `Beim Start: Energiesparplan ${plan}, ${c.apps.length} Apps werden pausiert.`;
  },
  async save(silent) {
    const apps = $$("#g-apps input:checked").map(c => c.value);
    try { this.cfg = {...this.cfg, ...(await call("gaming_save", {apps, games: [...this.games], auto: $("#g-auto").checked}))}; this.hero(); if (!silent) toast("Gespeichert"); } catch (e) { err(e); }
  },
  async toggle() {
    const on = !this.cfg.active;
    if (on) await this.save(true);
    busy(this.el, true, on ? "Starte Gaming-Modus …" : "Stelle alles wieder her …");
    try { const g = await task("gaming_toggle", {on}).promise; this.cfg = {...this.cfg, ...g}; this.hero(); toast(on ? "Gaming-Modus aktiv – viel Spaß!" : "Alles zurückgesetzt"); }
    catch (e) { err(e); }
    busy(this.el, false, "");
  },
};

// ---- Privatsphäre & Bloatware -----------------------------------------------------
P.privacy = {
  title: "Privatsphäre & Bloatware", sub: "Werbung, Tracking und vorinstallierten Ballast aus Windows entfernen – alles umkehrbar.",
  init(el) {
    this.el = el;
    el.innerHTML = `<div class="row"><button class="btn primary" id="pv-rec">Empfohlene anwenden</button><button class="btn" id="pv-exp" style="display:none">Explorer neu starten</button><span class="grow"></span>
        <span class="small muted">Nach Windows-Updates automatisch wiederherstellen</span><label class="sw"><input type="checkbox" id="pv-auto"><span></span></label></div>
      <div class="note" style="margin-top:12px">Jede Einstellung speichert vorher den Originalwert. Ausschalten stellt genau diesen Zustand wieder her. Windows-Updates setzen manches zurück – mit dem Schalter oben korrigiert FaLe Clean das stündlich im Hintergrund.</div>
      <div id="pv-list"></div>
      <h3>Bloatware</h3>
      <div class="card"><div class="row"><div class="grow muted small">Vorinstallierte Apps, die die meisten nie nutzen. Systemwichtige Apps (Store, Rechner, Fotos, Sicherheit …) werden nie angezeigt. Entfernte Apps lassen sich jederzeit aus dem Microsoft Store neu installieren.</div><button class="btn" id="bl-scan" data-busy>Apps suchen</button></div>
        <div id="bl-list" style="margin-top:10px"></div>
        <div class="row" style="margin-top:10px;display:none" id="bl-acts"><span class="grow small muted" id="bl-info"></span><button class="btn danger" id="bl-go" data-busy>Ausgewählte entfernen</button></div>
        <div class="console" id="bl-log" style="display:none;height:140px"></div></div>
      <div class="prog"><i></i></div><div class="status"></div>`;
    $("#pv-rec").onclick = () => this.recommended();
    $("#pv-exp").onclick = async () => { await call("restart_explorer").catch(err); $("#pv-exp").style.display = "none"; toast("Explorer neu gestartet"); };
    $("#pv-auto").onchange = e => call("tweaks_autofix", {on: e.target.checked}).then(() => toast(e.target.checked ? "Wird nach Updates automatisch korrigiert" : "Automatik aus")).catch(err);
    $("#bl-scan").onclick = () => this.scan();
    $("#bl-go").onclick = () => this.remove();
  },
  show() { this.load(); },
  async load() {
    try {
      const d = await call("tweaks"); this.tw = d.list; $("#pv-auto").checked = d.autofix;
      const groups = [...new Set(d.list.map(t => t.group))];
      $("#pv-list").innerHTML = groups.map(g => `<h3>${esc(g)}</h3><div class="card" style="padding:4px 16px">${d.list.filter(t => t.group === g).map(t => `
        <div class="tw"><label class="sw" style="margin-top:2px"><input type="checkbox" data-t="${t.id}" ${t.on ? "checked" : ""} ${t.can ? "" : "disabled"}><span></span></label>
          <div class="grow"><div class="t">${esc(t.title)} ${t.rec ? `<span class="pill ok">empfohlen</span>` : ""} ${t.admin ? `<span class="pill ${t.can ? "" : "warn"}">Admin</span>` : ""}</div><div class="d">${esc(t.desc)}</div></div></div>`).join("")}</div>`).join("");
      $$("#pv-list [data-t]").forEach(c => c.onchange = () => this.set(c.dataset.t, c.checked, c));
    } catch (e) { err(e); }
  },
  async set(id, on, cb) {
    try {
      const r = await call("tweak_set", {id, on});
      if (!r.ok) { cb && (cb.checked = !on); return toast("Dafür sind Admin-Rechte nötig", "warn"); }
      if (r.explorer) $("#pv-exp").style.display = "";
      toast(on ? "Angewendet" : "Original wiederhergestellt");
    } catch (e) { cb && (cb.checked = !on); err(e); }
  },
  async recommended() {
    const todo = this.tw.filter(t => t.rec && t.can && !t.on);
    if (!todo.length) return toast("Alle empfohlenen Einstellungen sind schon aktiv");
    if (!await confirmBox("Empfohlene Einstellungen anwenden?", `${todo.length} Einstellungen werden gesetzt:<br><br>${todo.map(t => "• " + esc(t.title)).join("<br>")}<br><br>Jede lässt sich einzeln wieder ausschalten.`, "Anwenden")) return;
    let exp = false;
    for (const t of todo) { try { const r = await call("tweak_set", {id: t.id, on: true}); exp = exp || r.explorer; } catch (e) {} }
    if (exp) $("#pv-exp").style.display = "";
    toast(`${todo.length} Einstellungen angewendet`); this.load();
  },
  async scan() {
    busy(this.el, true, "Suche vorinstallierte Apps …");
    try {
      this.apps = await task("bloat_list").promise;
      $("#bl-list").innerHTML = this.apps.length ? `<div class="sheet-list">${this.apps.map((a, i) => `<label><input type="checkbox" data-i="${i}" ${a.rec ? "checked" : ""}><span class="grow">${esc(a.label)} <span class="small dim">${esc(a.name)}</span></span>${a.rec ? `<span class="pill ok">empfohlen</span>` : `<span class="pill">optional</span>`}</label>`).join("")}</div>` : `<div class="empty">Keine bekannte Bloatware gefunden 🎉</div>`;
      $("#bl-acts").style.display = this.apps.length ? "" : "none";
      const upd = () => $("#bl-info").textContent = `${$$("#bl-list input:checked").length} ausgewählt`;
      $$("#bl-list input").forEach(c => c.onchange = upd); upd();
    } catch (e) { err(e); }
    busy(this.el, false, "");
  },
  async remove() {
    const sel = $$("#bl-list input:checked").map(c => this.apps[+c.dataset.i]);
    if (!sel.length) return;
    if (!await confirmBox("Apps entfernen?", `${sel.map(a => "• " + esc(a.label)).join("<br>")}<br><br>Neu installieren geht jederzeit über „Rückgängig“ → Microsoft Store.`, "Entfernen", "danger")) return;
    const lg = $("#bl-log"); lg.style.display = ""; lg.textContent = "";
    busy(this.el, true, "Entferne Apps …");
    try { const r = await task("bloat_remove", {fulls: sel.map(a => a.full)}, {onLine: l => { lg.textContent += l + "\n"; lg.scrollTop = 1e9; }}).promise; toast(`${r.ok} Apps entfernt`); }
    catch (e) { err(e); }
    busy(this.el, false, ""); this.scan();
  },
};

// ---- Rückgängig ------------------------------------------------------------------
P.undo = {
  title: "Rückgängig", sub: "Dein Sicherheitsnetz: Was FaLe Clean entfernt hat, kannst du hier zurückholen.",
  init(el) {
    this.el = el;
    el.innerHTML = `<div class="stats" id="u-stats" style="grid-template-columns:repeat(3,1fr)"></div>
      <h3>Wiederherstellbar</h3><div class="qs" id="u-q"></div>
      <h3>Entfernte Apps</h3><div class="qs" id="u-apps"></div>
      <div class="note" style="margin-top:16px">Caches und Temp-Dateien werden sofort gelöscht – Programme legen sie bei Bedarf neu an. Verlauf, Cookies, alte Installer und Programm-Reste landen dagegen erst in der Quarantäne. Duplikate liegen im Windows-Papierkorb.</div>`;
  },
  show() { this.load(); },
  async load() {
    try {
      const d = await call("undo_list"); const st = d.stats || {};
      const qsize = d.sessions.reduce((a, q) => a + q.size, 0);
      $("#u-stats").innerHTML = [["Insgesamt freigegeben", human(st.freed_total || 0), `in ${st.cleanings || 0} Reinigungen`], ["In der Quarantäne", human(qsize), `${d.sessions.length} Vorgänge · ${d.days} Tage aufbewahrt`], ["Entfernte Apps", String(d.apps.length), "aus dem Store wiederherstellbar"]]
        .map(([k, v, x]) => `<div class="card stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${x}</div></div>`).join("");
      $("#u-q").innerHTML = d.sessions.length ? d.sessions.map(q => {
        const left = Math.max(0, Math.ceil((q.expires - Date.now() / 1000) / 86400));
        return `<div class="q"><div class="meta"><b>${esc(q.label)}</b> <span class="small dim">${fmtDate(q.time)} · ${q.count} Einträge · ${human(q.size)} · noch ${left} ${left === 1 ? "Tag" : "Tage"}</span><div class="sample">${q.sample.map(esc).join(" · ")}</div></div>
          <button class="btn sm primary" data-r="${esc(q.id)}">Wiederherstellen</button><button class="btn sm danger" data-d="${esc(q.id)}">Endgültig löschen</button></div>`;
      }).join("") : `<div class="empty card">Nichts in der Quarantäne.</div>`;
      $("#u-apps").innerHTML = d.apps.length ? d.apps.map(a => `<div class="q"><div class="meta"><b>${esc(a.label)}</b> <span class="small dim">entfernt am ${fmtDate(a.time)}</span></div><button class="btn sm" data-f="${esc(a.family)}">Im Store neu installieren</button></div>`).join("") : `<div class="empty card">Keine Apps entfernt.</div>`;
      $$("[data-r]", this.el).forEach(b => b.onclick = async () => { try { const r = await call("undo_restore", {id: b.dataset.r}); toast(`${r.restored} wiederhergestellt` + (r.failed.length ? ` · ${r.failed.length} fehlgeschlagen` : ""), r.failed.length ? "warn" : ""); this.load(); } catch (e) { err(e); } });
      $$("[data-d]", this.el).forEach(b => b.onclick = async () => { if (await confirmBox("Endgültig löschen?", "Diese Dateien können danach nicht mehr wiederhergestellt werden.", "Löschen", "danger")) { await call("undo_delete", {id: b.dataset.d}).catch(err); this.load(); } });
      $$("[data-f]", this.el).forEach(b => b.onclick = () => call("reinstall_app", {family: b.dataset.f}).then(() => toast("Microsoft Store wird geöffnet")).catch(err));
    } catch (e) { err(e); }
  },
};

