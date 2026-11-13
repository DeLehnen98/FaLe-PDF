// Firmen-Einstellungen für das Windows-Programm.
//
// Die IT legt eine kleine Datei auf den PC (per GPO-Dateiverteilung, Intune, Softwareverteilung oder von Hand):
//
//     %ProgramData%\FaLe PDF\policy.json          (meist C:\ProgramData\FaLe PDF\policy.json)
//
//     { "internet": false }                        alles aus, was Daten ins Internet sendet
//     { "cloudAi": false, "account": false }       oder einzeln
//
// Schlüssel (nur `false` schaltet etwas ab – alles andere lässt es, wie es ist):
//     cloudAi     Cloud-KI (Erklären, Übersetzen, Assistent)
//     post        Brief per Post und Fax
//     cloudShare  Sicher teilen, Dateien anfordern, Unterschrift anfordern, Übertragen
//     account     FaLe-Konto (Abgleich zwischen Geräten)
//     internet    alle vier auf einmal
//
// Das Programm liest die Datei beim Start und gibt der App nur die bekannten Schlüssel weiter
// (window.__FALE_DESKTOP__.policy, siehe js/policy.js). Ist die Datei da, aber nicht lesbar oder kein gültiges
// JSON, wird vorsichtshalber ALLES abgeschaltet („invalid“) – eine kaputte Datei darf nie heißen, dass nichts gilt.
//
// Gelesen wird an zwei Stellen: %ProgramData% (Umgebungsvariable) und fest C:\ProgramData. Was eine der beiden
// Dateien abschaltet, ist aus – wer das Programm mit einer anderen Umgebungsvariable startet, hebt damit nichts auf.
//
// Dieses Modul hängt nur von serde_json ab und wird in windows/policy-test geprüft (cargo test).

pub const KEYS: [&str; 4] = ["cloudAi", "post", "cloudShare", "account"];
pub const MAX_BYTES: u64 = 64 * 1024;

/// Text of the file: UTF-8 (with or without BOM) or UTF-16 with BOM (what „Out-File“ of Windows PowerShell writes).
pub fn decode(bytes: &[u8]) -> Option<String> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8(bytes[3..].to_vec()).ok();
    }
    if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        let le = bytes[0] == 0xFF;
        let body = &bytes[2..];
        if body.len() % 2 != 0 {
            return None;
        }
        let units: Vec<u16> = body
            .chunks_exact(2)
            .map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) })
            .collect();
        return String::from_utf16(&units).ok();
    }
    String::from_utf8(bytes.to_vec()).ok()
}

fn all_off(invalid: bool) -> String {
    let mut out = serde_json::Map::new();
    for k in KEYS {
        out.insert(k.to_string(), serde_json::Value::Bool(false));
    }
    if invalid {
        out.insert("invalid".to_string(), serde_json::Value::Bool(true));
    }
    serde_json::Value::Object(out).to_string()
}

/// The file's content reduced to what the app understands, as JSON object text – e.g. {"cloudAi":false}.
/// `None`: the file switches nothing off. A file that cannot be understood switches everything off.
pub fn clean(bytes: &[u8]) -> Option<String> {
    let Some(text) = decode(bytes) else { return Some(all_off(true)) };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text.trim()) else { return Some(all_off(true)) };
    let Some(obj) = value.as_object() else { return Some(all_off(true)) };
    if obj.get("internet").and_then(|x| x.as_bool()) == Some(false) {
        return Some(all_off(false));
    }
    let mut out = serde_json::Map::new();
    for k in KEYS {
        if obj.get(k).and_then(|x| x.as_bool()) == Some(false) {
            out.insert(k.to_string(), serde_json::Value::Bool(false));
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(serde_json::Value::Object(out).to_string())
    }
}

/// What the program found at `path`: `None` = no file (not managed), otherwise the cleaned settings.
pub fn from_file(path: &std::path::Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    if meta.len() > MAX_BYTES {
        return Some(all_off(true));
    }
    match std::fs::read(path) {
        Ok(bytes) => clean(&bytes),
        Err(_) => Some(all_off(true)),
    }
}

/// Several places (see main.rs): everything any of the files switches off is off. `None` = none of them does.
pub fn from_files(paths: &[std::path::PathBuf]) -> Option<String> {
    let mut out = serde_json::Map::new();
    for p in paths {
        let Some(text) = from_file(p) else { continue };
        let Ok(serde_json::Value::Object(obj)) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        for (k, v) in obj {
            out.insert(k, v);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(serde_json::Value::Object(out).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16le(s: &str) -> Vec<u8> {
        let mut v = vec![0xFF, 0xFE];
        for u in s.encode_utf16() {
            v.extend_from_slice(&u.to_le_bytes());
        }
        v
    }

    #[test]
    fn single_keys() {
        assert_eq!(clean(br#"{ "cloudAi": false }"#).as_deref(), Some(r#"{"cloudAi":false}"#));
        assert_eq!(clean(br#"{"post":false,"account":false}"#).as_deref(), Some(r#"{"account":false,"post":false}"#));
    }

    #[test]
    fn only_false_switches_off() {
        assert_eq!(clean(br#"{ "cloudAi": true, "post": "no", "cloudShare": 0, "account": null }"#), None);
        assert_eq!(clean(b"{}"), None);
    }

    #[test]
    fn internet_false_is_everything() {
        let all = r#"{"account":false,"cloudAi":false,"cloudShare":false,"post":false}"#;
        assert_eq!(clean(br#"{ "internet": false }"#).as_deref(), Some(all));
        assert_eq!(clean(br#"{ "internet": false, "cloudAi": true }"#).as_deref(), Some(all));
        assert_eq!(clean(br#"{ "internet": true, "post": false }"#).as_deref(), Some(r#"{"post":false}"#));
    }

    #[test]
    fn unknown_keys_are_dropped() {
        assert_eq!(clean(br#"{ "cloudAi": false, "pro": true, "x": { "y": 1 } }"#).as_deref(), Some(r#"{"cloudAi":false}"#));
        let out = clean(br#"{ "cloudAi": false, "</script><script>alert(1)</script>": false }"#).unwrap();
        assert!(!out.contains("script"));
    }

    #[test]
    fn broken_file_switches_everything_off() {
        let invalid = r#"{"account":false,"cloudAi":false,"cloudShare":false,"invalid":true,"post":false}"#;
        assert_eq!(clean(b"{ cloudAi: false }").as_deref(), Some(invalid));
        assert_eq!(clean(b"").as_deref(), Some(invalid));
        assert_eq!(clean(b"[false]").as_deref(), Some(invalid));
        assert_eq!(clean(&[0xFF, 0xFE, 0x41]).as_deref(), Some(invalid));
        assert_eq!(clean(&[0xC3, 0x28]).as_deref(), Some(invalid));
    }

    #[test]
    fn encodings() {
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice(br#"{ "post": false }"#);
        assert_eq!(clean(&bom).as_deref(), Some(r#"{"post":false}"#));
        assert_eq!(clean(&utf16le("{ \"internet\": false }\r\n")).is_some(), true);
        assert_eq!(clean(&utf16le("{ \"account\": false }")).as_deref(), Some(r#"{"account":false}"#));
        assert_eq!(clean(b"\r\n  { \"cloudShare\": false }  \r\n").as_deref(), Some(r#"{"cloudShare":false}"#));
    }

    #[test]
    fn files() {
        let dir = std::env::temp_dir().join(format!("fale-policy-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("policy.json");
        assert_eq!(from_file(&p), None); // no file: not managed
        std::fs::write(&p, br#"{ "internet": false }"#).unwrap();
        assert!(from_file(&p).unwrap().contains(r#""cloudShare":false"#));
        std::fs::write(&p, vec![b' '; (MAX_BYTES + 1) as usize]).unwrap();
        assert!(from_file(&p).unwrap().contains(r#""invalid":true"#)); // far too large: not ours → everything off
        assert_eq!(from_file(&dir), None); // a folder is not a file
        // two places: what either one switches off is off – a second, laxer file cannot lift the first
        let q = dir.join("other.json");
        std::fs::write(&p, br#"{ "cloudAi": false }"#).unwrap();
        std::fs::write(&q, br#"{ "post": false, "cloudAi": true }"#).unwrap();
        let missing = dir.join("missing.json");
        assert_eq!(from_files(&[missing.clone(), p.clone(), q.clone()]).as_deref(), Some(r#"{"cloudAi":false,"post":false}"#));
        assert_eq!(from_files(&[q.clone(), p.clone()]).as_deref(), Some(r#"{"cloudAi":false,"post":false}"#));
        assert_eq!(from_files(&[missing.clone()]), None);
        assert_eq!(from_files(&[]), None);
        std::fs::write(&q, b"not json").unwrap();
        assert!(from_files(&[p.clone(), q.clone()]).unwrap().contains(r#""invalid":true"#));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
