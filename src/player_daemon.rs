use serde::{Deserialize, Serialize};
use std::ffi::{CStr, CString, c_char, c_double, c_int, c_void};
use std::io::{BufRead, Write};
use std::ptr;

const MPV_FORMAT_STRING: c_int = 1;
const MPV_FORMAT_FLAG: c_int = 3;
const MPV_FORMAT_INT64: c_int = 4;
const MPV_FORMAT_DOUBLE: c_int = 5;
const MPV_FORMAT_NODE: c_int = 6;
const MPV_FORMAT_NODE_ARRAY: c_int = 7;
const MPV_FORMAT_NODE_MAP: c_int = 8;

#[repr(C)]
struct MpvHandle {
    _private: [u8; 0],
}

#[repr(C)]
union MpvNodeValue {
    string: *mut c_char,
    flag: c_int,
    int64: i64,
    double_: c_double,
    list: *mut MpvNodeList,
}

#[repr(C)]
struct MpvNode {
    u: MpvNodeValue,
    format: c_int,
}

#[repr(C)]
struct MpvNodeList {
    num: c_int,
    values: *mut MpvNode,
    keys: *mut *mut c_char,
}

#[link(name = "mpv")]
unsafe extern "C" {
    fn mpv_create() -> *mut MpvHandle;
    fn mpv_initialize(ctx: *mut MpvHandle) -> c_int;
    fn mpv_terminate_destroy(ctx: *mut MpvHandle);
    fn mpv_error_string(error: c_int) -> *const c_char;
    fn mpv_command(ctx: *mut MpvHandle, args: *const *const c_char) -> c_int;
    fn mpv_set_option_string(
        ctx: *mut MpvHandle,
        name: *const c_char,
        data: *const c_char,
    ) -> c_int;
    fn mpv_set_property_string(
        ctx: *mut MpvHandle,
        name: *const c_char,
        data: *const c_char,
    ) -> c_int;
    fn mpv_get_property(
        ctx: *mut MpvHandle,
        name: *const c_char,
        format: c_int,
        data: *mut c_void,
    ) -> c_int;
    fn mpv_free_node_contents(node: *mut MpvNode);
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayerRequest {
    id: u64,
    command: PlayerCommand,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum PlayerCommand {
    Load { path: String },
    SetTrack { kind: TrackKind, id: Option<i64> },
    SetPause { paused: bool },
    Seek { position: f64 },
    SetVolume { volume: f64 },
    Stop,
    State,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum TrackKind {
    Audio,
    Subtitle,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerResponse {
    id: u64,
    ok: bool,
    state: Option<PlayerState>,
    error: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    audio_tracks: Vec<PlayerTrack>,
    subtitle_tracks: Vec<PlayerTrack>,
    duration: Option<f64>,
    position: Option<f64>,
    paused: Option<bool>,
    volume: Option<f64>,
    fps: Option<f64>,
    video_width: Option<i64>,
    video_height: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerTrack {
    id: i64,
    kind: String,
    title: String,
    lang: String,
    codec: String,
    selected: bool,
    external: bool,
}

pub fn run_player_daemon() -> crate::error::AppResult<()> {
    let mut player = LibMpvPlayer::new().map_err(crate::error::AppError::Api)?;
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    for line in stdin.lock().lines() {
        let line = line.map_err(|err| crate::error::io_error("<stdin>", err))?;
        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<PlayerRequest>(&line) {
            Ok(request) => handle_request(&mut player, request),
            Err(error) => PlayerResponse {
                id: 0,
                ok: false,
                state: None,
                error: Some(format!("invalid player request: {error}")),
            },
        };

        writeln!(stdout, "{}", serde_json::to_string(&response)?)
            .map_err(|err| crate::error::io_error("<stdout>", err))?;
        stdout
            .flush()
            .map_err(|err| crate::error::io_error("<stdout>", err))?;
    }

    Ok(())
}

fn handle_request(player: &mut LibMpvPlayer, request: PlayerRequest) -> PlayerResponse {
    let result = match request.command {
        PlayerCommand::Load { path } => player.load(&path).and_then(|_| player.state()),
        PlayerCommand::SetTrack { kind, id } => {
            player.set_track(kind, id).and_then(|_| player.state())
        }
        PlayerCommand::SetPause { paused } => player.set_pause(paused).and_then(|_| player.state()),
        PlayerCommand::Seek { position } => player.seek(position).map(|_| player.seek_state(position)),
        PlayerCommand::SetVolume { volume } => {
            player.set_volume(volume).and_then(|_| player.state())
        }
        PlayerCommand::Stop => player.stop().and_then(|_| player.state()),
        PlayerCommand::State => player.state(),
    };

    match result {
        Ok(state) => PlayerResponse {
            id: request.id,
            ok: true,
            state: Some(state),
            error: None,
        },
        Err(error) => PlayerResponse {
            id: request.id,
            ok: false,
            state: None,
            error: Some(error),
        },
    }
}

struct LibMpvPlayer {
    handle: *mut MpvHandle,
}

impl LibMpvPlayer {
    fn new() -> Result<Self, String> {
        unsafe {
            let handle = mpv_create();
            if handle.is_null() {
                return Err("failed to create libmpv handle".to_string());
            }

            let player = Self { handle };
            player.set_option("terminal", "no")?;
            player.set_option("idle", "yes")?;
            player.set_option("force-window", "immediate")?;
            player.set_option("keep-open", "yes")?;
            player.set_option("input-default-bindings", "yes")?;
            player.set_option("input-vo-keyboard", "yes")?;
            player.set_option("osc", "yes")?;
            player.set_option("sub-auto", "fuzzy")?;
            player.set_option("sub-ass", "yes")?;
            player.set_option("embeddedfonts", "yes")?;
            player.set_option("sub-scale-by-window", "yes")?;
            player.set_option("audio-display", "no")?;
            player.set_option("hr-seek", "yes")?;
            check_mpv(mpv_initialize(handle))?;
            Ok(player)
        }
    }

    fn set_option(&self, name: &str, value: &str) -> Result<(), String> {
        let name = CString::new(name).map_err(|error| error.to_string())?;
        let value = CString::new(value).map_err(|error| error.to_string())?;
        unsafe {
            check_mpv(mpv_set_option_string(
                self.handle,
                name.as_ptr(),
                value.as_ptr(),
            ))
        }
    }

    fn load(&self, path: &str) -> Result<(), String> {
        self.command(&["loadfile", path, "replace"])?;
        // Track metadata is populated after the file starts loading. Give mpv a
        // short window so the first response can populate frontend controls.
        std::thread::sleep(std::time::Duration::from_millis(180));
        Ok(())
    }

    fn stop(&self) -> Result<(), String> {
        self.command(&["stop"])
    }

    fn set_pause(&self, paused: bool) -> Result<(), String> {
        let value = if paused { "yes" } else { "no" };
        self.set_property("pause", value)
    }

    fn seek(&self, position: f64) -> Result<(), String> {
        self.command(&["seek", &position.max(0.0).to_string(), "absolute", "keyframes"])
    }

    fn seek_state(&self, position: f64) -> PlayerState {
        PlayerState {
            duration: self.get_double_property("duration"),
            position: Some(position.max(0.0)),
            paused: self.get_flag_property("pause"),
            volume: self.get_double_property("volume"),
            fps: self.get_double_property("estimated-vf-fps"),
            video_width: self.get_int_property("width"),
            video_height: self.get_int_property("height"),
            ..PlayerState::default()
        }
    }

    fn set_volume(&self, volume: f64) -> Result<(), String> {
        self.set_property("volume", &volume.clamp(0.0, 100.0).to_string())
    }

    fn set_track(&self, kind: TrackKind, id: Option<i64>) -> Result<(), String> {
        let property = match kind {
            TrackKind::Audio => "aid",
            TrackKind::Subtitle => "sid",
        };
        let value = id.map_or_else(|| "no".to_string(), |id| id.to_string());
        self.set_property(property, &value)
    }

    fn set_property(&self, name: &str, value: &str) -> Result<(), String> {
        let name = CString::new(name).map_err(|error| error.to_string())?;
        let value = CString::new(value).map_err(|error| error.to_string())?;
        unsafe {
            check_mpv(mpv_set_property_string(
                self.handle,
                name.as_ptr(),
                value.as_ptr(),
            ))
        }
    }

    fn command(&self, args: &[&str]) -> Result<(), String> {
        let c_args = args
            .iter()
            .map(|arg| CString::new(*arg).map_err(|error| error.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        let mut pointers = c_args
            .iter()
            .map(|arg| arg.as_ptr())
            .collect::<Vec<*const c_char>>();
        pointers.push(ptr::null());
        unsafe { check_mpv(mpv_command(self.handle, pointers.as_ptr())) }
    }

    fn state(&self) -> Result<PlayerState, String> {
        let mut state = PlayerState {
            duration: self.get_double_property("duration"),
            position: self.get_double_property("time-pos"),
            paused: self.get_flag_property("pause"),
            volume: self.get_double_property("volume"),
            fps: self.get_double_property("estimated-vf-fps"),
            video_width: self.get_int_property("width"),
            video_height: self.get_int_property("height"),
            ..PlayerState::default()
        };
        let mut result = MpvNode {
            u: MpvNodeValue {
                list: ptr::null_mut(),
            },
            format: 0,
        };
        let name = CString::new("track-list").unwrap();
        unsafe {
            let code = mpv_get_property(
                self.handle,
                name.as_ptr(),
                MPV_FORMAT_NODE,
                &mut result as *mut MpvNode as *mut c_void,
            );
            if code < 0 {
                return Ok(state);
            }
            parse_track_list_into(&mut state, &result);
            mpv_free_node_contents(&mut result);
            Ok(state)
        }
    }

    fn get_double_property(&self, name: &str) -> Option<f64> {
        let name = CString::new(name).ok()?;
        let mut value = 0.0;
        let code = unsafe {
            mpv_get_property(
                self.handle,
                name.as_ptr(),
                MPV_FORMAT_DOUBLE,
                &mut value as *mut f64 as *mut c_void,
            )
        };
        (code >= 0).then_some(value)
    }

    fn get_flag_property(&self, name: &str) -> Option<bool> {
        let name = CString::new(name).ok()?;
        let mut value: c_int = 0;
        let code = unsafe {
            mpv_get_property(
                self.handle,
                name.as_ptr(),
                MPV_FORMAT_FLAG,
                &mut value as *mut c_int as *mut c_void,
            )
        };
        (code >= 0).then_some(value != 0)
    }

    fn get_int_property(&self, name: &str) -> Option<i64> {
        let name = CString::new(name).ok()?;
        let mut value: i64 = 0;
        let code = unsafe {
            mpv_get_property(
                self.handle,
                name.as_ptr(),
                MPV_FORMAT_INT64,
                &mut value as *mut i64 as *mut c_void,
            )
        };
        (code >= 0).then_some(value)
    }
}

impl Drop for LibMpvPlayer {
    fn drop(&mut self) {
        unsafe {
            if !self.handle.is_null() {
                mpv_terminate_destroy(self.handle);
            }
        }
    }
}

fn parse_track_list_into(state: &mut PlayerState, node: &MpvNode) {
    if node.format != MPV_FORMAT_NODE_ARRAY {
        return;
    }

    let Some(list) = (unsafe { node.u.list.as_ref() }) else {
        return;
    };

    for index in 0..list.num.max(0) as usize {
        let item = unsafe { &*list.values.add(index) };
        if item.format != MPV_FORMAT_NODE_MAP {
            continue;
        }
        let Some(track) = parse_track(item) else {
            continue;
        };

        match track.kind.as_str() {
            "audio" => state.audio_tracks.push(track),
            "sub" => state.subtitle_tracks.push(track),
            _ => {}
        }
    }
}

fn parse_track(node: &MpvNode) -> Option<PlayerTrack> {
    let id = map_int(node, "id")?;
    let kind = map_string(node, "type").unwrap_or_default();
    Some(PlayerTrack {
        id,
        kind,
        title: map_string(node, "title").unwrap_or_default(),
        lang: map_string(node, "lang").unwrap_or_default(),
        codec: map_string(node, "codec").unwrap_or_default(),
        selected: map_bool(node, "selected"),
        external: map_bool(node, "external"),
    })
}

fn map_value<'a>(node: &'a MpvNode, key: &str) -> Option<&'a MpvNode> {
    if node.format != MPV_FORMAT_NODE_MAP {
        return None;
    }
    let list = unsafe { node.u.list.as_ref()? };
    for index in 0..list.num.max(0) as usize {
        let raw_key = unsafe { *list.keys.add(index) };
        if raw_key.is_null() {
            continue;
        }
        let current_key = unsafe { CStr::from_ptr(raw_key) }.to_string_lossy();
        if current_key == key {
            return Some(unsafe { &*list.values.add(index) });
        }
    }
    None
}

fn map_string(node: &MpvNode, key: &str) -> Option<String> {
    let value = map_value(node, key)?;
    if value.format != MPV_FORMAT_STRING {
        return None;
    }
    let raw = unsafe { value.u.string };
    if raw.is_null() {
        None
    } else {
        Some(unsafe { CStr::from_ptr(raw) }.to_string_lossy().to_string())
    }
}

fn map_int(node: &MpvNode, key: &str) -> Option<i64> {
    let value = map_value(node, key)?;
    match value.format {
        MPV_FORMAT_INT64 => Some(unsafe { value.u.int64 }),
        MPV_FORMAT_DOUBLE => Some(unsafe { value.u.double_ } as i64),
        _ => None,
    }
}

fn map_bool(node: &MpvNode, key: &str) -> bool {
    let Some(value) = map_value(node, key) else {
        return false;
    };
    match value.format {
        MPV_FORMAT_FLAG => unsafe { value.u.flag != 0 },
        MPV_FORMAT_INT64 => unsafe { value.u.int64 != 0 },
        _ => false,
    }
}

fn check_mpv(code: c_int) -> Result<(), String> {
    if code >= 0 {
        Ok(())
    } else {
        let message = unsafe {
            let raw = mpv_error_string(code);
            if raw.is_null() {
                "unknown libmpv error".to_string()
            } else {
                CStr::from_ptr(raw).to_string_lossy().to_string()
            }
        };
        Err(message)
    }
}
