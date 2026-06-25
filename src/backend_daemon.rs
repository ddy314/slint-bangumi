use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::app::AppContext;
use crate::backend_api::{
    CatalogSearchRequest, DanmakuTrackRequest, DownloadTaskActionRequest, EpisodeResourcesRequest,
    FrontendEditableSettings, MediaSourceRequest, OnlineSubjectRequest, OpenMediaRequest,
    RefreshSubjectRequest, StartResourceDownloadRequest, control_download_task, danmaku_track,
    download_tasks, episode_resources, frontend_event_from_app, media_source, online_subject,
    open_media, refresh_subject_metadata, save_settings_config, scan, search_catalog,
    settings_config, snapshot, start_resource_download, test_qbittorrent_connection,
};
use crate::error::{AppError, AppResult, io_error};
use crate::task::AppEvent;

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: Option<String>,
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcNotification {
    jsonrpc: &'static str,
    method: &'static str,
    params: Value,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

pub fn run_backend_daemon(context: AppContext) -> AppResult<()> {
    let stdout = Arc::new(Mutex::new(std::io::stdout()));
    start_event_forwarder(&context, stdout.clone());

    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = line.map_err(|error| io_error("<stdin>", error))?;
        if line.trim().is_empty() {
            continue;
        }

        let response = handle_json_rpc_line(&context, &line);
        let mut stdout = stdout.lock().expect("stdout mutex poisoned");
        write_json_line(&mut *stdout, &response)?;
    }

    Ok(())
}

fn start_event_forwarder(context: &AppContext, stdout: Arc<Mutex<std::io::Stdout>>) {
    let Some(receiver) = context
        .event_receiver
        .lock()
        .expect("event receiver mutex poisoned")
        .take()
    else {
        return;
    };

    thread::spawn(move || forward_events(receiver, stdout));
}

fn forward_events(receiver: mpsc::Receiver<AppEvent>, stdout: Arc<Mutex<std::io::Stdout>>) {
    for event in receiver {
        let Ok(params) = serde_json::to_value(frontend_event_from_app(event)) else {
            continue;
        };
        let notification = JsonRpcNotification {
            jsonrpc: "2.0",
            method: "backend/event",
            params,
        };
        let mut stdout = stdout.lock().expect("stdout mutex poisoned");
        let _ = write_json_line(&mut *stdout, &notification);
    }
}

fn handle_json_rpc_line(context: &AppContext, line: &str) -> JsonRpcResponse {
    let request = match serde_json::from_str::<JsonRpcRequest>(line) {
        Ok(request) => request,
        Err(error) => {
            return error_response(Value::Null, -32700, format!("parse error: {error}"));
        }
    };

    let id = request.id.unwrap_or(Value::Null);
    if request.jsonrpc.as_deref() != Some("2.0") {
        return error_response(id, -32600, "invalid JSON-RPC version".to_string());
    }

    match dispatch(context, &request.method, request.params) {
        Ok(result) => JsonRpcResponse {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        },
        Err(error) => error_response(id, -32000, error.to_string()),
    }
}

fn dispatch(context: &AppContext, method: &str, params: Option<Value>) -> AppResult<Value> {
    match method {
        "snapshot" => to_value(snapshot(context)?),
        "scanLibrary" => to_value(scan(context)?),
        "getSettings" => to_value(settings_config(context)?),
        "saveSettings" => {
            let input: FrontendEditableSettings = from_params(params)?;
            to_value(save_settings_config(context, input)?)
        }
        "openMedia" => {
            let input: OpenMediaRequest = from_params(params)?;
            to_value(open_media(context, input)?)
        }
        "mediaSource" => {
            let input: MediaSourceRequest = from_params(params)?;
            to_value(media_source(context, input)?)
        }
        "danmakuTrack" => {
            let input: DanmakuTrackRequest = from_params(params)?;
            to_value(danmaku_track(context, input)?)
        }
        "searchCatalog" => {
            let input: CatalogSearchRequest = from_params(params)?;
            to_value(search_catalog(context, input)?)
        }
        "onlineSubject" => {
            let input: OnlineSubjectRequest = from_params(params)?;
            to_value(online_subject(context, input)?)
        }
        "refreshSubjectMetadata" => {
            let input: RefreshSubjectRequest = from_params(params)?;
            to_value(refresh_subject_metadata(context, input)?)
        }
        "episodeResources" => {
            let input: EpisodeResourcesRequest = from_params(params)?;
            to_value(episode_resources(context, input)?)
        }
        "startResourceDownload" => {
            let input: StartResourceDownloadRequest = from_params(params)?;
            to_value(start_resource_download(context, input)?)
        }
        "downloadTasks" => to_value(download_tasks(context)?),
        "controlDownloadTask" => {
            let input: DownloadTaskActionRequest = from_params(params)?;
            to_value(control_download_task(context, input)?)
        }
        "testQbittorrentConnection" => to_value(test_qbittorrent_connection(context)),
        other => Err(AppError::Api(format!("unknown JSON-RPC method: {other}"))),
    }
}

fn from_params<T>(params: Option<Value>) -> AppResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(params.unwrap_or(Value::Null)).map_err(AppError::Json)
}

fn to_value<T: Serialize>(value: T) -> AppResult<Value> {
    serde_json::to_value(value).map_err(AppError::Json)
}

fn error_response(id: Value, code: i64, message: String) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(JsonRpcError { code, message }),
    }
}

fn write_json_line<T: Serialize>(writer: &mut impl Write, value: &T) -> AppResult<()> {
    serde_json::to_writer(&mut *writer, value)?;
    writer
        .write_all(b"\n")
        .map_err(|error| io_error("<stdout>", error))?;
    writer
        .flush()
        .map_err(|error| io_error("<stdout>", error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_json_serializes_parse_error() {
        let response = handle_json_rpc_line_stub("{bad json");
        assert_eq!(response["jsonrpc"], "2.0");
        assert_eq!(response["id"], Value::Null);
        assert_eq!(response["error"]["code"], -32700);
    }

    #[test]
    fn notification_shape_matches_json_rpc() {
        let event = frontend_event_from_app(AppEvent::ScanProgress {
            scanned: 10,
            indexed: 8,
        });
        let notification = JsonRpcNotification {
            jsonrpc: "2.0",
            method: "backend/event",
            params: serde_json::to_value(event).expect("serialize event"),
        };
        let value = serde_json::to_value(notification).expect("serialize notification");
        assert_eq!(value["jsonrpc"], "2.0");
        assert_eq!(value["method"], "backend/event");
        assert_eq!(value["params"]["type"], "scanProgress");
        assert_eq!(value["params"]["scanned"], 10);
    }

    fn handle_json_rpc_line_stub(line: &str) -> Value {
        let response = match serde_json::from_str::<JsonRpcRequest>(line) {
            Ok(_) => panic!("stub only covers parse errors"),
            Err(error) => error_response(Value::Null, -32700, format!("parse error: {error}")),
        };
        serde_json::to_value(response).expect("serialize response")
    }
}
