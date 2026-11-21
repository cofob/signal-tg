//! The macOS menu bar: the app menu with Settings, Hide and Quit, Edit for the text fields, and Window. Tauri's
//! default menu has no Settings item and closes the window with Cmd+W, which would end the engine's window instead
//! of hiding it. Windows and Linux have no menu bar; the page handles Ctrl+Q there.

use tauri::{
  AppHandle, Emitter, Manager, Wry,
  menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
};

use crate::tray::translated_label;

pub const MENU_ITEM_SETTINGS_ID: &str = "open-settings";
pub const MENU_ITEM_HIDE_WINDOW_ID: &str = "hide-window";
const MENU_ITEM_HIDE_ID: &str = "hide";
const MENU_ITEM_QUIT_ID: &str = "quit-app";
const MENU_ITEM_EDIT_ID: &str = "edit";
const MENU_ITEM_UNDO_ID: &str = "undo";
const MENU_ITEM_REDO_ID: &str = "redo";
const MENU_ITEM_CUT_ID: &str = "cut";
const MENU_ITEM_COPY_ID: &str = "copy";
const MENU_ITEM_PASTE_ID: &str = "paste";
const MENU_ITEM_SELECT_ALL_ID: &str = "select-all";
const MENU_ITEM_WINDOW_ID: &str = "window";
const MENU_ITEM_MINIMIZE_ID: &str = "minimize";

/// Emitted to the page, which opens Settings
const OPEN_SETTINGS_EVENT: &str = "open-settings";

pub fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
  let label = |id: &str, default: &str| translated_label(id, default);
  let hide_label = label(MENU_ITEM_HIDE_ID, "Hide TeleSignal");
  let quit_label = label(MENU_ITEM_QUIT_ID, "Quit TeleSignal");
  let settings_label = label(MENU_ITEM_SETTINGS_ID, "Settings");
  let close_label = label(MENU_ITEM_HIDE_WINDOW_ID, "Close");

  let app_menu = Submenu::with_items(
    app,
    crate::DEFAULT_WINDOW_TITLE,
    true,
    &[
      &MenuItem::with_id(
        app,
        MENU_ITEM_SETTINGS_ID,
        &settings_label,
        true,
        Some("CmdOrCtrl+,"),
      )?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::hide(app, Some(&hide_label))?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::quit(app, Some(&quit_label))?,
    ],
  )?;

  let edit_menu = Submenu::with_items(
    app,
    label(MENU_ITEM_EDIT_ID, "Edit"),
    true,
    &[
      &PredefinedMenuItem::undo(app, Some(&label(MENU_ITEM_UNDO_ID, "Undo")))?,
      &PredefinedMenuItem::redo(app, Some(&label(MENU_ITEM_REDO_ID, "Redo")))?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::cut(app, Some(&label(MENU_ITEM_CUT_ID, "Cut")))?,
      &PredefinedMenuItem::copy(app, Some(&label(MENU_ITEM_COPY_ID, "Copy")))?,
      &PredefinedMenuItem::paste(app, Some(&label(MENU_ITEM_PASTE_ID, "Paste")))?,
      &PredefinedMenuItem::select_all(app, Some(&label(MENU_ITEM_SELECT_ALL_ID, "Select All")))?,
    ],
  )?;

  let window_menu = Submenu::with_items(
    app,
    label(MENU_ITEM_WINDOW_ID, "Window"),
    true,
    &[
      &PredefinedMenuItem::minimize(app, Some(&label(MENU_ITEM_MINIMIZE_ID, "Minimize")))?,
      &MenuItem::with_id(
        app,
        MENU_ITEM_HIDE_WINDOW_ID,
        &close_label,
        true,
        Some("CmdOrCtrl+W"),
      )?,
    ],
  )?;

  Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
}

/// Builds the menu again with the current labels
pub fn refresh(app: &AppHandle) {
  match build_app_menu(app) {
    Ok(menu) => {
      if let Err(err) = app.set_menu(menu) {
        log::warn!("Failed to set the app menu: {err}");
      }
    }
    Err(err) => log::warn!("Failed to build the app menu: {err}"),
  }
}

pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
  match event.id.as_ref() {
    MENU_ITEM_SETTINGS_ID => {
      crate::show_main_window(app);
      if let Err(err) = app.emit(OPEN_SETTINGS_EVENT, ()) {
        log::warn!("Failed to emit {OPEN_SETTINGS_EVENT}: {err}");
      }
    }
    // Cmd+W: the engine's window hides instead of closing, like the close button
    MENU_ITEM_HIDE_WINDOW_ID => {
      let windows = app.windows();
      if let Some(window) = windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
      {
        crate::hide_or_close_window(window);
      }
    }
    _ => {}
  }
}
