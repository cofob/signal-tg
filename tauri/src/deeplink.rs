use std::collections::VecDeque;
use std::sync::Mutex;

use log::info;
use tauri::{Emitter, Manager, UserAttentionType};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

/// `sgnl://` hosts that the app forwards to the page, which parses the links (`src/util/signalLinks.ts`): the
/// hosts of Signal Desktop's `signalRoutes` and Signal Android's manifest that make sense for a linked device. Any
/// other link, from a web page that opens `sgnl://` for example, does not even bring the window forward.
const LINK_HOSTS: [&str; 8] = [
  "signal.me",
  "signal.group",
  "signal.link",
  "signal.tube",
  "joingroup",
  "addstickers",
  "linkdevice",
  "rereg",
];

/// The most links that wait for the page; the oldest are dropped first
const MAX_PENDING_LINKS: usize = 8;

/// Tells the page that `take_deep_links` has links; the event has no payload, so a link is never lost to a page
/// that has not set up its listener yet
const LINKS_EVENT: &str = "deeplink";

/// The links that reached the app and that the page has not taken yet. A link can arrive while the page loads,
/// or while it shows the link screen and has no listener, so it waits here instead of in an event.
#[derive(Default)]
pub struct PendingLinks(Mutex<VecDeque<String>>);

impl PendingLinks {
  fn push_all(&self, links: Vec<String>) {
    let Ok(mut pending) = self.0.lock() else {
      return;
    };
    pending.extend(links);
    while pending.len() > MAX_PENDING_LINKS {
      pending.pop_front();
    }
  }

  fn take_all(&self) -> Vec<String> {
    self
      .0
      .lock()
      .map(|mut pending| pending.drain(..).collect())
      .unwrap_or_default()
  }
}

/// Hands the waiting links to the page, which processes them in the order they arrived
#[tauri::command]
pub fn take_deep_links(pending: tauri::State<'_, PendingLinks>) -> Vec<String> {
  pending.take_all()
}

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
    app
      .deep_link()
      .on_open_url(move |event| deliver_links(&app_handle, event.urls()));

    // The link that launched the app arrived before the listener above existed
    if let Ok(Some(urls)) = app.deep_link().get_current() {
      deliver_links(app, urls);
    }

    Ok(())
  }
}

fn deliver_links(app: &tauri::AppHandle, urls: Vec<Url>) {
  let links: Vec<String> = urls
    .iter()
    .filter(|url| is_supported_link(url))
    .map(Url::to_string)
    .collect();
  // The links hold phone numbers and group keys, so only their number is logged
  info!("Deep links received: {}", links.len());
  if links.is_empty() {
    return;
  }

  app.state::<PendingLinks>().push_all(links);

  let Some(window) = crate::show_main_window(app) else {
    return;
  };
  if let Err(err) = window.request_user_attention(Some(UserAttentionType::Informational)) {
    info!("Error requesting user attention: {:?}", err);
  }
  if let Err(err) = window.emit_to(window.label(), LINKS_EVENT, ()) {
    info!("Error emitting deeplink event: {:?}", err);
  }
}

fn is_supported_link(url: &Url) -> bool {
  url.scheme() == "sgnl"
    && url.username().is_empty()
    && url.password().is_none()
    && url.port().is_none()
    && url
      .host_str()
      .is_some_and(|host| LINK_HOSTS.contains(&host.to_ascii_lowercase().as_str()))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn url(value: &str) -> Url {
    Url::parse(value).unwrap()
  }

  #[test]
  fn supports_the_hosts_of_signal_links() {
    for link in [
      "sgnl://signal.me/#p/+15550100001",
      "sgnl://SIGNAL.GROUP/#abc",
      "sgnl://signal.link/call/#key=abc",
      "sgnl://signal.tube/#proxy.example.org",
      "sgnl://joingroup/#abc",
      "sgnl://addstickers?pack_id=a&pack_key=b",
      "sgnl://linkdevice?uuid=a&pub_key=b",
      "sgnl://rereg",
    ] {
      assert!(is_supported_link(&url(link)), "{link}");
    }
  }

  #[test]
  fn drops_other_links() {
    for link in [
      "https://signal.me/#p/+15550100001",
      "tg://resolve?domain=x",
      "sgnl://show-window",
      "sgnl://signal.me.evil.com/",
      "sgnl://user@signal.me/",
      "sgnl://signal.me:8080/",
      "sgnl:signal.me",
    ] {
      assert!(!is_supported_link(&url(link)), "{link}");
    }
  }

  #[test]
  fn keeps_the_latest_pending_links_in_order() {
    let pending = PendingLinks::default();
    pending.push_all((0..MAX_PENDING_LINKS + 2).map(|i| i.to_string()).collect());
    pending.push_all(vec!["last".to_string()]);

    let links = pending.take_all();
    assert_eq!(links.len(), MAX_PENDING_LINKS);
    assert_eq!(links.first().map(String::as_str), Some("3"));
    assert_eq!(links.last().map(String::as_str), Some("last"));
    assert!(pending.take_all().is_empty());
  }
}
