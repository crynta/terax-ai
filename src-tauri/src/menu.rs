//! Localized native application menu (macOS).
//!
//! Tauri's default menu is hardcoded English. We rebuild it from the persisted
//! `language` preference (terax-settings.json) so the native menu bar follows
//! the in-app language choice. Standard editing items keep their predefined
//! actions (copy/paste/undo…) so shortcuts and behavior are preserved; only
//! their visible labels are localized.

#[cfg(target_os = "macos")]
use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Runtime};
#[cfg(target_os = "macos")]
use tauri_plugin_store::StoreExt;

/// Read the UI language from the settings store; defaults to "en".
#[cfg(target_os = "macos")]
fn current_language<R: Runtime>(app: &AppHandle<R>) -> String {
    if let Ok(store) = app.store("terax-settings.json") {
        if let Some(val) = store.get("language") {
            if let Some(s) = val.as_str() {
                return s.to_string();
            }
        }
    }
    "en".to_string()
}

/// Localized labels. `None` on a predefined item means "use the OS default
/// label" (correct for English on an English-locale system); `Some(..)` forces
/// the given text regardless of system locale.
#[cfg(target_os = "macos")]
struct Labels {
    file: &'static str,
    edit: &'static str,
    view: &'static str,
    window: &'static str,
    help: &'static str,
    about: Option<&'static str>,
    hide: Option<&'static str>,
    hide_others: Option<&'static str>,
    show_all: Option<&'static str>,
    quit: Option<&'static str>,
    close_window: Option<&'static str>,
    undo: Option<&'static str>,
    redo: Option<&'static str>,
    cut: Option<&'static str>,
    copy: Option<&'static str>,
    paste: Option<&'static str>,
    select_all: Option<&'static str>,
    fullscreen: Option<&'static str>,
    minimize: Option<&'static str>,
    maximize: Option<&'static str>,
}

#[cfg(target_os = "macos")]
fn labels(lang: &str) -> Labels {
    if lang == "zh-CN" {
        Labels {
            file: "文件",
            edit: "编辑",
            view: "视图",
            window: "窗口",
            help: "帮助",
            about: Some("关于 Terax"),
            hide: Some("隐藏 Terax"),
            hide_others: Some("隐藏其他"),
            show_all: Some("全部显示"),
            quit: Some("退出 Terax"),
            close_window: Some("关闭窗口"),
            undo: Some("撤销"),
            redo: Some("重做"),
            cut: Some("剪切"),
            copy: Some("复制"),
            paste: Some("粘贴"),
            select_all: Some("全选"),
            fullscreen: Some("切换全屏"),
            minimize: Some("最小化"),
            maximize: Some("缩放"),
        }
    } else {
        Labels {
            file: "File",
            edit: "Edit",
            view: "View",
            window: "Window",
            help: "Help",
            about: None,
            hide: None,
            hide_others: None,
            show_all: None,
            quit: None,
            close_window: None,
            undo: None,
            redo: None,
            cut: None,
            copy: None,
            paste: None,
            select_all: None,
            fullscreen: None,
            minimize: None,
            maximize: None,
        }
    }
}

/// Build the localized menu and set it as the application menu. No-op on
/// non-macOS platforms (they keep Tauri's default menu handling).
#[cfg(target_os = "macos")]
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let l = labels(&current_language(app));

    // First submenu becomes the macOS app menu; its title is overridden by the
    // process name ("Terax") by the OS, but its items are localized here.
    let app_menu = SubmenuBuilder::new(app, "Terax")
        .item(&PredefinedMenuItem::about(app, l.about, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, l.hide)?)
        .item(&PredefinedMenuItem::hide_others(app, l.hide_others)?)
        .item(&PredefinedMenuItem::show_all(app, l.show_all)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, l.quit)?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, l.file)
        .item(&PredefinedMenuItem::close_window(app, l.close_window)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, l.edit)
        .item(&PredefinedMenuItem::undo(app, l.undo)?)
        .item(&PredefinedMenuItem::redo(app, l.redo)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, l.cut)?)
        .item(&PredefinedMenuItem::copy(app, l.copy)?)
        .item(&PredefinedMenuItem::paste(app, l.paste)?)
        .item(&PredefinedMenuItem::select_all(app, l.select_all)?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, l.view)
        .item(&PredefinedMenuItem::fullscreen(app, l.fullscreen)?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, l.window)
        .item(&PredefinedMenuItem::minimize(app, l.minimize)?)
        .item(&PredefinedMenuItem::maximize(app, l.maximize)?)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, l.help).build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

/// Rebuild the native menu in the current language. Called from the frontend
/// whenever the language preference changes so the menu switches live.
#[tauri::command]
pub fn apply_menu_language<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return build_menu(&app).map_err(|e| e.to_string());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}
