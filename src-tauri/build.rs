// The app's own commands (see main.rs) are only reachable from the page, a remote origin on 127.0.0.1, with an
// app manifest: each command gets an `allow-…` permission, granted in capabilities/default.json.
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "export_diagnostics",
            "open_window",
            "pause_server",
            "resume_server",
            "take_opened_files",
        ]),
    ))
    .expect("failed to run tauri-build");
}
