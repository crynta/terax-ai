// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "macos")]
    {
        // Disable macOS press-and-hold character popup, so key repeat works in terminal.
        use objc2::msg_send;
        use objc2_foundation::{ns_string, NSUserDefaults};
        unsafe {
            let defaults = NSUserDefaults::standardUserDefaults();
            let key = ns_string!("ApplePressAndHoldEnabled");
            let _: () = msg_send![&defaults, setBool: false, forKey: key];
        }
    }

    terax_lib::run()
}
