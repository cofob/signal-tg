//! Saving, opening and revealing the files that the page downloads. The page holds an attachment as
//! a blob in memory, and webview downloads of blobs are unreliable (WKWebView), so it sends the
//! bytes to these commands: `begin_file_save`, `write_file_chunk`, then `finish_file_save`.
//!
//! Rust decides the destination. The file name is sanitized, the file lands in the system Downloads
//! folder under a free name, or at the path that the user picks in the native save dialog, and the
//! bytes go to a temporary file in that directory first. A saved file is recorded under the key
//! that the page names, and the record persists in the app data directory. `open_saved_file` and
//! `reveal_saved_file` act only on those records, so the page cannot open an arbitrary path. Opening
//! a file of a dangerous type asks for confirmation in a native dialog, which the page cannot skip.

use std::{
  collections::HashMap,
  fs::{self, File, OpenOptions},
  io::{self, Write},
  path::{Path, PathBuf},
  sync::{
    Arc, Mutex, MutexGuard, PoisonError,
    atomic::{AtomicU32, Ordering},
  },
  time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{
  AppHandle, Emitter, Manager, WebviewWindow,
  ipc::{InvokeBody, Request},
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

/// The header of `write_file_chunk` that names its save, as the body holds the raw bytes
const SAVE_ID_HEADER: &str = "save-id";
/// Emitted to every window with a [`SavedFilesChange`] when records appear or disappear
const SAVED_FILES_EVENT: &str = "saved-files-changed";
const SAVED_FILES_FILE_NAME: &str = "saved_files.json";
const FALLBACK_FILE_NAME: &str = "file";
const DOWNLOADS_FOLDER_NAME: &str = "Downloads";
const TEMP_FILE_SUFFIX: &str = "part";
/// Most file systems limit a name to 255 bytes; the room left is for ` (N)` and the temporary suffix
const MAX_FILE_NAME_BYTES: usize = 200;
const MAX_EXTENSION_BYTES: usize = 32;
const MAX_KEY_BYTES: usize = 512;
const MAX_PENDING_SAVES: usize = 16;
const MAX_SAVED_FILES: usize = 5000;
const UNKNOWN_SAVE_ERROR: &str = "Unknown save";
const FALLBACK_LANGUAGE: &str = "en";
/// Characters that Windows forbids in names; replacing them everywhere keeps files portable
const FORBIDDEN_NAME_CHARS: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
/// Names that Windows reserves for devices, with any extension
const RESERVED_NAMES: &[&str] = &[
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "CONIN$",
  "CONOUT$",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "COM\u{B9}",
  "COM\u{B2}",
  "COM\u{B3}",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
  "LPT\u{B9}",
  "LPT\u{B2}",
  "LPT\u{B3}",
];
/// Extensions of files that can run code or change the system when opened. The first group is the
/// list of Signal Desktop (`ts/util/isFileDangerous.std.ts`); the others add the types of macOS and
/// Linux, scripts, installers, disk images and Office files with macros, which that list lacks.
const DANGEROUS_EXTENSIONS: &[&str] = &[
  "ade",
  "adp",
  "apk",
  "bat",
  "cab",
  "chm",
  "cmd",
  "com",
  "cpl",
  "diagcab",
  "dll",
  "dmg",
  "exe",
  "hta",
  "inf",
  "ins",
  "isp",
  "jar",
  "js",
  "jse",
  "lib",
  "lnk",
  "mde",
  "mht",
  "msc",
  "msi",
  "msp",
  "mst",
  "nsh",
  "pif",
  "ps1",
  "psc1",
  "psm1",
  "psrc",
  "reg",
  "scr",
  "sct",
  "settingcontent-ms",
  "shb",
  "sys",
  "vb",
  "vbe",
  "vbs",
  "vxd",
  "wsc",
  "wsf",
  "wsh",
  // Not in Signal Desktop's list
  "app",
  "appimage",
  "applescript",
  "bash",
  "command",
  "csh",
  "deb",
  "desktop",
  "jnlp",
  "ksh",
  "mpkg",
  "pkg",
  "rpm",
  "run",
  "scpt",
  "scptd",
  "sh",
  "terminal",
  "tool",
  "url",
  "workflow",
  "zsh",
  // Disk images, installers and Windows app packages
  "appinstaller",
  "application",
  "appx",
  "appxbundle",
  "gadget",
  "img",
  "iso",
  "msix",
  "msixbundle",
  "ocx",
  "scf",
  "vhd",
  "vhdx",
  "xll",
  // Scripts, and shortcuts and macOS bundles that run or open something
  "action",
  "fileloc",
  "inetloc",
  "pl",
  "prefpane",
  "py",
  "pyw",
  "rb",
  "saver",
  "webloc",
  // Office files with macros
  "docm",
  "pptm",
  "xlsm",
];

/// Characters that reorder text, have no width or show as blanks, which could disguise a file's name
fn is_invisible_char(c: char) -> bool {
  matches!(
    c,
    '\u{00AD}'
      | '\u{034F}'
      | '\u{061C}'
      | '\u{115F}'
      | '\u{1160}'
      | '\u{180E}'
      | '\u{200B}'..='\u{200F}'
      | '\u{202A}'..='\u{202E}'
      | '\u{2060}'..='\u{2064}'
      | '\u{2066}'..='\u{206F}'
      | '\u{2800}'
      | '\u{3164}'
      | '\u{FEFF}'
      | '\u{FFA0}'
  )
}

/// Turns a name from a message into one file name: no path separators or `..`, no control, bidi or
/// zero-width characters, no characters or trailing dots and spaces that Windows rejects, no
/// reserved Windows device names, and at most [`MAX_FILE_NAME_BYTES`] bytes with the extension kept
pub fn sanitize_file_name(name: &str) -> String {
  let replaced: String = name
    .chars()
    .filter(|c| !c.is_control() && !is_invisible_char(*c))
    .map(|c| {
      if FORBIDDEN_NAME_CHARS.contains(&c) {
        '_'
      } else {
        c
      }
    })
    .collect();
  let trimmed = replaced
    .trim_start()
    .trim_end_matches(|c: char| c == '.' || c.is_whitespace());
  if trimmed.is_empty() {
    return FALLBACK_FILE_NAME.to_string();
  }

  let (stem, extension) = split_extension(trimmed);
  let extension = truncate_to_bytes(extension, MAX_EXTENSION_BYTES);
  let stem = truncate_to_bytes(stem, MAX_FILE_NAME_BYTES.saturating_sub(extension.len()));
  let stem = stem.trim_end_matches(|c: char| c == '.' || c.is_whitespace());

  // Windows reserves `CON.tar.gz` as well as `CON`, and ignores spaces before the first dot
  let base = stem.split('.').next().unwrap_or_default().trim_end();
  let is_reserved = RESERVED_NAMES
    .iter()
    .any(|reserved| base.eq_ignore_ascii_case(reserved));
  let prefix = if is_reserved { "_" } else { "" };

  if stem.is_empty() {
    // Only dots stood before the extension, as in `...txt`
    return format!("{FALLBACK_FILE_NAME}{extension}");
  }
  format!("{prefix}{stem}{extension}")
}

/// Splits `archive.tar.gz` into `archive.tar` and `.gz`; a leading dot does not start an extension
fn split_extension(name: &str) -> (&str, &str) {
  match name.rfind('.') {
    Some(index) if index > 0 => name.split_at(index),
    _ => (name, ""),
  }
}

fn truncate_to_bytes(text: &str, max_bytes: usize) -> &str {
  if text.len() <= max_bytes {
    return text;
  }
  let mut end = max_bytes;
  while !text.is_char_boundary(end) {
    end -= 1;
  }
  &text[..end]
}

/// `report.pdf` with the number 2 is `report (2).pdf`
fn numbered_file_name(file_name: &str, number: u32) -> String {
  let (stem, extension) = split_extension(file_name);
  format!("{stem} ({number}){extension}")
}

/// The text after the last dot, which Windows and the file managers take for the extension even in
/// `.exe`; Windows also ignores dots and spaces at the end. Empty when the name has no dot.
fn get_extension(file_name: &str) -> &str {
  let name = file_name.trim_end_matches(|c: char| c == '.' || c.is_whitespace());
  name.rsplit_once('.').map_or("", |(_, extension)| extension)
}

/// Whether opening the file can run code, judged by its extension like Signal Desktop does
/// (`ts/util/isFileDangerous.std.ts`)
pub fn is_file_dangerous(file_name: &str) -> bool {
  let extension = get_extension(file_name).to_ascii_lowercase();
  DANGEROUS_EXTENSIONS.contains(&extension.as_str())
}

/// Creates an empty file named `file_name` in `dir`, or `file_name (1)`, `file_name (2)` and so on
/// when the name is taken, and returns its path. `create_new` makes the claim atomic.
fn claim_unique_path(dir: &Path, file_name: &str) -> io::Result<PathBuf> {
  for number in 0..=u32::MAX {
    let candidate_name = if number == 0 {
      file_name.to_string()
    } else {
      numbered_file_name(file_name, number)
    };
    let candidate = dir.join(candidate_name);
    // The sanitized name has no separators, so the file stays directly in `dir`
    assert_eq!(candidate.parent(), Some(dir));
    match OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&candidate)
    {
      Ok(_) => return Ok(candidate),
      Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
      Err(err) => return Err(err),
    }
  }
  Err(io::Error::new(
    io::ErrorKind::AlreadyExists,
    "No free file name",
  ))
}

fn is_regular_file(path: &Path) -> bool {
  fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file())
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
  mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn unix_time() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_or(0, |duration| duration.as_secs())
}

#[derive(Clone, Serialize, Deserialize)]
struct SavedFileEntry {
  path: PathBuf,
  saved_at: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct SavedFilesData {
  files: HashMap<String, SavedFileEntry>,
}

/// The files that this app saved, by the key that the page named. The only paths that
/// `open_saved_file` and `reveal_saved_file` accept are those in here.
struct SavedFiles {
  /// `None` keeps the records in memory only
  storage_path: Option<PathBuf>,
  data: Mutex<SavedFilesData>,
}

impl SavedFiles {
  fn load(storage_path: Option<PathBuf>) -> Self {
    let data = storage_path
      .as_deref()
      .and_then(|path| fs::read(path).ok())
      .and_then(|bytes| serde_json::from_slice(&bytes).ok())
      .unwrap_or_default();
    Self {
      storage_path,
      data: Mutex::new(data),
    }
  }

  fn get_path(&self, key: &str) -> Option<PathBuf> {
    lock(&self.data)
      .files
      .get(key)
      .map(|entry| entry.path.clone())
  }

  /// Records a saved file and returns the keys that the size limit pushed out
  fn insert(&self, key: String, path: PathBuf) -> Vec<String> {
    let mut data = lock(&self.data);
    data.files.insert(
      key,
      SavedFileEntry {
        path,
        saved_at: unix_time(),
      },
    );

    let mut evicted = Vec::new();
    while data.files.len() > MAX_SAVED_FILES {
      let Some(oldest) = data
        .files
        .iter()
        .min_by_key(|(_, entry)| entry.saved_at)
        .map(|(key, _)| key.clone())
      else {
        break;
      };
      data.files.remove(&oldest);
      evicted.push(oldest);
    }

    self.persist(&data);
    evicted
  }

  /// Drops every record and returns their keys
  fn clear(&self) -> Vec<String> {
    let mut data = lock(&self.data);
    let keys = data.files.drain().map(|(key, _)| key).collect();
    self.persist(&data);
    keys
  }

  fn remove(&self, key: &str) {
    let mut data = lock(&self.data);
    if data.files.remove(key).is_some() {
      self.persist(&data);
    }
  }

  /// Drops the records of files that are gone and returns the keys of the others and the dropped ones
  fn prune(&self) -> (Vec<String>, Vec<String>) {
    let mut data = lock(&self.data);
    let mut kept = Vec::new();
    let mut removed = Vec::new();
    for (key, entry) in &data.files {
      if is_regular_file(&entry.path) {
        kept.push(key.clone());
      } else {
        removed.push(key.clone());
      }
    }
    if !removed.is_empty() {
      for key in &removed {
        data.files.remove(key);
      }
      self.persist(&data);
    }
    (kept, removed)
  }

  fn persist(&self, data: &SavedFilesData) {
    let Some(path) = &self.storage_path else {
      return;
    };
    if let Err(err) = write_json_atomically(path, data) {
      log::error!("Failed to save the list of saved files: {err}");
    }
  }
}

pub(crate) fn write_json_atomically(path: &Path, data: &impl Serialize) -> io::Result<()> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)?;
  }
  let temp_path = path.with_extension("json.tmp");
  fs::write(&temp_path, serde_json::to_vec(data)?)?;
  fs::rename(&temp_path, path)
}

/// Where a finished save goes
enum Target {
  /// A free name in the directory, such as the Downloads folder
  Unique { dir: PathBuf, file_name: String },
  /// The path that the user picked in the save dialog, who confirmed replacing a file there
  Exact(PathBuf),
}

struct PendingSave {
  /// The webview that began the save; its reload or close ends the save
  owner: String,
  key: String,
  /// `None` once the save ended
  file: Option<File>,
  temp_path: PathBuf,
  target: Target,
}

pub struct Files {
  saved: SavedFiles,
  pending: Mutex<HashMap<u32, Arc<Mutex<PendingSave>>>>,
  next_id: AtomicU32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedFilesChange {
  added: Vec<String>,
  removed: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFileInfo {
  file_name: String,
  folder_name: String,
}

#[derive(Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum SavedFileOutcome {
  Done,
  /// No record, or the file moved or was deleted; the record is gone
  Missing,
  /// The user declined to open a dangerous file
  Cancelled,
}

impl Files {
  /// `data_dir` is where the records persist; `None` keeps them in memory only
  pub fn new(data_dir: Option<PathBuf>) -> Self {
    Self {
      saved: SavedFiles::load(data_dir.map(|dir| dir.join(SAVED_FILES_FILE_NAME))),
      pending: Mutex::default(),
      next_id: AtomicU32::new(1),
    }
  }

  /// Registers a save; past the limit, the save's temporary file goes away
  fn add_pending(&self, mut save: PendingSave) -> Result<u32, String> {
    let mut pending = lock(&self.pending);
    if pending.len() >= MAX_PENDING_SAVES {
      discard_temp_file(&mut save);
      return Err("Too many files are being saved".to_string());
    }
    let id = self.next_id.fetch_add(1, Ordering::Relaxed);
    pending.insert(id, Arc::new(Mutex::new(save)));
    Ok(id)
  }

  /// The save with this ID, when `owner` began it; another window gets the answer for an unknown one
  fn get_owned(&self, id: u32, owner: &str) -> Result<Arc<Mutex<PendingSave>>, String> {
    let save = lock(&self.pending)
      .get(&id)
      .cloned()
      .ok_or(UNKNOWN_SAVE_ERROR)?;
    if lock(&save).owner != owner {
      return Err(UNKNOWN_SAVE_ERROR.to_string());
    }
    Ok(save)
  }

  /// Takes a save that `owner` began out of the registry; a command that still works on it finishes
  /// first
  fn take_owned(&self, id: u32, owner: &str) -> Result<Arc<Mutex<PendingSave>>, String> {
    let mut pending = lock(&self.pending);
    let is_owned = pending
      .get(&id)
      .is_some_and(|save| lock(save).owner == owner);
    if !is_owned {
      return Err(UNKNOWN_SAVE_ERROR.to_string());
    }
    pending
      .remove(&id)
      .ok_or_else(|| UNKNOWN_SAVE_ERROR.to_string())
  }

  /// Ends the saves that a window began, which its reload or close leaves unfinished
  pub fn abort_owned_by(&self, owner: &str) {
    let ids: Vec<u32> = lock(&self.pending)
      .iter()
      .filter(|(_, save)| lock(save).owner == owner)
      .map(|(id, _)| *id)
      .collect();
    for id in ids {
      if let Ok(save) = self.take_owned(id, owner) {
        discard_temp_file(&mut lock(&save));
      }
    }
  }

  /// Ends every save, as the app exits, so that no temporary file stays behind
  pub fn abort_all(&self) {
    let saves: Vec<_> = lock(&self.pending).drain().map(|(_, save)| save).collect();
    for save in saves {
      discard_temp_file(&mut lock(&save));
    }
  }
}

fn discard_temp_file(save: &mut PendingSave) {
  // Windows cannot remove an open file
  drop(save.file.take());
  if let Err(err) = fs::remove_file(&save.temp_path) {
    // File names come from messages, so logs name no file
    log::warn!("Failed to remove a temporary file: {err}");
  }
}

fn get_downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let path = app.path();
  path
    .download_dir()
    .or_else(|_| path.home_dir().map(|home| home.join(DOWNLOADS_FOLDER_NAME)))
    .map_err(|err| format!("No Downloads folder: {err}"))
}

fn validate_key(key: &str) -> Result<(), String> {
  if key.is_empty() || key.len() > MAX_KEY_BYTES {
    return Err("Invalid file key".to_string());
  }
  Ok(())
}

/// Starts saving a file and returns the ID that `write_file_chunk` and `finish_file_save` take, or
/// nothing when the user cancels the save dialog. The dialog appears when `should_ask_where` is set.
#[tauri::command]
pub async fn begin_file_save(
  window: WebviewWindow,
  files: tauri::State<'_, Files>,
  file_name: String,
  key: String,
  should_ask_where: Option<bool>,
  dialog_title: Option<String>,
) -> Result<Option<u32>, String> {
  validate_key(&key)?;
  let file_name = sanitize_file_name(&file_name);
  let downloads_dir = get_downloads_dir(window.app_handle())?;

  let target = if should_ask_where == Some(true) {
    let Some(path) = pick_save_path(&window, &downloads_dir, &file_name, dialog_title).await else {
      return Ok(None);
    };
    Target::Exact(path)
  } else {
    Target::Unique {
      dir: downloads_dir,
      file_name: file_name.clone(),
    }
  };

  let (dir, base_name) = match &target {
    Target::Unique { dir, file_name } => (dir.as_path(), file_name.clone()),
    Target::Exact(path) => (
      path.parent().ok_or("The save path has no folder")?,
      path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or("The save path has no file name")?,
    ),
  };

  fs::create_dir_all(dir).map_err(|err| err.to_string())?;
  let temp_path = dir.join(format!(
    ".{}.{}.{TEMP_FILE_SUFFIX}",
    truncate_to_bytes(&base_name, MAX_FILE_NAME_BYTES),
    &Uuid::new_v4().simple().to_string()[..8],
  ));
  let file = OpenOptions::new()
    .write(true)
    .create_new(true)
    .open(&temp_path)
    .map_err(|err| err.to_string())?;

  let save = PendingSave {
    owner: window.label().to_string(),
    key,
    file: Some(file),
    temp_path,
    target,
  };
  files.add_pending(save).map(Some)
}

async fn pick_save_path(
  window: &WebviewWindow,
  dir: &Path,
  file_name: &str,
  title: Option<String>,
) -> Option<PathBuf> {
  let (sender, receiver) = tokio::sync::oneshot::channel();
  let mut dialog = window
    .dialog()
    .file()
    .set_parent(window)
    .set_file_name(file_name);
  if dir.is_dir() {
    dialog = dialog.set_directory(dir);
  }
  if let Some(title) = title {
    dialog = dialog.set_title(title);
  }
  dialog.save_file(move |path| {
    let _ = sender.send(path);
  });
  receiver.await.ok()??.into_path().ok()
}

/// Appends the raw request body to the save named by the `save-id` header; the page sends the chunks
/// one at a time
#[tauri::command]
pub async fn write_file_chunk(
  window: WebviewWindow,
  files: tauri::State<'_, Files>,
  request: Request<'_>,
) -> Result<(), String> {
  let id = request
    .headers()
    .get(SAVE_ID_HEADER)
    .and_then(|value| value.to_str().ok())
    .and_then(|value| value.parse().ok())
    .ok_or_else(|| format!("Missing {SAVE_ID_HEADER} header"))?;
  let InvokeBody::Raw(data) = request.body() else {
    return Err("Expected raw bytes".to_string());
  };

  let save = files.get_owned(id, window.label())?;
  let mut save = lock(&save);
  save
    .file
    .as_mut()
    .ok_or("The save has ended")?
    .write_all(data)
    .map_err(|err| err.to_string())
}

/// Moves the file to its final name, records it and tells every window
#[tauri::command]
pub async fn finish_file_save(
  window: WebviewWindow,
  files: tauri::State<'_, Files>,
  id: u32,
) -> Result<SavedFileInfo, String> {
  let save = files.take_owned(id, window.label())?;
  let mut save = lock(&save);

  // Windows cannot rename an open file
  drop(save.file.take().ok_or("The save has ended")?);
  let path = match move_to_target(&save.temp_path, &save.target) {
    Ok(path) => path,
    Err(err) => {
      discard_temp_file(&mut save);
      return Err(err.to_string());
    }
  };

  mark_as_downloaded(&path);

  let removed = files.saved.insert(save.key.clone(), path.clone());
  emit_change(window.app_handle(), vec![save.key.clone()], removed);

  let get_name = |path: Option<&Path>| {
    path
      .and_then(Path::file_name)
      .map(|name| name.to_string_lossy().into_owned())
      .unwrap_or_default()
  };
  Ok(SavedFileInfo {
    file_name: get_name(Some(&path)),
    folder_name: get_name(path.parent()),
  })
}

fn move_to_target(temp_path: &Path, target: &Target) -> io::Result<PathBuf> {
  let path = match target {
    // Renaming replaces the empty file that claims the name
    Target::Unique { dir, file_name } => claim_unique_path(dir, file_name)?,
    Target::Exact(path) => path.clone(),
  };
  if let Err(err) = fs::rename(temp_path, &path) {
    if matches!(target, Target::Unique { .. }) {
      let _ = fs::remove_file(&path);
    }
    return Err(err);
  }
  Ok(path)
}

#[tauri::command]
pub async fn abort_file_save(
  window: WebviewWindow,
  files: tauri::State<'_, Files>,
  id: u32,
) -> Result<(), String> {
  let save = files.take_owned(id, window.label())?;
  discard_temp_file(&mut lock(&save));
  Ok(())
}

/// The keys of the saved files that still exist; the records of the others are dropped
#[tauri::command]
pub async fn list_saved_files(
  app: AppHandle,
  files: tauri::State<'_, Files>,
) -> Result<Vec<String>, String> {
  let (kept, removed) = files.saved.prune();
  if !removed.is_empty() {
    emit_change(&app, Vec::new(), removed);
  }
  Ok(kept)
}

/// Drops the records of every saved file, as logging out does: they hold the paths and the keys of attachments that the
/// account received. The files themselves stay where the user saved them.
#[tauri::command]
pub async fn forget_saved_files(
  app: AppHandle,
  files: tauri::State<'_, Files>,
) -> Result<(), String> {
  let removed = files.saved.clear();
  if !removed.is_empty() {
    emit_change(&app, Vec::new(), removed);
  }
  Ok(())
}

/// Opens a saved file with the default app, after a confirmation when its type is dangerous
#[tauri::command]
pub async fn open_saved_file(
  window: WebviewWindow,
  files: tauri::State<'_, Files>,
  key: String,
  lang_code: String,
) -> Result<SavedFileOutcome, String> {
  let Some(path) = get_existing_path(&window, &files, &key) else {
    return Ok(SavedFileOutcome::Missing);
  };

  let file_name = path
    .file_name()
    .map(|name| name.to_string_lossy().into_owned())
    .unwrap_or_default();
  if is_file_dangerous(&file_name) && !confirm_open(&window, &file_name, &lang_code).await {
    return Ok(SavedFileOutcome::Cancelled);
  }

  window
    .opener()
    .open_path(path.to_string_lossy(), None::<&str>)
    .map_err(|err| err.to_string())?;
  Ok(SavedFileOutcome::Done)
}

/// Shows a saved file in the system file manager with the file selected
#[tauri::command]
pub async fn reveal_saved_file(
  window: WebviewWindow,
  files: tauri::State<'_, Files>,
  key: String,
) -> Result<SavedFileOutcome, String> {
  let Some(path) = get_existing_path(&window, &files, &key) else {
    return Ok(SavedFileOutcome::Missing);
  };

  let opener = window.opener();
  opener
    .reveal_item_in_dir(&path)
    .or_else(|err| {
      // Without a file manager that implements `FileManager1` (Linux), opening the folder is the best left
      log::warn!("Failed to reveal a file: {err}");
      let dir = path.parent().ok_or(err)?;
      opener.open_path(dir.to_string_lossy(), None::<&str>)
    })
    .map_err(|err| err.to_string())?;
  Ok(SavedFileOutcome::Done)
}

/// The path of a recorded file that is still there; a record of a file that is gone is dropped
fn get_existing_path(window: &WebviewWindow, files: &Files, key: &str) -> Option<PathBuf> {
  let path = files.saved.get_path(key)?;
  if is_regular_file(&path) {
    return Some(path);
  }
  files.saved.remove(key);
  emit_change(window.app_handle(), Vec::new(), vec![key.to_string()]);
  None
}

/// The words of the warning before opening a dangerous file. They are fixed here, one set for each language of the
/// app, and the page picks a set by its language code: text from the page could disguise the warning.
struct OpenWarningText {
  title: &'static str,
  file_label: &'static str,
  type_label: &'static str,
  warning: &'static str,
  open_label: &'static str,
  cancel_label: &'static str,
}

const OPEN_WARNING_TEXTS: &[(&str, OpenWarningText)] = &[
  (
    "en",
    OpenWarningText {
      title: "Open this file?",
      file_label: "File",
      type_label: "Type",
      warning: "This type of file can run programs or change settings on your computer. Open it only if you trust the sender.",
      open_label: "Open",
      cancel_label: "Cancel",
    },
  ),
  (
    "ru",
    OpenWarningText {
      title: "Открыть этот файл?",
      file_label: "Файл",
      type_label: "Тип",
      warning: "Файлы этого типа могут запускать программы или менять настройки компьютера. Открывайте его, только если доверяете отправителю.",
      open_label: "Открыть",
      cancel_label: "Отмена",
    },
  ),
];

/// The text for a language code such as `ru` or `ru-RU`; a code that the app does not ship gets English
fn get_open_warning_text(lang_code: &str) -> &'static OpenWarningText {
  let language = lang_code
    .split(['-', '_'])
    .next()
    .unwrap_or_default()
    .to_ascii_lowercase();
  let find = |code: &str| OPEN_WARNING_TEXTS.iter().find(|(known, _)| *known == code);
  let (_, text) = find(&language)
    .or_else(|| find(FALLBACK_LANGUAGE))
    .expect("The fallback language has a text");
  text
}

/// The warning with the real file name and extension
fn build_open_warning(text: &OpenWarningText, file_name: &str) -> String {
  format!(
    "{}: {file_name}\n{}: .{}\n\n{}",
    text.file_label,
    text.type_label,
    get_extension(file_name),
    text.warning,
  )
}

async fn confirm_open(window: &WebviewWindow, file_name: &str, lang_code: &str) -> bool {
  let text = get_open_warning_text(lang_code);
  let (sender, receiver) = tokio::sync::oneshot::channel();
  window
    .dialog()
    .message(build_open_warning(text, file_name))
    .title(text.title)
    .kind(MessageDialogKind::Warning)
    .buttons(MessageDialogButtons::OkCancelCustom(
      text.open_label.to_string(),
      text.cancel_label.to_string(),
    ))
    .show(move |is_confirmed| {
      let _ = sender.send(is_confirmed);
    });
  receiver.await.unwrap_or(false)
}

fn emit_change(app: &AppHandle, added: Vec<String>, removed: Vec<String>) {
  if let Err(err) = app.emit(SAVED_FILES_EVENT, SavedFilesChange { added, removed }) {
    log::warn!("Failed to emit {SAVED_FILES_EVENT}: {err}");
  }
}

/// Marks a saved file as coming from the Internet, as browsers do, so that the system warns before
/// it runs. Best effort: a file system without the feature keeps the file unmarked.
fn mark_as_downloaded(path: &Path) {
  #[cfg(target_os = "macos")]
  {
    // Flags, time in hexadecimal seconds, the app and an ID, as Chrome writes them
    let value = format!(
      "0081;{:x};{};{}",
      unix_time(),
      crate::DEFAULT_WINDOW_TITLE,
      Uuid::new_v4().to_string().to_uppercase()
    );
    let result = std::process::Command::new("/usr/bin/xattr")
      .args(["-w", "com.apple.quarantine", &value])
      .arg(path)
      .status();
    if !result.is_ok_and(|status| status.success()) {
      log::warn!("Failed to quarantine a file");
    }
  }
  #[cfg(windows)]
  {
    // The Mark of the Web, which SmartScreen and Office read: zone 3 is the Internet
    let mut stream = path.as_os_str().to_owned();
    stream.push(":Zone.Identifier");
    if let Err(err) = fs::write(&stream, "[ZoneTransfer]\r\nZoneId=3\r\n") {
      log::warn!("Failed to mark a file: {err}");
    }
  }
  #[cfg(not(any(target_os = "macos", windows)))]
  let _ = path;
}

#[cfg(test)]
mod tests {
  use super::*;

  fn make_temp_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("telesignal-files-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  fn create_pending(dir: &Path, key: &str, owner: &str) -> PendingSave {
    let temp_path = dir.join(format!(".{key}.part"));
    PendingSave {
      owner: owner.to_string(),
      key: key.to_string(),
      file: Some(File::create(&temp_path).unwrap()),
      temp_path,
      target: Target::Exact(dir.join(key)),
    }
  }

  #[test]
  fn keeps_ordinary_names() {
    assert_eq!(sanitize_file_name("report.pdf"), "report.pdf");
    assert_eq!(sanitize_file_name("My photo (1).jpg"), "My photo (1).jpg");
    assert_eq!(sanitize_file_name("архив.tar.gz"), "архив.tar.gz");
    assert_eq!(sanitize_file_name(".hidden"), ".hidden");
    assert_eq!(sanitize_file_name("...txt"), "file.txt");
  }

  #[test]
  fn removes_path_separators_and_dot_segments() {
    for name in [
      "../../etc/passwd",
      "..\\..\\Windows\\System32\\x.dll",
      "a/b/c.txt",
      "C:\\Users\\me\\x.txt",
      "/absolute",
    ] {
      let sanitized = sanitize_file_name(name);
      assert!(
        !sanitized.contains('/') && !sanitized.contains('\\'),
        "{sanitized}"
      );
      assert!(!sanitized.contains(':'), "{sanitized}");
      assert_eq!(
        Path::new(&sanitized).file_name().unwrap(),
        sanitized.as_str()
      );
    }
    for name in ["..", ".", "...", " . ", "", "   ", "\u{0}"] {
      assert_eq!(sanitize_file_name(name), FALLBACK_FILE_NAME, "{name:?}");
    }
    assert_eq!(sanitize_file_name("../x"), "file._x");
  }

  #[test]
  fn removes_control_and_bidi_characters() {
    assert_eq!(sanitize_file_name("a\u{0}b\nc\td.txt"), "abcd.txt");
    // A right-to-left override disguises `exe` as `txt` when displayed
    assert_eq!(sanitize_file_name("evil\u{202E}txt.exe"), "eviltxt.exe");
    assert_eq!(
      sanitize_file_name("a\u{200B}b\u{2066}c\u{FEFF}.txt"),
      "abc.txt"
    );
    assert_eq!(sanitize_file_name("\u{7F}\u{85}x"), "x");
    // Characters that show as blanks or join text without width
    for c in [
      '\u{AD}', '\u{34F}', '\u{115F}', '\u{1160}', '\u{3164}', '\u{FFA0}', '\u{2800}', '\u{180E}',
    ] {
      assert_eq!(sanitize_file_name(&format!("a{c}b.txt")), "ab.txt", "{c:?}");
    }
  }

  #[test]
  fn fixes_names_that_windows_rejects() {
    assert_eq!(
      sanitize_file_name("a:b*c?d\"e<f>g|h.txt"),
      "a_b_c_d_e_f_g_h.txt"
    );
    assert_eq!(sanitize_file_name("name. . "), "name");
    assert_eq!(sanitize_file_name("  lead.txt"), "lead.txt");
    for name in [
      "CON",
      "con.txt",
      "Nul.tar.gz",
      "COM1",
      "lpt9.log",
      "AUX ",
      "PRN.txt",
    ] {
      assert!(sanitize_file_name(name).starts_with('_'), "{name}");
    }
    for name in ["CONIN$", "conout$.txt", "COM\u{B9}", "LPT\u{B3}.log"] {
      assert!(sanitize_file_name(name).starts_with('_'), "{name}");
    }
    assert_eq!(sanitize_file_name("CONSOLE.txt"), "CONSOLE.txt");
    assert_eq!(sanitize_file_name("COM10.txt"), "COM10.txt");
  }

  #[test]
  fn limits_the_length_and_keeps_the_extension() {
    let long = format!("{}.jpeg", "я".repeat(300));
    let sanitized = sanitize_file_name(&long);
    assert!(sanitized.len() <= MAX_FILE_NAME_BYTES);
    assert!(sanitized.ends_with(".jpeg"));
    let long_extension = format!("a.{}", "x".repeat(300));
    assert!(sanitize_file_name(&long_extension).len() <= MAX_FILE_NAME_BYTES);
  }

  #[test]
  fn numbers_names_before_the_extension() {
    assert_eq!(numbered_file_name("report.pdf", 1), "report (1).pdf");
    assert_eq!(numbered_file_name("a.tar.gz", 2), "a.tar (2).gz");
    assert_eq!(numbered_file_name("README", 3), "README (3)");
    assert_eq!(numbered_file_name(".bashrc", 1), ".bashrc (1)");
  }

  #[test]
  fn claims_free_names_in_the_directory() {
    let dir = make_temp_dir();

    let first = claim_unique_path(&dir, "report.pdf").unwrap();
    let second = claim_unique_path(&dir, "report.pdf").unwrap();
    let third = claim_unique_path(&dir, "report.pdf").unwrap();
    assert_eq!(first, dir.join("report.pdf"));
    assert_eq!(second, dir.join("report (1).pdf"));
    assert_eq!(third, dir.join("report (2).pdf"));

    // A name that a user freed in between is taken again
    fs::remove_file(&second).unwrap();
    assert_eq!(claim_unique_path(&dir, "report.pdf").unwrap(), second);

    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn hostile_names_stay_in_the_directory() {
    let dir = make_temp_dir();
    for name in [
      "../../escape.txt",
      "..",
      "/etc/passwd",
      "a/../../b",
      "..\\x",
    ] {
      let path = claim_unique_path(&dir, &sanitize_file_name(name)).unwrap();
      assert_eq!(path.parent(), Some(dir.as_path()), "{name}");
      assert!(path.starts_with(&dir));
    }
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn detects_dangerous_types() {
    for name in [
      "setup.exe",
      "SETUP.EXE",
      "a.bat",
      "x.msi",
      "run.sh",
      "Tool.command",
      "Signal.app",
      "disk.dmg",
      "installer.pkg",
      "lib.jar",
      "x.ps1",
      "report.pdf.exe",
      "trailing.exe.",
      "trailing.exe . ",
      "a.settingcontent-ms",
      "program.AppImage",
      // A leading dot still makes the extension on Windows
      ".exe",
      ".bat",
      ".lnk",
      ".desktop",
      ".sh",
      "...exe",
      "macro.docm",
      "disk.ISO",
      "setup.msixbundle",
      "run.py",
      "link.webloc",
      "x.saver",
    ] {
      assert!(is_file_dangerous(name), "{name}");
    }
    for name in [
      "photo.jpg",
      "report.pdf",
      "archive.tar.gz",
      "exe",
      "notes.txt",
      "exe.txt",
      "x.exe.txt",
      "",
      "..",
      ".",
      "doc.docx",
    ] {
      assert!(!is_file_dangerous(name), "{name}");
    }
  }

  #[test]
  fn records_persist_and_drop_missing_files() {
    let dir = make_temp_dir();
    let kept = dir.join("kept.txt");
    let gone = dir.join("gone.txt");
    fs::write(&kept, "a").unwrap();
    fs::write(&gone, "b").unwrap();

    let saved = SavedFiles::load(Some(dir.join(SAVED_FILES_FILE_NAME)));
    assert!(saved.insert("kept".to_string(), kept.clone()).is_empty());
    saved.insert("gone".to_string(), gone.clone());
    assert_eq!(saved.get_path("kept"), Some(kept.clone()));
    assert_eq!(saved.get_path("unknown"), None);

    // A new instance reads the records back
    let reloaded = SavedFiles::load(Some(dir.join(SAVED_FILES_FILE_NAME)));
    assert_eq!(reloaded.get_path("gone"), Some(gone.clone()));

    fs::remove_file(&gone).unwrap();
    let (kept_keys, removed_keys) = reloaded.prune();
    assert_eq!(kept_keys, vec!["kept".to_string()]);
    assert_eq!(removed_keys, vec!["gone".to_string()]);
    assert_eq!(reloaded.get_path("gone"), None);
    assert_eq!(
      SavedFiles::load(Some(dir.join(SAVED_FILES_FILE_NAME))).get_path("gone"),
      None
    );

    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn clearing_drops_every_record_from_storage() {
    let dir = make_temp_dir();
    let file = dir.join("secret.txt");
    fs::write(&file, "a").unwrap();
    let storage = dir.join(SAVED_FILES_FILE_NAME);

    let saved = SavedFiles::load(Some(storage.clone()));
    saved.insert("one".to_string(), file.clone());
    saved.insert("two".to_string(), file.clone());
    let mut keys = saved.clear();
    keys.sort();
    assert_eq!(keys, vec!["one".to_string(), "two".to_string()]);
    assert_eq!(saved.get_path("one"), None);

    // The stored list holds neither the keys nor the path, and the file stays
    let stored = fs::read_to_string(&storage).unwrap();
    assert!(!stored.contains("secret.txt") && !stored.contains("one"));
    assert_eq!(SavedFiles::load(Some(storage)).get_path("two"), None);
    assert!(file.exists());

    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn records_ignore_unreadable_storage() {
    let dir = make_temp_dir();
    let path = dir.join(SAVED_FILES_FILE_NAME);
    fs::write(&path, "not json").unwrap();
    assert_eq!(SavedFiles::load(Some(path)).get_path("any"), None);
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn directories_and_links_are_not_saved_files() {
    let dir = make_temp_dir();
    assert!(!is_regular_file(&dir));
    assert!(!is_regular_file(&dir.join("missing")));

    let file = dir.join("file.txt");
    fs::write(&file, "a").unwrap();
    assert!(is_regular_file(&file));

    #[cfg(unix)]
    {
      let link = dir.join("link.txt");
      std::os::unix::fs::symlink(&file, &link).unwrap();
      assert!(!is_regular_file(&link));
    }

    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn limits_records() {
    let saved = SavedFiles::load(None);
    for index in 0..MAX_SAVED_FILES {
      assert!(
        saved
          .insert(index.to_string(), PathBuf::from("x"))
          .is_empty()
      );
    }
    let evicted = saved.insert("new".to_string(), PathBuf::from("y"));
    assert_eq!(evicted.len(), 1);
    assert_eq!(lock(&saved.data).files.len(), MAX_SAVED_FILES);
    assert!(saved.get_path("new").is_some());
  }

  #[test]
  fn validates_keys() {
    assert!(validate_key("document123").is_ok());
    assert!(validate_key("").is_err());
    assert!(validate_key(&"k".repeat(MAX_KEY_BYTES + 1)).is_err());
  }

  #[test]
  fn limits_pending_saves_and_aborts_by_owner() {
    let dir = make_temp_dir();
    let files = Files::new(None);

    for index in 0..MAX_PENDING_SAVES {
      let owner = if index % 2 == 0 { "a" } else { "b" };
      files
        .add_pending(create_pending(&dir, &index.to_string(), owner))
        .unwrap();
    }
    assert!(
      files
        .add_pending(create_pending(&dir, "extra", "a"))
        .is_err()
    );

    files.abort_owned_by("a");
    assert_eq!(lock(&files.pending).len(), MAX_PENDING_SAVES / 2);
    assert!(!dir.join(".0.part").exists());
    assert!(dir.join(".1.part").exists());

    assert!(files.get_owned(9999, "b").is_err());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn other_windows_cannot_use_a_save() {
    let dir = make_temp_dir();
    let files = Files::new(None);
    let id = files
      .add_pending(create_pending(&dir, "mine", "a"))
      .unwrap();

    assert!(files.get_owned(id, "b").is_err());
    assert!(files.take_owned(id, "b").is_err());
    // The refused window changed nothing
    assert!(files.get_owned(id, "a").is_ok());
    assert!(dir.join(".mine.part").exists());

    assert!(files.take_owned(id, "a").is_ok());
    assert!(files.get_owned(id, "a").is_err());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn aborts_every_save_at_exit() {
    let dir = make_temp_dir();
    let files = Files::new(None);
    files.add_pending(create_pending(&dir, "one", "a")).unwrap();
    files.add_pending(create_pending(&dir, "two", "b")).unwrap();

    files.abort_all();
    assert!(lock(&files.pending).is_empty());
    assert!(!dir.join(".one.part").exists());
    assert!(!dir.join(".two.part").exists());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn the_open_warning_names_the_file_and_type() {
    let text = get_open_warning_text("en");
    let warning = build_open_warning(text, "Invoice.PDF.exe");
    assert!(warning.contains("File: Invoice.PDF.exe"));
    assert!(warning.contains("Type: .exe"));
    assert!(build_open_warning(text, ".bat").contains("Type: .bat"));
  }

  #[test]
  fn dangerous_extensions_are_lowercase_and_unique() {
    let mut seen = std::collections::HashSet::new();
    for extension in DANGEROUS_EXTENSIONS {
      assert_eq!(*extension, extension.to_ascii_lowercase());
      assert!(!extension.starts_with('.'));
      assert!(seen.insert(*extension), "{extension} is listed twice");
    }
  }

  #[test]
  fn moves_the_temporary_file_to_the_target() {
    let dir = make_temp_dir();
    let write_temp = |name: &str, content: &str| {
      let path = dir.join(name);
      fs::write(&path, content).unwrap();
      path
    };

    let target = Target::Unique {
      dir: dir.clone(),
      file_name: "a.txt".to_string(),
    };
    let first = move_to_target(&write_temp(".t1.part", "one"), &target).unwrap();
    let second = move_to_target(&write_temp(".t2.part", "two"), &target).unwrap();
    assert_eq!(fs::read_to_string(&first).unwrap(), "one");
    assert_eq!(second, dir.join("a (1).txt"));
    assert_eq!(fs::read_to_string(&second).unwrap(), "two");

    // An exact target replaces the file that the user chose to replace
    let exact = Target::Exact(first.clone());
    move_to_target(&write_temp(".t3.part", "three"), &exact).unwrap();
    assert_eq!(fs::read_to_string(&first).unwrap(), "three");
    assert!(!dir.join(".t3.part").exists());

    fs::remove_dir_all(&dir).unwrap();
  }
}
