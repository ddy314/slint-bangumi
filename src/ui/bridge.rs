use std::collections::VecDeque;
use std::path::Path;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::thread;

use slint::{Image, ModelRc, SharedString, VecModel, Weak};

use crate::app::AppContext;
use crate::domain::{MediaItem, UiCandidateData, UiMediaCardData, UiSubjectDetailData};
use crate::error::{AppError, AppResult};
use crate::task::AppEvent;
use crate::{MainWindow, UiCandidate, UiLogLine, UiMediaCard, UiMediaRow, UiSubjectDetail};

const MAX_LOG_LINES: usize = 200;

#[derive(Default)]
struct UiState {
    media: Vec<MediaItem>,
    cards: Vec<UiMediaCardData>,
    selected_media_id: Option<i64>,
    selected_candidate_id: Option<i64>,
    library_search: String,
    library_filter: String,
    library_sort: String,
    logs: VecDeque<LogLineData>,
}

#[derive(Debug, Clone)]
struct LogLineData {
    level: String,
    message: String,
    timestamp: String,
}

#[derive(Clone)]
pub struct BridgeState {
    inner: Arc<Mutex<UiState>>,
}

pub fn bind(window: Weak<MainWindow>, context: AppContext) -> AppResult<BridgeState> {
    let media = context.media.list_media()?;
    let cards = context.media.list_media_cards()?;
    let state = Arc::new(Mutex::new(UiState {
        media,
        cards,
        selected_media_id: None,
        selected_candidate_id: None,
        library_search: String::new(),
        library_filter: "all".to_string(),
        library_sort: "title".to_string(),
        logs: VecDeque::new(),
    }));

    if let Some(window) = window.upgrade() {
        refresh_window_models(
            &window,
            &context,
            &BridgeState {
                inner: state.clone(),
            },
        );
        set_empty_detail(&window);
        window.set_metadata_status("idle".into());
        window.set_library_filter("all".into());
        window.set_library_sort("title".into());
        window.set_library_view_grid(false);
        push_log(&window, &state, "info", "ready");
    }

    bind_add_path(window.clone(), context.clone(), state.clone());
    bind_scan(window.clone(), context.clone());
    bind_library_controls(window.clone(), context.clone(), state.clone());
    bind_select_media(window.clone(), context.clone(), state.clone());
    bind_play_selected_media(window.clone(), context.clone(), state.clone());
    bind_save_progress(window.clone(), context.clone(), state.clone());
    bind_clear_progress(window.clone(), context.clone(), state.clone());
    bind_load_danmaku(window.clone(), context.clone(), state.clone());
    bind_metadata_actions(window, context, state.clone());

    Ok(BridgeState { inner: state })
}

pub fn start_event_pump(
    window: Weak<MainWindow>,
    context: AppContext,
    state: BridgeState,
) -> AppResult<()> {
    let receiver = context
        .event_receiver
        .lock()
        .expect("event receiver mutex poisoned")
        .take()
        .ok_or_else(|| AppError::Config("event pump already started".to_string()))?;

    thread::spawn(move || {
        while let Ok(event) = receiver.recv() {
            let window = window.clone();
            let state = state.clone();
            let context = context.clone();
            let _ = slint::invoke_from_event_loop(move || {
                if let Some(window) = window.upgrade() {
                    apply_event(&window, &context, &state, event);
                }
            });
        }
    });

    Ok(())
}

fn bind_add_path(window: Weak<MainWindow>, context: AppContext, state: Arc<Mutex<UiState>>) {
    let weak = window.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_add_media_path(move |path| {
            let path = path.trim().to_string();
            if path.is_empty() {
                append_log(&weak, &state, "warn", "media path is empty");
                return;
            }

            match context.media.add_library_path(path.into()) {
                Ok(paths) => {
                    append_log(
                        &weak,
                        &state,
                        "info",
                        &format!("added media path; total paths: {}", paths.len()),
                    );
                    if let Some(window) = weak.upgrade() {
                        refresh_window_models(
                            &window,
                            &context,
                            &BridgeState {
                                inner: state.clone(),
                            },
                        );
                    }
                }
                Err(error) => {
                    append_log(&weak, &state, "error", &format!("add path failed: {error}"))
                }
            }
        });
}

fn bind_scan(window: Weak<MainWindow>, context: AppContext) {
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_scan_library(move || {
            context.media.start_scan();
        });
}

fn bind_library_controls(
    window: Weak<MainWindow>,
    context: AppContext,
    state: Arc<Mutex<UiState>>,
) {
    let weak = window.clone();
    let context_for_search = context.clone();
    let state_for_search = state.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_update_library_search(move |search| {
            state_for_search
                .lock()
                .expect("ui state mutex poisoned")
                .library_search = search.trim().to_string();
            if let Some(window) = weak.upgrade() {
                refresh_window_models(
                    &window,
                    &context_for_search,
                    &BridgeState {
                        inner: state_for_search.clone(),
                    },
                );
            }
        });

    let weak = window.clone();
    let context_for_filter = context.clone();
    let state_for_filter = state.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_set_library_filter(move |filter| {
            let filter = filter.to_string();
            state_for_filter
                .lock()
                .expect("ui state mutex poisoned")
                .library_filter = filter.clone();
            if let Some(window) = weak.upgrade() {
                window.set_library_filter(filter.into());
                refresh_window_models(
                    &window,
                    &context_for_filter,
                    &BridgeState {
                        inner: state_for_filter.clone(),
                    },
                );
            }
        });

    let weak = window.clone();
    let context_for_sort = context.clone();
    let state_for_sort = state.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_set_library_sort(move |sort| {
            let sort = sort.to_string();
            state_for_sort
                .lock()
                .expect("ui state mutex poisoned")
                .library_sort = sort.clone();
            if let Some(window) = weak.upgrade() {
                window.set_library_sort(sort.into());
                refresh_window_models(
                    &window,
                    &context_for_sort,
                    &BridgeState {
                        inner: state_for_sort.clone(),
                    },
                );
            }
        });

    let weak = window.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_set_library_view_grid(move |view_grid| {
            if let Some(window) = weak.upgrade() {
                window.set_library_view_grid(view_grid);
            }
        });
}

fn bind_select_media(window: Weak<MainWindow>, context: AppContext, state: Arc<Mutex<UiState>>) {
    let weak = window.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_select_media_id(move |media_id| {
            let media_id = media_id as i64;
            {
                let mut state = state.lock().expect("ui state mutex poisoned");
                state.selected_media_id = Some(media_id);
                state.selected_candidate_id = None;
            }

            if let Some(window) = weak.upgrade() {
                match context.metadata.subject_detail_for_media(media_id) {
                    Ok(detail) => set_subject_detail(&window, detail),
                    Err(error) => append_log_to_window(
                        &window,
                        &state,
                        "error",
                        &format!("load detail failed: {error}"),
                    ),
                }
                refresh_candidates(&window, &context, &state, media_id);
            }

            match context.watch_history.load(media_id) {
                Ok(Some(progress)) => append_log(
                    &weak,
                    &state,
                    "info",
                    &format!(
                        "loaded progress: media #{} {} / {} ms",
                        progress.media_id, progress.position_ms, progress.duration_ms
                    ),
                ),
                Ok(None) => append_log(
                    &weak,
                    &state,
                    "info",
                    "no watch progress for selected media",
                ),
                Err(error) => append_log(
                    &weak,
                    &state,
                    "error",
                    &format!("load progress failed: {error}"),
                ),
            }
        });
}

fn bind_play_selected_media(
    window: Weak<MainWindow>,
    context: AppContext,
    state: Arc<Mutex<UiState>>,
) {
    let weak = window.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_play_selected_media(move || {
            let Some(media) = selected_media(&state) else {
                append_log(&weak, &state, "warn", "select a media item before playing");
                return;
            };

            if let Err(error) = context.media.open_media(&media) {
                append_log(&weak, &state, "error", &format!("play failed: {error}"));
            }
        });
}

fn bind_save_progress(window: Weak<MainWindow>, context: AppContext, state: Arc<Mutex<UiState>>) {
    let weak = window.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_save_progress(move || {
            let media_id = selected_media_id(&state);
            match media_id.and_then(|id| context.watch_history.save_test_progress(id).ok()) {
                Some(progress) => append_log(
                    &weak,
                    &state,
                    "info",
                    &format!(
                        "test progress saved at {} ms, updated_at={}",
                        progress.position_ms, progress.updated_at
                    ),
                ),
                None => append_log(
                    &weak,
                    &state,
                    "warn",
                    "select a media item before saving progress",
                ),
            }
        });
}

fn bind_clear_progress(window: Weak<MainWindow>, context: AppContext, state: Arc<Mutex<UiState>>) {
    let weak = window.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_clear_progress(move || {
            let Some(media_id) = selected_media_id(&state) else {
                append_log(
                    &weak,
                    &state,
                    "warn",
                    "select a media item before clearing progress",
                );
                return;
            };

            match context.watch_history.clear(media_id) {
                Ok(()) => append_log(&weak, &state, "info", "progress cleared"),
                Err(error) => append_log(
                    &weak,
                    &state,
                    "error",
                    &format!("clear progress failed: {error}"),
                ),
            }
        });
}

fn bind_load_danmaku(window: Weak<MainWindow>, context: AppContext, state: Arc<Mutex<UiState>>) {
    let weak = window.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_load_danmaku(move || {
            let Some(media) = selected_media(&state) else {
                append_log(
                    &weak,
                    &state,
                    "warn",
                    "select a media item before loading danmaku",
                );
                return;
            };

            let danmaku = context.danmaku.clone();
            thread::spawn(move || {
                danmaku.load_for_media(&media);
            });
        });
}

fn bind_metadata_actions(
    window: Weak<MainWindow>,
    context: AppContext,
    state: Arc<Mutex<UiState>>,
) {
    let weak = window.clone();
    let context_for_match = context.clone();
    let state_for_match = state.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_match_selected_metadata(move || {
            let Some(media_id) = selected_media_id(&state_for_match) else {
                append_log(
                    &weak,
                    &state_for_match,
                    "warn",
                    "select a media item before matching",
                );
                return;
            };
            context_for_match.metadata.start_match_media(media_id);
        });

    let context_for_all = context.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_match_all_metadata(move || {
            context_for_all.metadata.start_match_all_unmatched();
        });

    let weak = window.clone();
    let context_for_candidate = context.clone();
    let state_for_candidate = state.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_select_candidate_id(move |candidate_id| {
            let Some(media_id) = selected_media_id(&state_for_candidate) else {
                append_log(
                    &weak,
                    &state_for_candidate,
                    "warn",
                    "select media before choosing candidate",
                );
                return;
            };
            let candidate_id = candidate_id as i64;
            match context_for_candidate
                .metadata
                .select_candidate(media_id, candidate_id)
            {
                Ok(()) => {
                    state_for_candidate
                        .lock()
                        .expect("ui state mutex poisoned")
                        .selected_candidate_id = Some(candidate_id);
                    if let Some(window) = weak.upgrade() {
                        refresh_candidates(
                            &window,
                            &context_for_candidate,
                            &state_for_candidate,
                            media_id,
                        );
                        refresh_selected_detail(
                            &window,
                            &context_for_candidate,
                            &BridgeState {
                                inner: state_for_candidate.clone(),
                            },
                        );
                    }
                }
                Err(error) => append_log(
                    &weak,
                    &state_for_candidate,
                    "error",
                    &format!("select candidate failed: {error}"),
                ),
            }
        });

    let weak = window.clone();
    let context_for_images = context.clone();
    let state_for_images = state.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_refresh_subject_images(move || {
            let Some(media_id) = selected_media_id(&state_for_images) else {
                append_log(
                    &weak,
                    &state_for_images,
                    "warn",
                    "select a subject before caching images",
                );
                return;
            };
            match context_for_images
                .metadata
                .subject_detail_for_media(media_id)
            {
                Ok(detail) if detail.subject_id > 0 => context_for_images
                    .metadata
                    .start_download_subject_images(detail.subject_id),
                Ok(_) => append_log(&weak, &state_for_images, "warn", "media is not matched yet"),
                Err(error) => append_log(
                    &weak,
                    &state_for_images,
                    "error",
                    &format!("cache images failed: {error}"),
                ),
            }
        });

    let weak = window.clone();
    let context_for_confirm = context.clone();
    let state_for_confirm = state.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_confirm_selected_candidate(move || {
            let Some(media_id) = selected_media_id(&state_for_confirm) else {
                append_log(
                    &weak,
                    &state_for_confirm,
                    "warn",
                    "select a media item before confirming",
                );
                return;
            };
            let candidate_id = state_for_confirm
                .lock()
                .expect("ui state mutex poisoned")
                .selected_candidate_id;
            match candidate_id {
                Some(candidate_id) => match context_for_confirm
                    .metadata
                    .confirm_media_candidate(media_id, candidate_id)
                {
                    Ok(()) => append_log(&weak, &state_for_confirm, "info", "match confirmed"),
                    Err(error) => append_log(
                        &weak,
                        &state_for_confirm,
                        "error",
                        &format!("confirm failed: {error}"),
                    ),
                },
                None => append_log(
                    &weak,
                    &state_for_confirm,
                    "warn",
                    "select a Bangumi candidate before confirming",
                ),
            }
        });

    let weak = window.clone();
    let context_for_ignore = context.clone();
    let state_for_ignore = state.clone();
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_ignore_selected_metadata(move || {
            let Some(media_id) = selected_media_id(&state_for_ignore) else {
                append_log(
                    &weak,
                    &state_for_ignore,
                    "warn",
                    "select a media item before ignoring metadata",
                );
                return;
            };
            match context_for_ignore.metadata.ignore_media_match(media_id) {
                Ok(()) => {
                    append_log(
                        &weak,
                        &state_for_ignore,
                        "info",
                        "metadata matching ignored",
                    );
                    if let Some(window) = weak.upgrade() {
                        refresh_window_models(
                            &window,
                            &context_for_ignore,
                            &BridgeState {
                                inner: state_for_ignore.clone(),
                            },
                        );
                        refresh_selected_detail(
                            &window,
                            &context_for_ignore,
                            &BridgeState {
                                inner: state_for_ignore.clone(),
                            },
                        );
                    }
                }
                Err(error) => append_log(
                    &weak,
                    &state_for_ignore,
                    "error",
                    &format!("ignore failed: {error}"),
                ),
            }
        });

    let context_for_test = context;
    window
        .upgrade()
        .expect("window dropped before callback binding")
        .on_test_bangumi_connection(move || {
            context_for_test.metadata.test_bangumi_connection();
        });
}

fn apply_event(window: &MainWindow, context: &AppContext, state: &BridgeState, event: AppEvent) {
    context.metadata.finish_for_event(&event);
    match &event {
        AppEvent::Log(message) => push_log(window, &state.inner, "info", message),
        AppEvent::ScanStarted => {
            window.set_scan_progress("scan started".into());
            push_log(window, &state.inner, "info", "scan started");
        }
        AppEvent::ScanProgress { scanned, indexed } => {
            window.set_scan_progress(format!("scanned {scanned}, indexed {indexed}").into());
        }
        AppEvent::ScanFinished { summary, media } => {
            {
                let mut state = state.inner.lock().expect("ui state mutex poisoned");
                state.media = media.clone();
                state.selected_media_id = None;
            }
            window.set_scan_progress(
                format!(
                    "done: scanned={}, added={}, modified={}, restored={}, deleted={}",
                    summary.scanned_files,
                    summary.added,
                    summary.modified,
                    summary.restored,
                    summary.deleted
                )
                .into(),
            );
            refresh_window_models(window, context, state);
            push_log(window, &state.inner, "info", "scan finished");
            context.metadata.start_auto_match_after_scan();
        }
        AppEvent::ScanFailed(error) => {
            window.set_scan_progress("scan failed".into());
            push_log(
                window,
                &state.inner,
                "error",
                &format!("scan failed: {error}"),
            );
        }
        AppEvent::DanmakuMatched(result) => push_log(
            window,
            &state.inner,
            "info",
            &format!(
                "danmaku: {} matched {} comments, exact={}, anime_id={}, episode_id={}, title={}, anime={}, episode={}",
                result.provider,
                result.comment_count,
                result.exact,
                result
                    .anime_id
                    .map(|id| id.to_string())
                    .unwrap_or_else(|| "-".to_string()),
                result
                    .episode_id
                    .map(|id| id.to_string())
                    .unwrap_or_else(|| "-".to_string()),
                result.title,
                result.anime_title.as_deref().unwrap_or("-"),
                result.episode.as_deref().unwrap_or("(none)")
            ),
        ),
        AppEvent::MetadataMatchStarted { media_id } => {
            window.set_metadata_status("Matching selected media".into());
            push_log(
                window,
                &state.inner,
                "info",
                &format!("metadata match started for #{media_id}"),
            );
        }
        AppEvent::MetadataMatchProgress { processed, total } => {
            window.set_metadata_status(format!("metadata queue {processed}/{total}").into());
        }
        AppEvent::MetadataMatchFinished {
            media_id,
            subject_id,
            title,
        } => {
            window.set_metadata_status("idle".into());
            refresh_window_models(window, context, state);
            refresh_selected_detail(window, context, state);
            if Some(*media_id) == selected_media_id(&state.inner) {
                refresh_candidates(window, context, &state.inner, *media_id);
            }
            let message = match (subject_id, title) {
                (Some(id), Some(title)) => {
                    format!("media #{media_id} matched subject #{id}: {title}")
                }
                _ => format!("media #{media_id} has no Bangumi match"),
            };
            push_log(window, &state.inner, "info", &message);
        }
        AppEvent::SubjectUpdated { subject_id } => {
            refresh_window_models(window, context, state);
            refresh_selected_detail(window, context, state);
            push_log(
                window,
                &state.inner,
                "info",
                &format!("subject #{subject_id} updated"),
            );
        }
        AppEvent::ImageCached {
            subject_id,
            image_kind,
        } => {
            refresh_window_models(window, context, state);
            refresh_selected_detail(window, context, state);
            push_log(
                window,
                &state.inner,
                "info",
                &format!("cached {image_kind} for subject #{subject_id}"),
            );
        }
        AppEvent::MetadataFailed { target_id, error } => {
            window.set_metadata_status("failed".into());
            push_log(
                window,
                &state.inner,
                "error",
                &format!("metadata failed for #{target_id}: {error}"),
            );
        }
        AppEvent::MetadataStatus(message) => {
            window.set_metadata_status(message.as_str().into());
            push_log(window, &state.inner, "info", message);
        }
    }
}

fn refresh_window_models(window: &MainWindow, context: &AppContext, state: &BridgeState) {
    let cards = match context.media.list_media_cards() {
        Ok(cards) => cards,
        Err(error) => {
            push_log(
                window,
                &state.inner,
                "error",
                &format!("refresh media failed: {error}"),
            );
            Vec::new()
        }
    };
    let media = context.media.list_media().unwrap_or_default();
    {
        let mut state = state.inner.lock().expect("ui state mutex poisoned");
        state.media = media;
        state.cards = cards.clone();
    }

    let visible_cards = visible_library_cards(&cards, state);
    set_media_cards(window, &visible_cards);
    set_media_rows(window, &visible_cards);
    set_recent_cards(window, &cards.iter().take(8).cloned().collect::<Vec<_>>());
    let queue = cards
        .iter()
        .filter(|card| card.match_status != "matched")
        .cloned()
        .collect::<Vec<_>>();
    set_match_queue(window, &queue);
    set_home_and_settings(window, context);
}

fn visible_library_cards(cards: &[UiMediaCardData], state: &BridgeState) -> Vec<UiMediaCardData> {
    let (search, filter, sort) = {
        let state = state.inner.lock().expect("ui state mutex poisoned");
        (
            state.library_search.to_ascii_lowercase(),
            state.library_filter.clone(),
            state.library_sort.clone(),
        )
    };

    let mut visible = cards
        .iter()
        .filter(|card| {
            search.is_empty()
                || card.title.to_ascii_lowercase().contains(&search)
                || card.subtitle.to_ascii_lowercase().contains(&search)
                || card.status_text.to_ascii_lowercase().contains(&search)
        })
        .filter(|card| match filter.as_str() {
            "watching" => card.progress_percent > 0 && card.progress_percent < 95,
            "completed" => card.progress_percent >= 95,
            "unmatched" => card.match_status == "unmatched",
            "tentative" => card.match_status == "tentative",
            _ => true,
        })
        .cloned()
        .collect::<Vec<_>>();

    match sort.as_str() {
        "date" => visible.sort_by(|left, right| right.media_id.cmp(&left.media_id)),
        _ => visible.sort_by(|left, right| {
            left.title
                .to_ascii_lowercase()
                .cmp(&right.title.to_ascii_lowercase())
        }),
    }

    visible
}

fn set_home_and_settings(window: &MainWindow, context: &AppContext) {
    let (indexed, matched, unmatched) = context.media.library_counts().unwrap_or_default();
    let tentative = context.metadata.tentative_count().unwrap_or_default();
    let flags = context.media.settings_flags();
    window.set_home_summary(
        format!(
            "Indexed media {indexed}    Matched subjects {matched}    Unmatched {unmatched}    Tentative {tentative}"
        )
        .into(),
    );
    window.set_settings_summary(context.media.settings_summary(indexed).into());
    window.set_bangumi_enabled(flags.bangumi_enabled);
    window.set_bangumi_auto_match(flags.bangumi_auto_match);
    window.set_bangumi_cache_images(flags.bangumi_cache_images);
    window.set_dandanplay_configured(flags.dandanplay_configured);
}

fn set_media_cards(window: &MainWindow, cards: &[UiMediaCardData]) {
    window.set_media_cards(ModelRc::from(Rc::new(VecModel::from(
        cards.iter().map(to_slint_card).collect::<Vec<_>>(),
    ))));
}

fn set_media_rows(window: &MainWindow, cards: &[UiMediaCardData]) {
    window.set_media_rows(ModelRc::from(Rc::new(VecModel::from(build_rows(cards)))));
}

fn build_rows(cards: &[UiMediaCardData]) -> Vec<UiMediaRow> {
    let empty = empty_slint_card();
    cards
        .chunks(5)
        .map(|chunk| UiMediaRow {
            card0: chunk
                .first()
                .map(to_slint_card)
                .unwrap_or_else(|| empty.clone()),
            card1: chunk
                .get(1)
                .map(to_slint_card)
                .unwrap_or_else(|| empty.clone()),
            card2: chunk
                .get(2)
                .map(to_slint_card)
                .unwrap_or_else(|| empty.clone()),
            card3: chunk
                .get(3)
                .map(to_slint_card)
                .unwrap_or_else(|| empty.clone()),
            card4: chunk
                .get(4)
                .map(to_slint_card)
                .unwrap_or_else(|| empty.clone()),
            show0: !chunk.is_empty(),
            show1: chunk.len() > 1,
            show2: chunk.len() > 2,
            show3: chunk.len() > 3,
            show4: chunk.len() > 4,
        })
        .collect::<Vec<_>>()
}

fn set_recent_cards(window: &MainWindow, cards: &[UiMediaCardData]) {
    window.set_recent_cards(ModelRc::from(Rc::new(VecModel::from(
        cards.iter().map(to_slint_card).collect::<Vec<_>>(),
    ))));
}

fn empty_slint_card() -> UiMediaCard {
    UiMediaCard {
        media_id: 0,
        subject_id: 0,
        title: SharedString::new(),
        subtitle: SharedString::new(),
        status_text: SharedString::new(),
        match_status: SharedString::new(),
        progress_percent: 0,
        episode_text: SharedString::new(),
        poster_path: SharedString::new(),
        poster_image: Image::default(),
        has_cached_poster: false,
    }
}

fn set_match_queue(window: &MainWindow, cards: &[UiMediaCardData]) {
    window.set_match_queue(ModelRc::from(Rc::new(VecModel::from(
        cards.iter().map(to_slint_card).collect::<Vec<_>>(),
    ))));
}

fn to_slint_card(card: &UiMediaCardData) -> UiMediaCard {
    UiMediaCard {
        media_id: card.media_id as i32,
        subject_id: card.subject_id as i32,
        title: card.title.as_str().into(),
        subtitle: card.subtitle.as_str().into(),
        status_text: card.status_text.as_str().into(),
        match_status: card.match_status.as_str().into(),
        progress_percent: card.progress_percent,
        episode_text: card.episode_text.as_str().into(),
        poster_path: card.poster_path.as_str().into(),
        poster_image: load_image(&card.poster_path),
        has_cached_poster: card.has_cached_poster,
    }
}

fn set_subject_detail(window: &MainWindow, detail: UiSubjectDetailData) {
    let files = detail
        .files
        .iter()
        .map(|file| SharedString::from(file.as_str()))
        .collect::<Vec<_>>();
    window.set_detail_files(ModelRc::from(Rc::new(VecModel::from(files))));
    let episodes = detail
        .episodes
        .iter()
        .map(|episode| SharedString::from(episode.as_str()))
        .collect::<Vec<_>>();
    window.set_detail_episodes(ModelRc::from(Rc::new(VecModel::from(episodes))));
    window.set_subject_detail(UiSubjectDetail {
        media_id: detail.media_id as i32,
        subject_id: detail.subject_id as i32,
        title: detail.title.as_str().into(),
        title_cn: detail.title_cn.as_str().into(),
        summary: detail.summary.as_str().into(),
        air_date: detail.air_date.as_str().into(),
        rating_text: detail.rating_text.as_str().into(),
        rank_text: detail.rank_text.as_str().into(),
        poster_path: detail.poster_path.as_str().into(),
        hero_path: detail.hero_path.as_str().into(),
        poster_image: load_image(&detail.poster_path),
        hero_image: load_image(&detail.hero_path),
        match_status: detail.match_status.as_str().into(),
        cache_status: detail.cache_status.as_str().into(),
    });
}

fn set_empty_detail(window: &MainWindow) {
    set_subject_detail(
        window,
        UiSubjectDetailData {
            media_id: 0,
            subject_id: 0,
            title: "Select a media item".to_string(),
            title_cn: String::new(),
            summary: "No media selected.".to_string(),
            air_date: "-".to_string(),
            rating_text: "-".to_string(),
            rank_text: "-".to_string(),
            poster_path: String::new(),
            hero_path: String::new(),
            match_status: "idle".to_string(),
            cache_status: "Images not cached".to_string(),
            files: Vec::new(),
            episodes: Vec::new(),
        },
    );
}

fn refresh_candidates(
    window: &MainWindow,
    context: &AppContext,
    state: &Arc<Mutex<UiState>>,
    media_id: i64,
) {
    match context.metadata.ui_candidates(media_id) {
        Ok(candidates) => {
            let selected = candidates
                .iter()
                .find(|candidate| candidate.selected)
                .or_else(|| candidates.first())
                .cloned()
                .unwrap_or_else(empty_candidate);
            state
                .lock()
                .expect("ui state mutex poisoned")
                .selected_candidate_id = if selected.candidate_id > 0 {
                Some(selected.candidate_id)
            } else {
                None
            };
            set_candidates(window, &candidates);
            set_candidate_preview(window, &selected);
        }
        Err(error) => push_log(
            window,
            state,
            "error",
            &format!("load candidates failed: {error}"),
        ),
    }
}

fn set_candidates(window: &MainWindow, candidates: &[UiCandidateData]) {
    window.set_candidates(ModelRc::from(Rc::new(VecModel::from(
        candidates
            .iter()
            .map(to_slint_candidate)
            .collect::<Vec<_>>(),
    ))));
}

fn set_candidate_preview(window: &MainWindow, candidate: &UiCandidateData) {
    window.set_candidate_preview(to_slint_candidate(candidate));
}

fn to_slint_candidate(candidate: &UiCandidateData) -> UiCandidate {
    UiCandidate {
        candidate_id: candidate.candidate_id as i32,
        media_id: candidate.media_id as i32,
        title: candidate.title.as_str().into(),
        subtitle: candidate.subtitle.as_str().into(),
        summary: candidate.summary.as_str().into(),
        score_text: candidate.score_text.as_str().into(),
        selected: candidate.selected,
    }
}

fn empty_candidate() -> UiCandidateData {
    UiCandidateData {
        candidate_id: 0,
        media_id: 0,
        title: "No candidate selected".to_string(),
        subtitle: "Run Match Selected or Match All".to_string(),
        summary: "Bangumi search results will appear here as metadata candidates.".to_string(),
        score_text: "-".to_string(),
        selected: false,
    }
}

fn refresh_selected_detail(window: &MainWindow, context: &AppContext, state: &BridgeState) {
    let media_id = state
        .inner
        .lock()
        .expect("ui state mutex poisoned")
        .selected_media_id;
    if let Some(media_id) = media_id {
        match context.metadata.subject_detail_for_media(media_id) {
            Ok(detail) => set_subject_detail(window, detail),
            Err(error) => push_log(
                window,
                &state.inner,
                "error",
                &format!("refresh detail failed: {error}"),
            ),
        }
    }
}

fn selected_media_id(state: &Arc<Mutex<UiState>>) -> Option<i64> {
    state
        .lock()
        .expect("ui state mutex poisoned")
        .selected_media_id
}

fn selected_media(state: &Arc<Mutex<UiState>>) -> Option<MediaItem> {
    let state = state.lock().expect("ui state mutex poisoned");
    let selected = state.selected_media_id?;
    state
        .media
        .iter()
        .find(|media| media.id == selected)
        .cloned()
}

fn append_log(window: &Weak<MainWindow>, state: &Arc<Mutex<UiState>>, level: &str, message: &str) {
    if let Some(window) = window.upgrade() {
        append_log_to_window(&window, state, level, message);
    }
}

fn append_log_to_window(
    window: &MainWindow,
    state: &Arc<Mutex<UiState>>,
    level: &str,
    message: &str,
) {
    push_log(window, state, level, message);
}

fn push_log(window: &MainWindow, state: &Arc<Mutex<UiState>>, level: &str, message: &str) {
    let logs = {
        let mut state = state.lock().expect("ui state mutex poisoned");
        if state.logs.len() == MAX_LOG_LINES {
            state.logs.pop_front();
        }
        state.logs.push_back(LogLineData {
            level: level.to_string(),
            message: message.to_string(),
            timestamp: log_timestamp(),
        });
        state.logs.iter().cloned().collect::<Vec<_>>()
    };

    window.set_log_lines(ModelRc::from(Rc::new(VecModel::from(
        logs.iter()
            .map(|line| UiLogLine {
                level: line.level.as_str().into(),
                message: line.message.as_str().into(),
                timestamp: line.timestamp.as_str().into(),
            })
            .collect::<Vec<_>>(),
    ))));
}

fn log_timestamp() -> String {
    let now = crate::task::unix_timestamp_ms();
    let seconds = (now / 1000) % 86_400;
    format!(
        "{:02}:{:02}:{:02}",
        seconds / 3600,
        (seconds % 3600) / 60,
        seconds % 60
    )
}

fn load_image(path: &str) -> Image {
    if path.trim().is_empty() {
        return Image::default();
    }
    Image::load_from_path(Path::new(path)).unwrap_or_default()
}
