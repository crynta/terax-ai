// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
fn configure_linux_webkit_env() {
    const NV_EXPLICIT_SYNC: &str = "__NV_DISABLE_EXPLICIT_SYNC";
    const TERAX_SET_NV_EXPLICIT_SYNC: &str = "TERAX_SET_NV_DISABLE_EXPLICIT_SYNC";

    let is_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some()
        || std::env::var("XDG_SESSION_TYPE")
            .is_ok_and(|session| session.eq_ignore_ascii_case("wayland"));
    let has_nvidia_driver = std::path::Path::new("/sys/module/nvidia").exists();

    if is_wayland && has_nvidia_driver && std::env::var_os(NV_EXPLICIT_SYNC).is_none() {
        // On NVIDIA/Wayland, WebKitGTK can crash with GDK protocol errors when
        // explicit sync is enabled. This keeps WebKit's DMABUF renderer active,
        // avoiding the input/render latency caused by disabling DMABUF.
        std::env::set_var(NV_EXPLICIT_SYNC, "1");
        std::env::set_var(TERAX_SET_NV_EXPLICIT_SYNC, "1");
    }
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_webkit_env() {}

fn main() {
    configure_linux_webkit_env();
    terax_lib::run()
}
