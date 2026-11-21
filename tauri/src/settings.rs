//! The settings that the app applies before the page loads, which is why they live here and not in the page's
//! storage: whether closing the window hides it to the tray, and whether the window's content is hidden from
//! screenshots. They persist in `desktop_settings.json` in the app data directory. Launching at login is the
//! system's own record (`tauri-plugin-autostart`), so it is read from the system.

use std::{
  fs, io,
  path::{Path, PathBuf},
  sync::{Mutex, MutexGuard, PoisonError},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::files::write_json_atomically;

const SETTINGS_FILE_NAME: &str = "desktop_settings.json";
/// The argument of the launch at login entry; a launch with it starts hidden in the tray
pub const AUTOSTART_ARG: &str = "--autostart";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct StoredSettings {
  pub should_close_to_tray: bool,
  pub is_content_protected: bool,
}

impl StoredSettings {
  fn unreadable() -> Self {
    Self {
      is_content_protected: true,
      ..Self::default()
    }
  }
}

impl Default for StoredSettings {
  fn default() -> Self {
    Self {
      should_close_to_tray: true,
      is_content_protected: false,
    }
  }
}

pub struct DesktopSettings {
  /// `None` keeps the settings in memory only
  storage_path: Option<PathBuf>,
  stored: Mutex<StoredSettings>,
}

impl DesktopSettings {
  pub fn load(storage_path: Option<PathBuf>) -> Self {
    let stored = storage_path
      .as_deref()
      .map_or_else(Default::default, read_stored);
    Self {
      storage_path,
      stored: Mutex::new(stored),
    }
  }

  pub fn get(&self) -> StoredSettings {
    *self.lock()
  }

  fn update(&self, apply: impl FnOnce(&mut StoredSettings)) {
    let mut stored = self.lock();
    apply(&mut stored);
    let Some(path) = &self.storage_path else {
      return;
    };
    if let Err(err) = write_json_atomically(path, &*stored) {
      log::error!("Failed to save the desktop settings: {err}");
    }
  }

  fn lock(&self) -> MutexGuard<'_, StoredSettings> {
    self.stored.lock().unwrap_or_else(PoisonError::into_inner)
  }
}

/// A missing file means the defaults. A file that cannot be read or parsed keeps the content hidden from screenshots,
/// which is the safe side when the user may have turned it on.
fn read_stored(path: &Path) -> StoredSettings {
  match fs::read(path) {
    Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|err| {
      log::error!("Failed to parse the desktop settings: {err}");
      StoredSettings::unreadable()
    }),
    Err(err) if err.kind() == io::ErrorKind::NotFound => StoredSettings::default(),
    Err(err) => {
      log::error!("Failed to read the desktop settings: {err}");
      StoredSettings::unreadable()
    }
  }
}

/// The path of the settings file in the app data directory
pub fn get_storage_path(app: &AppHandle) -> Option<PathBuf> {
  app
    .path()
    .app_data_dir()
    .ok()
    .map(|dir| dir.join(SETTINGS_FILE_NAME))
}

/// Whether the system started the app at login, which the autostart entry marks with [`AUTOSTART_ARG`]
pub fn is_autostart_launch(args: &[String]) -> bool {
  args.iter().any(|arg| arg == AUTOSTART_ARG)
}

/// What the page shows: the stored settings and the system's launch at login entry
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettingsInfo {
  #[serde(flatten)]
  stored: StoredSettings,
  should_launch_at_login: bool,
}

/// The settings to change; a field that is absent stays as it is
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettingsPatch {
  should_close_to_tray: Option<bool>,
  should_launch_at_login: Option<bool>,
  is_content_protected: Option<bool>,
}

#[tauri::command]
pub fn get_desktop_settings(app: AppHandle) -> DesktopSettingsInfo {
  build_info(&app)
}

#[tauri::command]
pub fn set_desktop_settings(
  app: AppHandle,
  patch: DesktopSettingsPatch,
) -> Result<DesktopSettingsInfo, String> {
  let settings = app.state::<DesktopSettings>();

  if let Some(should_close_to_tray) = patch.should_close_to_tray {
    settings.update(|stored| stored.should_close_to_tray = should_close_to_tray);
  }

  if let Some(is_content_protected) = patch.is_content_protected {
    // Applied first, so that a window that refuses leaves the stored value as it was
    for window in app.webview_windows().values() {
      window
        .set_content_protected(is_content_protected)
        .map_err(|err| err.to_string())?;
    }
    settings.update(|stored| stored.is_content_protected = is_content_protected);
  }

  if let Some(should_launch_at_login) = patch.should_launch_at_login {
    let autostart = app.autolaunch();
    let result = if should_launch_at_login {
      autostart.enable()
    } else {
      autostart.disable()
    };
    result.map_err(|err| err.to_string())?;
  }

  Ok(build_info(&app))
}

fn build_info(app: &AppHandle) -> DesktopSettingsInfo {
  let should_launch_at_login = app.autolaunch().is_enabled().unwrap_or_else(|err| {
    log::warn!("Failed to read the launch at login entry: {err}");
    false
  });
  DesktopSettingsInfo {
    stored: app.state::<DesktopSettings>().get(),
    should_launch_at_login,
  }
}
