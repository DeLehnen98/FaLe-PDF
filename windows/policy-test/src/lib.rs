// The module under test lives in the program itself; this crate only gives it a place to run its tests
// without building the whole Windows program.
#[path = "../../src-tauri/src/policy.rs"]
pub mod policy;
