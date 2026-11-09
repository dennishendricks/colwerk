// Desktop shell of Colwerk. The app itself is served by the sidecar `colwerk-server` (launcher/main.ts, a Node
// single executable next to this binary) on 127.0.0.1; this shell shows the window, which the page fills with
// native menus and dialogs through Tauri's JS API (app/utils/desktop.ts).
//
// Startup: the sidecar starts first, then the window opens with a blank page (splash/), so both start up at the
// same time. Once it listens, the sidecar prints `Colwerk: <url>` with the session token in the fragment, and the
// window navigates there.
//
// Logging: everything the sidecar prints (stdout and stderr) and the shell's own events go to a rotating log file in
// `logs/` of the data directory (core/data-dir.ts), without the session token.
//
// Supervision: a health check requests the server's page regularly; a sidecar that stops answering is killed. A
// sidecar that ends while the app runs is restarted (a few times within a while), and the window navigates to its
// new URL; beyond that limit the app shows an error naming the log file and quits.
//
// Diagnostics: `export_diagnostics` (Help menu) writes the app version, system, sidecar state and log files to one
// text file, for bug reports.
//
// Updates: tauri-plugin-updater, driven by the page (app/utils/update.ts). On Windows the installer replaces
// `colwerk-server.exe`, which must not be running then: the page stops it with `pause_server` before installing,
// and `resume_server` starts it again if the installation fails.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fmt::Write as _;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use tauri_plugin_window_state::StateFlags;

/// The running sidecar with the number of its start (see `watch_health`); the child is taken on exit.
struct Server(Mutex<(Option<Child>, u32)>);

/// Set once the app exits, when the sidecar ending is expected.
static EXITING: AtomicBool = AtomicBool::new(false);

/// Set while an update is installed (`pause_server`): the stopped sidecar is not restarted until `resume_server`.
static PAUSED: Mutex<bool> = Mutex::new(false);
static RESUMED: Condvar = Condvar::new();

/// Restarts since the app started.
static RESTARTS: AtomicU32 = AtomicU32::new(0);

/// More restarts than this within `RESTART_WINDOW` end the app.
const MAX_RESTARTS: usize = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(300);

/// A sidecar that has not answered for `HEALTH_FAILURES` checks in a row (about two minutes) is considered hung.
/// Lenient, since a busy event loop (e.g. a large export) may delay the answer for a while.
const HEALTH_INTERVAL: Duration = Duration::from_secs(20);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(10);
const HEALTH_FAILURES: u32 = 4;

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Server(Mutex::new((None, 0))))
        .invoke_handler(tauri::generate_handler![
            export_diagnostics,
            pause_server,
            resume_server
        ])
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::new()
                    .clear_targets()
                    .target(Target::new(TargetKind::Stdout))
                    .target(Target::new(TargetKind::Folder {
                        path: log_dir(app.handle()),
                        file_name: Some("colwerk".into()),
                    }))
                    .level(log::LevelFilter::Info)
                    .max_file_size(5_000_000)
                    .rotation_strategy(RotationStrategy::KeepSome(3))
                    .build(),
            )?;
            log::info!("Colwerk {} started", app.package_info().version);
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
                if let Err(message) = supervise(&handle, &window)
                    && !EXITING.load(Ordering::SeqCst)
                {
                    log::error!("{message}");
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
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
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
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || log_lines(stderr, log::Level::Warn));
    }
    log::info!("server started (pid {})", child.id());
    let state = app.state::<Server>();
    let mut server = state.0.lock().unwrap();
    *server = (Some(child), server.1 + 1);
    Ok(stdout)
}

/// Starts the sidecar and shows it in the window; restarts it when it ends while the app runs. Returns when the app
/// exits, or with the message to show when the sidecar cannot be started or keeps ending.
fn supervise(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let mut restarts: Vec<Instant> = Vec::new();
    loop {
        let Some(stdout) = start_server(app)? else {
            return navigate(window, &std::env::var("COLWERK_URL").unwrap_or_default());
        };
        show_server(app, window, stdout)?;
        let child = app.state::<Server>().0.lock().unwrap().0.take();
        if let Some(mut child) = child {
            match child.wait() {
                Ok(status) => log::warn!("server ended: {status}"),
                Err(e) => log::warn!("server ended: {e}"),
            }
        }
        if EXITING.load(Ordering::SeqCst) {
            return Ok(());
        }
        {
            let mut paused = PAUSED.lock().unwrap();
            if *paused {
                while *paused && !EXITING.load(Ordering::SeqCst) {
                    paused = RESUMED.wait(paused).unwrap();
                }
                if EXITING.load(Ordering::SeqCst) {
                    return Ok(());
                }
                continue;
            }
        }
        restarts.retain(|t| t.elapsed() < RESTART_WINDOW);
        if restarts.len() >= MAX_RESTARTS {
            return Err(format!(
                "The Colwerk server stopped unexpectedly.\n\nDetails are in the log: {}",
                log_dir(app).display()
            ));
        }
        restarts.push(Instant::now());
        RESTARTS.fetch_add(1, Ordering::SeqCst);
        log::warn!("restarting server ({}/{MAX_RESTARTS})", restarts.len());
    }
}

fn navigate(window: &WebviewWindow, url: &str) -> Result<(), String> {
    window
        .navigate(url.parse().map_err(|e| format!("{url}: {e}"))?)
        .map_err(|e| e.to_string())
}

/// Navigates the window to the server once it listens and starts its health check; returns when the sidecar's
/// stdout closes (it ended or was killed).
fn show_server(app: &AppHandle, window: &WebviewWindow, stdout: ChildStdout) -> Result<(), String> {
    let start = app.state::<Server>().0.lock().unwrap().1;
    // Everything else the sidecar prints goes to the log.
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        log::info!("server: {}", redact(&line));
        if let Some(url) = line.trim().strip_prefix("Colwerk: ") {
            navigate(window, url)?;
            if let Some(port) = url.parse::<tauri::Url>().ok().and_then(|u| u.port()) {
                let app = app.clone();
                thread::spawn(move || watch_health(&app, port, start));
            }
        }
    }
    Ok(())
}

/// Checks the sidecar of the given start regularly and kills it once it has stopped answering; ends with it.
fn watch_health(app: &AppHandle, port: u16, start: u32) {
    let state = app.state::<Server>();
    let mut failures = 0;
    loop {
        thread::sleep(HEALTH_INTERVAL);
        let current = || {
            let server = state.0.lock().unwrap();
            server.1 == start && server.0.is_some()
        };
        if EXITING.load(Ordering::SeqCst) || !current() {
            return;
        }
        if responds(port) {
            failures = 0;
            continue;
        }
        failures += 1;
        log::warn!("server did not answer the health check ({failures}/{HEALTH_FAILURES})");
        if failures >= HEALTH_FAILURES {
            let mut server = state.0.lock().unwrap();
            if server.1 == start
                && let Some(child) = server.0.as_mut()
            {
                log::error!("server hangs, ending it");
                let _ = child.kill();
            }
            return;
        }
    }
}

/// Any HTTP answer counts: the page itself needs the token, but an answer shows that the server works.
fn responds(port: u16) -> bool {
    let probe = || -> std::io::Result<bool> {
        let mut stream =
            TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), HEALTH_TIMEOUT)?;
        stream.set_read_timeout(Some(HEALTH_TIMEOUT))?;
        stream.set_write_timeout(Some(HEALTH_TIMEOUT))?;
        write!(
            stream,
            "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
        )?;
        let mut head = [0; 5];
        stream.read_exact(&mut head)?;
        Ok(&head == b"HTTP/")
    };
    probe().unwrap_or(false)
}

/// The data directory of core/data-dir.ts: `COLWERK_DATA_DIR`, otherwise `colwerk` in the platform's config
/// directory (`~/Library/Application Support`, `%APPDATA%`, `$XDG_CONFIG_HOME` or `~/.config`).
fn data_dir(app: &AppHandle) -> PathBuf {
    std::env::var_os("COLWERK_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| app.path().config_dir().ok().map(|dir| dir.join("colwerk")))
        .unwrap_or_else(|| PathBuf::from("colwerk"))
}

fn log_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("logs")
}

/// Logs each line of the sidecar's `stream` (stderr) until it closes.
fn log_lines(stream: impl Read, level: log::Level) {
    for line in BufReader::new(stream).lines().map_while(Result::ok) {
        log::log!(level, "server: {}", redact(&line));
    }
}

/// The session token travels in the URL fragment (`#token=…`) and must not end up in the log.
fn redact(line: &str) -> String {
    match line.find("#token=") {
        Some(at) => format!("{}#token=<redacted>", &line[..at]),
        None => line.to_string(),
    }
}

/// Writes version, system, sidecar state and the log files (oldest first) to `path`. The logs hold no session
/// token, but may hold SQL and error messages of the server.
#[tauri::command]
fn export_diagnostics(app: AppHandle, path: PathBuf) -> Result<(), String> {
    let running = {
        let state = app.state::<Server>();
        let mut server = state.0.lock().unwrap();
        server
            .0
            .as_mut()
            .is_some_and(|child| matches!(child.try_wait(), Ok(None)))
    };
    let mut out = String::new();
    let _ = writeln!(out, "Colwerk {}", app.package_info().version);
    let _ = writeln!(
        out,
        "System: {} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    let _ = writeln!(out, "Data directory: {}", data_dir(&app).display());
    let _ = writeln!(
        out,
        "Server: {}, restarts: {}",
        if running { "running" } else { "not running" },
        RESTARTS.load(Ordering::SeqCst)
    );
    let mut logs: Vec<PathBuf> = std::fs::read_dir(log_dir(&app))
        .map(|dir| dir.filter_map(Result::ok).map(|e| e.path()).collect())
        .unwrap_or_default();
    logs.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
    for log in logs {
        let text = std::fs::read(&log).map_err(|e| format!("{}: {e}", log.display()))?;
        let name = log.file_name().unwrap_or_default().to_string_lossy();
        let _ = write!(
            out,
            "\n===== {name} =====\n{}",
            String::from_utf8_lossy(&text)
        );
    }
    std::fs::write(&path, out).map_err(|e| format!("{}: {e}", path.display()))
}

/// Ends the sidecar as the app exits.
fn stop_server(app: &AppHandle) {
    EXITING.store(true, Ordering::SeqCst);
    RESUMED.notify_all();
    end_server(app);
}

/// Stops the sidecar for the update installer (Windows), without restarting it.
#[tauri::command]
fn pause_server(app: AppHandle) {
    log::info!("stopping server for the update");
    *PAUSED.lock().unwrap() = true;
    end_server(&app);
}

/// Starts the sidecar again after a failed update; the window navigates to it.
#[tauri::command]
fn resume_server(error: String) {
    log::warn!("update failed, restarting server: {error}");
    *PAUSED.lock().unwrap() = false;
    RESUMED.notify_all();
}

/// Closes the sidecar's stdin, so it ends on its own and removes its instance file; killed if that takes too long.
fn end_server(app: &AppHandle) {
    let Some(mut child) = app.state::<Server>().0.lock().unwrap().0.take() else {
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
