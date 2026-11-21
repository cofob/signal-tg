use std::collections::HashMap;
use std::sync::LazyLock;

#[derive(Clone)]
pub struct WindowState {
  pub title: String,
  pub is_overlay: bool,
  // The title bar overlay on macOS depends on the mobile layout
  #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
  pub is_mobile: bool,
}

pub static WINDOW_STATES: LazyLock<std::sync::Mutex<HashMap<String, WindowState>>> =
  LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));
