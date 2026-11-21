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
/// A notification that nobody clicks or closes keeps its thread (the handle moves into the wait, so nothing can end
/// it earlier), so only so many wait at once; the others still show, without opening their chat, and a warning says so
const MAX_WAITING_NOTIFICATIONS: usize = 64;

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
/// `open_label` is the page's word for "Open", which a Linux server that lists actions may show as a button.
#[tauri::command]
#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(unused_variables))]
pub fn show_notification(
  window: WebviewWindow,
  title: String,
  body: String,
  open_label: String,
  chat_id: Option<String>,
  message_id: Option<i64>,
) {
  let mut notification = Notification::new();
  notification.auto_icon();
  set_application(&window.app_handle().config().identifier, &mut notification);

  let waiting = chat_id.and_then(|chat_id| {
    let slot = WaitingSlot::reserve();
    if slot.is_none() {
      log::warn!("Too many notifications wait for a click; this one will not open its chat");
    }
    slot.map(|slot| {
      let click = NotificationClick {
        chat_id,
        message_id,
      };
      (click, slot)
    })
  });

  std::thread::spawn(move || {
    #[cfg(all(unix, not(target_os = "macos")))]
    set_linux_content(&mut notification, &title, &body, &open_label);
    #[cfg(not(all(unix, not(target_os = "macos"))))]
    notification.summary(&title).body(&body);

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

/// Sets the text according to what the server can show: a server with `body-markup` parses the text, so a sender
/// could inject links and images into it unless the markup characters are escaped; a server without it shows them as
/// they are. The default action goes only to a server that lists actions.
#[cfg(all(unix, not(target_os = "macos")))]
fn set_linux_content(notification: &mut Notification, title: &str, body: &str, open_label: &str) {
  let capabilities = notify_rust::get_capabilities().unwrap_or_default();
  let has_capability = |name: &str| capabilities.iter().any(|capability| capability == name);

  if has_capability("body-markup") {
    notification
      .summary(&escape_markup(title))
      .body(&escape_markup(body));
  } else {
    notification.summary(title).body(body);
  }
  if has_capability("actions") {
    notification.action(DEFAULT_ACTION, open_label);
  }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn escape_markup(text: &str) -> String {
  text
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
}

/// Names the app for the system, as the notification plugin does: a macOS notification belongs to the app that
/// the bundle identifier names (Terminal in development), and a Windows toast to the app user model ID that the
/// installer registers, which an app run from the build directory lacks
#[allow(unused_variables)]
fn set_application(identifier: &str, notification: &mut Notification) {
  #[cfg(target_os = "macos")]
  {
    static SET_APPLICATION: std::sync::Once = std::sync::Once::new();
    SET_APPLICATION.call_once(|| {
      let _ = notify_rust::set_application(if tauri::is_dev() {
        "com.apple.Terminal"
      } else {
        identifier
      });
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
