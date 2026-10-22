// FaLe PDF für Windows: ein Fenster um die Web-App https://pdf.fale.network/app/ (WebView2).
// - „Öffnen mit FaLe PDF“ / Doppelklick: die Datei wird gelesen und der App als [Name, Base64] übergeben
//   (window.__faleDesktopQueue + __faleDesktopOpen(), siehe js/platform.js) – auch wenn FaLe schon offen ist.
// - Nur die App selbst läuft im Fenster; jede andere Seite öffnet der Standardbrowser.
// - Keine Geheimnisse, keine Freischaltungen: FaLe Pro und KI prüft immer der Server.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use std::{path::Path, sync::Mutex};
use tauri::{webview::PageLoadEvent, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const START: &str = "https://pdf.fale.network/app/";
const MAX_FILE: u64 = 300 * 1024 * 1024; // larger files: open them from within the app instead

struct Pending(Mutex<Vec<String>>);

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
        .manage(Pending(Mutex::new(first)))
        .setup(|app| {
            let start = Url::parse(START).expect("start url");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(start))
                .title("FaLe PDF")
                .inner_size(1240.0, 840.0)
                .min_inner_size(420.0, 560.0)
                .center()
                .initialization_script(&format!(
                    "window.__FALE_DESKTOP__ = Object.freeze({{ version: '{}', os: 'windows' }});",
                    env!("CARGO_PKG_VERSION")
                ))
                .on_navigation(|url| {
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
