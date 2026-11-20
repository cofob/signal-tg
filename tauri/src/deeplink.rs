use log::info;
use tauri::{Emitter, UserAttentionType};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

/// `sgnl://` link hosts that the app forwards to the page, as Signal Desktop handles them
const LINK_HOSTS: [&str; 2] = ["signal.me", "signal.group"];

pub struct Deeplink;

impl Deeplink {
  pub fn init() -> Self {
    Self {}
  }

  pub fn setup(&self, app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Outside bundles, such as in `tauri dev`, the scheme is registered at runtime
    #[cfg(any(windows, target_os = "linux"))]
    if let Err(err) = app.deep_link().register_all() {
      info!("Error registering deep link schemes: {:?}", err);
    }

    let app_handle = app.clone();
    app.deep_link().on_open_url(move |event| {
      let urls: Vec<String> = event
        .urls()
        .into_iter()
        .filter(is_supported_link)
        .map(String::from)
        .collect();
      info!("Deep links received: {:?}", urls);
      if urls.is_empty() {
        return;
      }

      let Some(window) = crate::show_main_window(&app_handle) else {
        return;
      };
      if let Err(err) = window.request_user_attention(Some(UserAttentionType::Informational)) {
        info!("Error requesting user attention: {:?}", err);
      }
      for url in urls {
        if let Err(err) = window.emit_to(window.label(), "deeplink", url) {
          info!("Error emitting deeplink event: {:?}", err);
        }
      }
    });

    Ok(())
  }
}

fn is_supported_link(url: &Url) -> bool {
  url.scheme() == "sgnl"
    && url
      .host_str()
      .is_some_and(|host| LINK_HOSTS.contains(&host))
}
