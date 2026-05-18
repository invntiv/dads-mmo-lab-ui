use tauri::webview::PageLoadEvent;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_log::{Target, TargetKind};

mod app_settings;
mod client_assets;
mod install;
mod inventory;
mod modules;
mod server;
mod soap;
mod teleport;
mod wow_client;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn external_navigation_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("external-navigation")
        .on_navigation(|webview, url| {
            let is_internal_host = matches!(
                url.host_str(),
                Some("localhost") | Some("127.0.0.1") | Some("tauri.localhost") | Some("::1")
            );

            let is_internal = url.scheme() == "tauri" || is_internal_host;

            if is_internal {
                return true;
            }

            let is_external_link = matches!(url.scheme(), "http" | "https" | "mailto" | "tel");

            if is_external_link {
                log::info!("opening external link in system browser: {}", url);
                let _ = webview.opener().open_url(url.as_str(), None::<&str>);
                return false;
            }

            true
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                // Cap noisy dependencies. wow_mpq emits DEBUG/TRACE per
                // decompressed sector — extracting one DBC produces tens
                // of thousands of lines, which floods the webview IPC
                // channel and freezes the renderer mid-extract. Cap at
                // Warn for the WoW-asset stack; our own crate stays at
                // the global default (Info).
                .level(log::LevelFilter::Info)
                .level_for("wow_mpq", log::LevelFilter::Warn)
                .level_for("wow_dbc", log::LevelFilter::Warn)
                .level_for("wow_blp", log::LevelFilter::Warn)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Webview),
                ])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(external_navigation_plugin())
        .manage(install::InstallState::default())
        .manage(server::ServerControlState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            install::detect_installs,
            install::start_install,
            install::cancel_install,
            server::get_server_status,
            server::start_server,
            server::stop_server,
            server::restart_server,
            modules::list_installed_modules,
            modules::list_characters,
            modules::configure_ahbot_character,
            wow_client::get_wow_client_state,
            wow_client::set_wow_directory,
            wow_client::clear_wow_directory,
            wow_client::fix_realmlist,
            teleport::list_teleport_locations,
            teleport::teleport_character_to_location,
            teleport::teleport_character_to_coords,
            inventory::search_items,
            inventory::get_item_details,
            inventory::get_items_by_entries,
            inventory::send_item_to_character,
            client_assets::get_icon_cache_status,
            client_assets::extract_item_icons,
            client_assets::load_item_icon_map,
            client_assets::wipe_icon_cache,
            client_assets::get_tooltip_cache_status,
            client_assets::extract_tooltip_data,
            client_assets::load_tooltip_data,
            client_assets::wipe_tooltip_cache,
            app_settings::is_notice_dismissed,
            app_settings::dismiss_notice,
            app_settings::undismiss_notice,
            app_settings::get_inventory_show_deprecated,
            app_settings::set_inventory_show_deprecated,
            app_settings::get_selected_character_guid,
            app_settings::set_selected_character_guid
        ])
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), PageLoadEvent::Finished) {
                log::info!("main webview finished loading");
                let _ = webview.window().show();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
