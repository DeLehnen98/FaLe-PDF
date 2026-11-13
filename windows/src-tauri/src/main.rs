// FaLe PDF für Windows: ein Fenster um die Web-App https://pdf.fale.network/app/ (WebView2).
// - „Öffnen mit FaLe PDF“ / Doppelklick: die Datei wird gelesen und der App als [Name, Base64] übergeben
//   (window.__faleDesktopQueue + __faleDesktopOpen(), siehe js/platform.js) – auch wenn FaLe schon offen ist.
// - Nur die App selbst läuft im Fenster; jede andere Seite öffnet der Standardbrowser.
// - Das X (und Alt+F4) fragt zuerst die App: bei ungespeicherter Arbeit erscheint „Änderungen speichern?“
//   statt dass das Fenster zugeht und die Arbeit weg ist (__faleDesktopClose() in js/platform.js). Antwortet
//   die Seite ein paar Sekunden lang nicht, schließt das Fenster trotzdem – das X bleibt nie hängen.
// - Dateien lassen sich ins Fenster ziehen (die App nimmt sie selbst an); Größe und Platz des Fensters
//   werden gemerkt.
// - Keine Geheimnisse, keine Freischaltungen: FaLe Pro und KI prüft immer der Server.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use std::{path::Path, sync::Mutex, time::Duration};
use tauri::{webview::PageLoadEvent, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const START: &str = "https://pdf.fale.network/app/";
const MAX_FILE: u64 = 300 * 1024 * 1024; // larger files: open them from within the app instead
// Closing: the app answers with a page change to …/app/__desktop/wait („I am asking“) or …/close („close now“);
// both are caught in on_navigation and never loaded.
const SIGNAL: &str = "/app/__desktop/";
const CLOSE_JS: &str = "if (window.__faleDesktopClose) { window.__faleDesktopClose(); } else { location.href = 'https://pdf.fale.network/app/__desktop/close'; }";
const CLOSE_PATIENCE: Duration = Duration::from_millis(4000);

struct Pending(Mutex<Vec<String>>);

/// The latest close request and whether the app answered it.
#[derive(Default)]
struct Gate {
    seq: u64,
    answered: bool,
}
struct CloseGate(Mutex<Gate>);

/// „wait“ / „close“ when the URL is a message from the app about closing the window.
fn close_signal(url: &Url) -> Option<&str> {
    if url.scheme() == "https" && url.host_str() == Some("pdf.fale.network") {
        url.path().strip_prefix(SIGNAL)
    } else {
        None
    }
}

/// File paths among the command line arguments (Windows passes the file for „Öffnen mit“).
fn file_args(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-') && Path::new(a.as_str()).is_file())
        .cloned()
        .collect()
}

/// Inside the window: only the app on pdf.fale.network (and blank/blob pages it creates itself).
fn in_app(url: &Url) -> bool {
    match url.scheme() {
        "https" => url.host_str() == Some("pdf.fale.network") && url.path().starts_with("/app"),
        "about" | "blob" | "data" => true,
        _ => false,
    }
}

fn deliver(win: &WebviewWindow, files: Vec<String>) {
    for f in files {
        let p = Path::new(&f);
        if !std::fs::metadata(p).map(|m| m.len() <= MAX_FILE).unwrap_or(false) {
            continue;
        }
        let Ok(bytes) = std::fs::read(p) else { continue };
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Datei".into());
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        let js = format!(
            "(window.__faleDesktopQueue = window.__faleDesktopQueue || []).push([{}, {}]); if (window.__faleDesktopOpen) window.__faleDesktopOpen();",
            serde_json::to_string(&name).unwrap_or_else(|_| "\"Datei\"".into()),
            serde_json::to_string(&b64).unwrap_or_else(|_| "\"\"".into())
        );
        let _ = win.eval(&js);
    }
}

fn main() {
    let first: Vec<String> = file_args(&std::env::args().collect::<Vec<_>>());
    tauri::Builder::default()
        // a second start (e.g. double click on another PDF) hands the file to the open window
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
                deliver(&w, file_args(&argv));
            }
        }))
        // the window opens where and as large as it was left
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Pending(Mutex::new(first)))
        .manage(CloseGate(Mutex::new(Gate::default())))
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let Some(w) = app.get_webview_window("main") else { return };
                // only the app itself can be asked – an error page or a page that never loaded just closes
                let on_app = w.url().map(|u| u.scheme() == "https" && in_app(&u)).unwrap_or(false);
                if !on_app || w.eval(CLOSE_JS).is_err() {
                    return;
                }
                api.prevent_close();
                let seq = {
                    let gate = app.state::<CloseGate>();
                    let mut g = gate.0.lock().unwrap_or_else(|e| e.into_inner());
                    g.seq += 1;
                    g.answered = false;
                    let n = g.seq;
                    n
                };
                // no answer (page stuck or broken): close anyway, the X must always work
                let handle = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(CLOSE_PATIENCE);
                    let stuck = {
                        let gate = handle.state::<CloseGate>();
                        let g = gate.0.lock().unwrap_or_else(|e| e.into_inner());
                        let s = !g.answered && g.seq == seq;
                        s
                    };
                    if stuck {
                        handle.exit(0);
                    }
                });
            }
        })
        .setup(|app| {
            let start = Url::parse(START).expect("start url");
            let nav_handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(start))
                .title("FaLe PDF")
                .inner_size(1240.0, 840.0)
                .min_inner_size(420.0, 560.0)
                .center()
                // files dragged into the window go to the app (its own drop handling), not to the shell
                .disable_drag_drop_handler()
                .initialization_script(&format!(
                    "window.__FALE_DESKTOP__ = Object.freeze({{ version: '{}', os: 'windows' }});",
                    env!("CARGO_PKG_VERSION")
                ))
                .on_navigation(move |url| {
                    if let Some(cmd) = close_signal(url) {
                        {
                            let gate = nav_handle.state::<CloseGate>();
                            let mut g = gate.0.lock().unwrap_or_else(|e| e.into_inner());
                            g.answered = true;
                        }
                        if cmd == "close" {
                            let h = nav_handle.clone();
                            std::thread::spawn(move || h.exit(0));
                        }
                        return false;
                    }
                    if in_app(url) {
                        return true;
                    }
                    if matches!(url.scheme(), "https" | "http" | "mailto") {
                        let _ = open::that_detached(url.as_str());
                    }
                    false
                })
                .on_page_load(|win, payload| {
                    if payload.event() == PageLoadEvent::Finished {
                        let files = {
                            let st = win.state::<Pending>();
                            let mut g = st.0.lock().unwrap_or_else(|e| e.into_inner());
                            std::mem::take(&mut *g)
                        };
                        if !files.is_empty() {
                            deliver(&win, files);
                        }
                    }
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("FaLe PDF konnte nicht gestartet werden");
}
