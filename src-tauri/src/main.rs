// Desktop shell of Colwerk. The app itself is served by the sidecar `colwerk-server` (launcher/main.ts, a Node
// single executable next to this binary) on 127.0.0.1; this shell shows the window, which the page fills with
// native menus and dialogs through Tauri's JS API (app/utils/desktop.ts).
//
// Startup: the sidecar starts first, then the window opens with a blank page (splash/), so both start up at the
// same time. Once it listens, the sidecar prints `Colwerk: <url>` with the session token in the fragment, and the
// window navigates there.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_window_state::StateFlags;

/// The running sidecar; taken on exit.
struct Server(Mutex<Option<Child>>);

/// Set once the app exits, when the sidecar ending is expected.
static EXITING: AtomicBool = AtomicBool::new(false);

fn main() {
    tauri::Builder::default()
        // Without VISIBLE: the window stays hidden until the app has loaded (see below), not shown on restore.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            let server = start_server(app.handle());
            // Size and position of the last run are restored by the window-state plugin. The window is shown
            // once the app page (not the splash) has loaded, in the chosen color mode, so neither the blank
            // native window nor the splash in the system's color mode flashes up before it.
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Colwerk")
                    .inner_size(1400.0, 900.0)
                    .visible(false)
                    .on_page_load(|window, payload| {
                        if payload.event() == PageLoadEvent::Finished
                            && payload.url().path() != "/index.html"
                        {
                            let _ = window.show();
                        }
                    })
                    .build()?;
            let handle = app.handle().clone();
            thread::spawn(move || {
                if let Err(message) = server.and_then(|stdout| show_server(&window, stdout))
                    && !EXITING.load(Ordering::SeqCst)
                {
                    handle
                        .dialog()
                        .message(message)
                        .kind(MessageDialogKind::Error)
                        .title("Colwerk")
                        .blocking_show();
                    handle.exit(1);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start Colwerk")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_server(app);
            }
        });
}

/// Starts the sidecar; resolves with its stdout, or `None` in development (`bun run dev --desktop`), where the
/// Nuxt dev server at COLWERK_URL takes its place.
fn start_server(app: &AppHandle) -> Result<Option<ChildStdout>, String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("COLWERK_URL").is_some() {
        return Ok(None);
    }
    let exe = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name(format!("colwerk-server{}", std::env::consts::EXE_SUFFIX));
    let mut command = Command::new(&exe);
    // The sidecar ends when its stdin closes, so it does not outlive the app even if the app crashes.
    command
        .env("COLWERK_DESKTOP", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("{}: {e}", exe.display()))?;
    let stdout = child.stdout.take();
    app.state::<Server>().0.lock().unwrap().replace(child);
    Ok(stdout)
}

/// Navigates the window to the server once it listens; returns when the sidecar has ended (always an error).
fn show_server(window: &WebviewWindow, stdout: Option<ChildStdout>) -> Result<(), String> {
    let navigate = |url: &str| {
        window
            .navigate(url.parse().map_err(|e| format!("{url}: {e}"))?)
            .map_err(|e| e.to_string())
    };
    let Some(stdout) = stdout else {
        return navigate(&std::env::var("COLWERK_URL").unwrap_or_default());
    };
    // Everything else the sidecar prints is passed through, as a log.
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|e| e.to_string())?;
        println!("{line}");
        if let Some(url) = line.trim().strip_prefix("Colwerk: ") {
            navigate(url)?;
        }
    }
    Err("The Colwerk server stopped unexpectedly.".into())
}

/// Closes the sidecar's stdin, so it ends on its own and removes its instance file; killed if that takes too long.
fn stop_server(app: &AppHandle) {
    EXITING.store(true, Ordering::SeqCst);
    let Some(mut child) = app.state::<Server>().0.lock().unwrap().take() else {
        return;
    };
    drop(child.stdin.take());
    for _ in 0..20 {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
}
