use tauri::webview::PageLoadEvent;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_log::{Target, TargetKind};

mod app_settings;
mod bootstrap;
mod character_backup;
mod client_assets;
mod controller;
mod dashboard;
mod gearsets;
mod install;
mod inventory;
mod migrations;
mod modules;
mod playerbots;
mod presets;
mod server;
mod sfx;
mod steamos;
mod soap;
mod steam_shortcuts;
mod talent_dataset;
mod talent_harvest;
pub mod talent_trees;
mod teleport;
mod uninstall;
mod worldsettings;
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
    // We used to force `WEBKIT_DISABLE_DMABUF_RENDERER=1` to dodge an
    // "EGL_BAD_PARAMETER" crash we hit under gamescope, but that turned
    // out to be a library-mismatch from an Arch-built AppImage running
    // against SteamOS's webkit2gtk — not a gamescope problem. With the
    // native Deck build the DMABUF renderer initializes cleanly in
    // both desktop and Gaming Mode, so we let WebKitGTK pick its own
    // path. If it ever breaks again, the user can still set
    // `WEBKIT_DISABLE_DMABUF_RENDERER=1` manually as an escape hatch.

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(external_navigation_plugin())
        .manage(install::InstallState::default())
        .manage(uninstall::UninstallState::default())
        .manage(server::ServerControlState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            bootstrap::bootstrap_privileges,
            install::detect_installs,
            install::adopt_install,
            install::analyze_install,
            install::verify_admin_account,
            install::start_install,
            install::cancel_install,
            uninstall::start_uninstall,
            server::get_server_status,
            server::start_server,
            server::stop_server,
            server::restart_server,
            modules::list_installed_modules,
            modules::list_characters,
            modules::configure_ahbot_character,
            modules::update_module_conf,
            modules::reload_ahbot,
            wow_client::get_wow_client_state,
            wow_client::set_wow_directory,
            wow_client::clear_wow_directory,
            wow_client::fix_realmlist,
            teleport::list_teleport_locations,
            teleport::teleport_character_to_location,
            teleport::teleport_character_to_coords,
            playerbots::list_playerbots,
            playerbots::set_playerbot_level,
            playerbots::reroll_playerbot,
            playerbots::summon_playerbot_to_character,
            playerbots::invite_bot_to_party,
            playerbots::add_bot_to_party,
            playerbots::get_user_party,
            playerbots::kick_bot_from_party,
            playerbots::bring_bot_online,
            migrations::migrations_status,
            migrations::run_migrations,
            migrations::backup_current_binary,
            migrations::restore_previous_version,
            presets::save_party_preset,
            presets::list_party_presets,
            presets::delete_party_preset,
            presets::export_party_preset_toml,
            presets::import_party_preset_toml,
            presets::save_preset_toml,
            gearsets::save_gear_set,
            gearsets::list_gear_sets,
            gearsets::delete_gear_set,
            gearsets::export_gear_set_toml,
            gearsets::import_gear_set_toml,
            steamos::steamos_status,
            steamos::is_gaming_mode,
            steamos::acknowledge_steamos_version,
            steamos::run_steamos_fix,
            worldsettings::get_world_settings,
            worldsettings::set_world_settings,
            worldsettings::get_motd,
            worldsettings::set_motd,
            worldsettings::summon_transmog_npc,
            character_backup::lookup_account,
            character_backup::list_account_characters,
            character_backup::backup_characters,
            character_backup::validate_backup,
            character_backup::restore_characters,
            talent_harvest::harvest_talent_builds,
            talent_dataset::build_talent_dataset,
            talent_trees::build_talent_trees,
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
            client_assets::get_talent_cache_status,
            client_assets::extract_talent_data,
            client_assets::load_talent_data,
            client_assets::wipe_talent_cache,
            app_settings::is_notice_dismissed,
            app_settings::dismiss_notice,
            app_settings::undismiss_notice,
            app_settings::get_inventory_show_deprecated,
            app_settings::set_inventory_show_deprecated,
            app_settings::get_selected_character_guid,
            app_settings::set_selected_character_guid,
            app_settings::get_switcher_character_guids,
            app_settings::set_switcher_character_guids,
            app_settings::get_auto_shutdown_on_client_exit,
            app_settings::set_auto_shutdown_on_client_exit,
            app_settings::get_cursor_faction,
            app_settings::set_cursor_faction,
            server::ensure_client_watcher,
            dashboard::get_character_paperdoll,
            dashboard::gm_set_money,
            dashboard::gm_set_health_pct,
            dashboard::gm_set_power_pct,
            dashboard::gm_revive,
            dashboard::is_character_online,
            dashboard::get_character_talents,
            controller::get_consoleportlk_status,
            controller::install_consoleportlk,
            controller::find_wow_steam_shortcut,
            controller::apply_controller_preset,
            steam_shortcuts::get_steam_integration_status,
            steam_shortcuts::add_to_steam,
            sfx::play_sfx
        ])
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), PageLoadEvent::Finished) {
                log::info!("main webview finished loading");
                let _ = webview.window().show();
            }
        })
        .setup(|app| {
            // Steam Deck Gaming Mode runs every app under gamescope —
            // detectable via the GAMESCOPE_WAYLAND_DISPLAY env var (also
            // XDG_CURRENT_DESKTOP=gamescope on most setups). When we
            // detect it, force the window fullscreen so Steam's bottom
            // overlay strip (the STEAM | MENU bar) sits ON TOP of our
            // viewport rather than EATING our last ~40px and swallowing
            // clicks on bottom-anchored UI (Back-to-dashboard, character
            // switcher). Windowed apps under gamescope get a render area
            // that excludes that strip but the strip is still in the
            // pointer-event space — fullscreen sidesteps both.
            //
            // Desktop Mode never sets GAMESCOPE_WAYLAND_DISPLAY, so the
            // window stays windowed with normal decorations (the user's
            // explicit ask: "minimize/maximize/close like normal in
            // desktop mode, lock gaming mode to fullscreen").
            use tauri::Manager;
            let in_gamescope = std::env::var("GAMESCOPE_WAYLAND_DISPLAY").is_ok()
                || std::env::var("XDG_CURRENT_DESKTOP")
                    .map(|v| v.eq_ignore_ascii_case("gamescope"))
                    .unwrap_or(false);
            if in_gamescope {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(e) = window.set_fullscreen(true) {
                        log::warn!("set_fullscreen failed: {e}");
                    } else {
                        log::info!("gamescope detected — fullscreen enabled");
                    }
                }
            }

            // Seed the bundled example party presets (Ragefire Chasm,
            // Deadmines) into the user's library on first launch. Idempotent
            // per-example and best-effort — never blocks startup.
            presets::seed_example_presets();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
