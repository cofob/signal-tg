//! System notifications that report a click, so that the page can open the chat that a notification announces.
//! The notification plugin shows a notification and drops its handle, which is the only way to learn about the
//! click, and its `onAction` exists on mobile only. The page therefore asks for notifications here, and each one
//! waits for the user on a thread of its own: through D-Bus (`ActionInvoked`) on Linux, the toast activation on
//! Windows and the notification center delegate on macOS, all of which `notify-rust` wraps.

use std::sync::atomic::{AtomicUsize, Ordering};

use notify_rust::{Notification, NotificationResponse};
use serde::Serialize;
use tauri::{Emitter, Manager, WebviewWindow};

/// Emitted to the window that asked for the notification, with a [`NotificationClick`]
const NOTIFICATION_CLICKED_EVENT: &str = "notification-clicked";
/// The D-Bus action that a click on the notification itself invokes
#[cfg(all(unix, not(target_os = "macos")))]
const DEFAULT_ACTION: &str = "default";
/// Servers do not show the default action as a button; one that does shows this label
#[cfg(all(unix, not(target_os = "macos")))]
const DEFAULT_ACTION_LABEL: &str = "Open";
/// A notification that nobody clicks or closes keeps its thread, so only so many wait at once; the others still show
const MAX_WAITING_NOTIFICATIONS: usize = 16;

static WAITING_COUNT: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationClick {
  chat_id: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  message_id: Option<i64>,
}

/// Holds one of the places for notifications that wait for a click
struct WaitingSlot;

impl WaitingSlot {
  fn reserve() -> Option<Self> {
    WAITING_COUNT
      .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
        (count < MAX_WAITING_NOTIFICATIONS).then_some(count + 1)
      })
      .is_ok()
      .then_some(Self)
  }
}

impl Drop for WaitingSlot {
  fn drop(&mut self) {
    WAITING_COUNT.fetch_sub(1, Ordering::AcqRel);
  }
}

/// Shows a notification. With `chat_id`, a click brings the window forward and sends the chat to the page; the page
/// passes none for a notification that must not open anything, such as one while the screen is locked.
#[tauri::command]
pub fn show_notification(
  window: WebviewWindow,
  title: String,
  body: String,
  chat_id: Option<String>,
  message_id: Option<i64>,
) {
  let mut notification = Notification::new();
  notification.summary(&title).body(&body).auto_icon();
  #[cfg(all(unix, not(target_os = "macos")))]
  notification.action(DEFAULT_ACTION, DEFAULT_ACTION_LABEL);
  set_application(&window.app_handle().config().identifier, &mut notification);

  let waiting = chat_id
    .map(|chat_id| NotificationClick {
      chat_id,
      message_id,
    })
    .zip(WaitingSlot::reserve());

  std::thread::spawn(move || {
    let handle = match notification.show() {
      Ok(handle) => handle,
      Err(err) => {
        log::warn!("Failed to show a notification: {err}");
        return;
      }
    };
    // Without a click to wait for, dropping the handle ends the thread (macOS sends the notification then)
    let Some((click, _slot)) = waiting else {
      return;
    };

    let result = handle.wait_for_response(|response: &NotificationResponse| {
      if matches!(response, NotificationResponse::Default) {
        handle_click(&window, click);
      }
    });
    if let Err(err) = result {
      log::warn!("Failed to wait for a notification: {err}");
    }
  });
}

fn handle_click(window: &WebviewWindow, click: NotificationClick) {
  crate::bring_window_forward(window);
  if let Err(err) = window.emit_to(window.label(), NOTIFICATION_CLICKED_EVENT, click) {
    log::warn!("Failed to emit {NOTIFICATION_CLICKED_EVENT}: {err}");
  }
}

/// Names the app for the system, as the notification plugin does: a macOS notification belongs to the app that
/// the bundle identifier names (Terminal in development), and a Windows toast to the app user model ID that the
/// installer registers, which an app run from the build directory lacks
#[allow(unused_variables)]
fn set_application(identifier: &str, notification: &mut Notification) {
  #[cfg(target_os = "macos")]
  {
    let _ = notify_rust::set_application(if tauri::is_dev() {
      "com.apple.Terminal"
    } else {
      identifier
    });
  }
  #[cfg(windows)]
  {
    let is_build_directory = tauri::utils::platform::current_exe()
      .ok()
      .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()))
      .is_some_and(|dir| dir.ends_with("target\\debug") || dir.ends_with("target\\release"));
    if !is_build_directory {
      notification.app_id(identifier);
    }
  }
}
