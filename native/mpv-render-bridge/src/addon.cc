#include <node_api.h>

#include <mpv/client.h>
#include <mpv/render.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace {

struct NativePlayer {
  mpv_handle* handle = nullptr;
  mpv_render_context* render_context = nullptr;
  bool loaded = false;
};

std::unique_ptr<NativePlayer> g_player;

void SetString(napi_env env, napi_value object, const char* name, const std::string& value) {
  napi_value property;
  napi_create_string_utf8(env, value.c_str(), value.size(), &property);
  napi_set_named_property(env, object, name, property);
}

void SetBool(napi_env env, napi_value object, const char* name, bool value) {
  napi_value property;
  napi_get_boolean(env, value, &property);
  napi_set_named_property(env, object, name, property);
}

void SetNumber(napi_env env, napi_value object, const char* name, double value) {
  napi_value property;
  napi_create_double(env, value, &property);
  napi_set_named_property(env, object, name, property);
}

std::string MpvError(int code) {
  const char* message = mpv_error_string(code);
  return message ? message : "unknown libmpv error";
}

void DestroyPlayer() {
  if (!g_player) {
    return;
  }
  if (g_player->render_context) {
    mpv_render_context_free(g_player->render_context);
    g_player->render_context = nullptr;
  }
  if (g_player->handle) {
    mpv_terminate_destroy(g_player->handle);
    g_player->handle = nullptr;
  }
  g_player.reset();
}

bool EnsurePlayer(std::string& error) {
  if (g_player) {
    return true;
  }

  auto player = std::make_unique<NativePlayer>();
  player->handle = mpv_create();
  if (!player->handle) {
    error = "failed to create libmpv handle";
    return false;
  }

  mpv_set_option_string(player->handle, "terminal", "no");
  mpv_set_option_string(player->handle, "config", "no");
  mpv_set_option_string(player->handle, "vo", "libmpv");
  mpv_set_option_string(player->handle, "idle", "yes");
  mpv_set_option_string(player->handle, "keep-open", "yes");
  mpv_set_option_string(player->handle, "sub-auto", "fuzzy");
  mpv_set_option_string(player->handle, "sub-ass", "yes");
  mpv_set_option_string(player->handle, "embeddedfonts", "yes");
  mpv_set_option_string(player->handle, "sub-scale-by-window", "yes");
  mpv_set_option_string(player->handle, "audio-display", "no");
  mpv_set_option_string(player->handle, "input-default-bindings", "yes");
  mpv_set_option_string(player->handle, "video-timing-offset", "0");
  mpv_set_option_string(player->handle, "hr-seek", "yes");

  int code = mpv_initialize(player->handle);
  if (code < 0) {
    error = MpvError(code);
    mpv_terminate_destroy(player->handle);
    return false;
  }

  mpv_render_param params[] = {
    {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(MPV_RENDER_API_TYPE_SW)},
    {MPV_RENDER_PARAM_INVALID, nullptr},
  };

  code = mpv_render_context_create(&player->render_context, player->handle, params);
  if (code < 0) {
    error = MpvError(code);
    mpv_terminate_destroy(player->handle);
    return false;
  }

  g_player = std::move(player);
  return true;
}

bool Command(NativePlayer& player, const std::vector<std::string>& args, std::string& error) {
  std::vector<const char*> pointers;
  pointers.reserve(args.size() + 1);
  for (const auto& arg : args) {
    pointers.push_back(arg.c_str());
  }
  pointers.push_back(nullptr);
  const int code = mpv_command(player.handle, pointers.data());
  if (code < 0) {
    error = MpvError(code);
    return false;
  }
  return true;
}

bool SetPropertyString(NativePlayer& player, const char* property, const std::string& value, std::string& error) {
  const int code = mpv_set_property_string(player.handle, property, value.c_str());
  if (code < 0) {
    error = MpvError(code);
    return false;
  }
  return true;
}

bool GetPropertyDouble(NativePlayer& player, const char* property, double& value) {
  return mpv_get_property(player.handle, property, MPV_FORMAT_DOUBLE, &value) >= 0;
}

bool GetPropertyInt64(NativePlayer& player, const char* property, int64_t& value) {
  return mpv_get_property(player.handle, property, MPV_FORMAT_INT64, &value) >= 0;
}

bool GetPropertyFlag(NativePlayer& player, const char* property, bool& value) {
  int flag = 0;
  if (mpv_get_property(player.handle, property, MPV_FORMAT_FLAG, &flag) < 0) {
    return false;
  }
  value = flag != 0;
  return true;
}

const mpv_node* MapValue(const mpv_node& node, const char* key) {
  if (node.format != MPV_FORMAT_NODE_MAP || !node.u.list) {
    return nullptr;
  }
  const mpv_node_list* list = node.u.list;
  for (int i = 0; i < list->num; ++i) {
    if (list->keys[i] && std::string(list->keys[i]) == key) {
      return &list->values[i];
    }
  }
  return nullptr;
}

std::string NodeString(const mpv_node& node) {
  if (node.format == MPV_FORMAT_STRING && node.u.string) {
    return node.u.string;
  }
  return "";
}

int64_t NodeInt(const mpv_node& node) {
  if (node.format == MPV_FORMAT_INT64) {
    return node.u.int64;
  }
  return 0;
}

bool NodeBool(const mpv_node& node) {
  if (node.format == MPV_FORMAT_FLAG) {
    return node.u.flag != 0;
  }
  return false;
}

void AddTracks(napi_env env, napi_value result, NativePlayer& player, const char* property_name, const char* wanted_type) {
  napi_value tracks;
  napi_create_array(env, &tracks);
  uint32_t output_index = 0;

  mpv_node root;
  if (mpv_get_property(player.handle, "track-list", MPV_FORMAT_NODE, &root) < 0) {
    napi_set_named_property(env, result, property_name, tracks);
    return;
  }

  if (root.format == MPV_FORMAT_NODE_ARRAY && root.u.list) {
    const mpv_node_list* list = root.u.list;
    for (int i = 0; i < list->num; ++i) {
      const mpv_node& track_node = list->values[i];
      const mpv_node* type_node = MapValue(track_node, "type");
      if (!type_node || NodeString(*type_node) != wanted_type) {
        continue;
      }

      napi_value track;
      napi_create_object(env, &track);
      const mpv_node* id = MapValue(track_node, "id");
      const mpv_node* title = MapValue(track_node, "title");
      const mpv_node* lang = MapValue(track_node, "lang");
      const mpv_node* codec = MapValue(track_node, "codec");
      const mpv_node* selected = MapValue(track_node, "selected");
      const mpv_node* external = MapValue(track_node, "external");
      SetNumber(env, track, "id", id ? static_cast<double>(NodeInt(*id)) : 0);
      SetString(env, track, "kind", wanted_type);
      SetString(env, track, "title", title ? NodeString(*title) : "");
      SetString(env, track, "lang", lang ? NodeString(*lang) : "");
      SetString(env, track, "codec", codec ? NodeString(*codec) : "");
      SetBool(env, track, "selected", selected ? NodeBool(*selected) : false);
      SetBool(env, track, "external", external ? NodeBool(*external) : false);
      napi_set_element(env, tracks, output_index++, track);
    }
  }

  mpv_free_node_contents(&root);
  napi_set_named_property(env, result, property_name, tracks);
}

napi_value ErrorObject(napi_env env, const std::string& stage, const std::string& error) {
  napi_value result;
  napi_create_object(env, &result);
  SetBool(env, result, "ok", false);
  SetString(env, result, "stage", stage);
  SetString(env, result, "error", error);
  return result;
}

napi_value PlayerState(napi_env env) {
  napi_value result;
  napi_create_object(env, &result);
  if (!g_player) {
    SetBool(env, result, "ok", false);
    SetString(env, result, "stage", "notReady");
    SetBool(env, result, "loaded", false);
    return result;
  }

  SetBool(env, result, "ok", true);
  SetBool(env, result, "loaded", g_player->loaded);
  AddTracks(env, result, *g_player, "audioTracks", "audio");
  AddTracks(env, result, *g_player, "subtitleTracks", "sub");

  double duration = 0;
  double position = 0;
  double volume = 0;
  double fps = 0;
  int64_t video_width = 0;
  int64_t video_height = 0;
  bool paused = false;
  if (GetPropertyDouble(*g_player, "duration", duration)) {
    SetNumber(env, result, "duration", duration);
  }
  if (GetPropertyDouble(*g_player, "time-pos", position)) {
    SetNumber(env, result, "position", position);
  }
  if (GetPropertyFlag(*g_player, "pause", paused)) {
    SetBool(env, result, "paused", paused);
  }
  if (GetPropertyDouble(*g_player, "volume", volume)) {
    SetNumber(env, result, "volume", volume);
  }
  if (GetPropertyDouble(*g_player, "estimated-vf-fps", fps) && fps > 0) {
    SetNumber(env, result, "fps", fps);
  }
  if (GetPropertyInt64(*g_player, "width", video_width) && video_width > 0) {
    SetNumber(env, result, "videoWidth", static_cast<double>(video_width));
  }
  if (GetPropertyInt64(*g_player, "height", video_height) && video_height > 0) {
    SetNumber(env, result, "videoHeight", static_cast<double>(video_height));
  }
  return result;
}

napi_value SeekState(napi_env env, double position) {
  napi_value result;
  napi_create_object(env, &result);
  if (!g_player) {
    SetBool(env, result, "ok", false);
    SetString(env, result, "stage", "notReady");
    SetBool(env, result, "loaded", false);
    return result;
  }

  SetBool(env, result, "ok", true);
  SetBool(env, result, "loaded", g_player->loaded);
  SetNumber(env, result, "position", position);

  double duration = 0;
  double volume = 0;
  double fps = 0;
  int64_t video_width = 0;
  int64_t video_height = 0;
  bool paused = false;
  if (GetPropertyDouble(*g_player, "duration", duration)) {
    SetNumber(env, result, "duration", duration);
  }
  if (GetPropertyFlag(*g_player, "pause", paused)) {
    SetBool(env, result, "paused", paused);
  }
  if (GetPropertyDouble(*g_player, "volume", volume)) {
    SetNumber(env, result, "volume", volume);
  }
  if (GetPropertyDouble(*g_player, "estimated-vf-fps", fps) && fps > 0) {
    SetNumber(env, result, "fps", fps);
  }
  if (GetPropertyInt64(*g_player, "width", video_width) && video_width > 0) {
    SetNumber(env, result, "videoWidth", static_cast<double>(video_width));
  }
  if (GetPropertyInt64(*g_player, "height", video_height) && video_height > 0) {
    SetNumber(env, result, "videoHeight", static_cast<double>(video_height));
  }
  return result;
}

std::string GetStringArg(napi_env env, napi_value value) {
  size_t size = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &size);
  std::string result(size, '\0');
  napi_get_value_string_utf8(env, value, result.data(), result.size() + 1, &size);
  return result;
}

double GetNumberArg(napi_env env, napi_value value, double fallback) {
  double result = fallback;
  napi_get_value_double(env, value, &result);
  return result;
}

bool GetBoolArg(napi_env env, napi_value value, bool fallback) {
  bool result = fallback;
  napi_get_value_bool(env, value, &result);
  return result;
}

void FinalizeFrameBuffer(napi_env, void* data, void*) {
  delete[] static_cast<uint8_t*>(data);
}

napi_value GetBuildInfo(napi_env env, napi_callback_info) {
  napi_value result;
  napi_create_object(env, &result);
  SetBool(env, result, "available", true);
  SetString(env, result, "bridge", "node-api");
  SetString(env, result, "renderApi", MPV_RENDER_API_TYPE_SW);
  SetString(env, result, "renderBackend", "libmpv-sw-to-webgl-texture");
  SetNumber(env, result, "nodeApiVersion", NAPI_VERSION);
  SetNumber(env, result, "mpvClientApiVersion", static_cast<double>(mpv_client_api_version()));
  return result;
}

napi_value ProbeRenderContext(napi_env env, napi_callback_info) {
  std::string error;
  if (!EnsurePlayer(error)) {
    return ErrorObject(env, "ensurePlayer", error);
  }

  napi_value result;
  napi_create_object(env, &result);
  SetBool(env, result, "ok", true);
  SetString(env, result, "stage", "ready");
  SetString(env, result, "renderApi", MPV_RENDER_API_TYPE_SW);
  SetString(env, result, "renderBackend", "libmpv-sw-to-webgl-texture");
  SetNumber(env, result, "mpvClientApiVersion", static_cast<double>(mpv_client_api_version()));
  return result;
}

napi_value ProbeWebglTextureRenderer(napi_env env, napi_callback_info) {
  std::string error;
  if (!EnsurePlayer(error)) {
    return ErrorObject(env, "ensurePlayer", error);
  }

  napi_value result;
  napi_create_object(env, &result);
  SetBool(env, result, "ok", true);
  SetString(env, result, "stage", "softwareFrameUpload");
  SetString(env, result, "target", "webglTexture");
  SetString(env, result, "renderApi", MPV_RENDER_API_TYPE_SW);
  SetString(env, result, "transport", "electron-ipc");
  SetString(env, result, "upload", "texSubImage2D");
  return result;
}

napi_value Load(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    return ErrorObject(env, "load", "path is required");
  }

  std::string error;
  if (!EnsurePlayer(error)) {
    return ErrorObject(env, "ensurePlayer", error);
  }

  const std::string path = GetStringArg(env, args[0]);
  if (!Command(*g_player, {"loadfile", path, "replace"}, error)) {
    return ErrorObject(env, "loadfile", error);
  }
  g_player->loaded = true;
  std::this_thread::sleep_for(std::chrono::milliseconds(160));
  return PlayerState(env);
}

napi_value Stop(napi_env env, napi_callback_info) {
  std::string error;
  if (!EnsurePlayer(error)) {
    return ErrorObject(env, "ensurePlayer", error);
  }
  if (!Command(*g_player, {"stop"}, error)) {
    return ErrorObject(env, "stop", error);
  }
  g_player->loaded = false;
  return PlayerState(env);
}

napi_value SetPause(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  const bool paused = argc > 0 ? GetBoolArg(env, args[0], false) : false;
  std::string error;
  if (!EnsurePlayer(error)) {
    return ErrorObject(env, "ensurePlayer", error);
  }
  if (!SetPropertyString(*g_player, "pause", paused ? "yes" : "no", error)) {
    return ErrorObject(env, "setPause", error);
  }
  return PlayerState(env);
}

napi_value SetTrack(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    return ErrorObject(env, "setTrack", "kind and id are required");
  }

  std::string error;
  if (!EnsurePlayer(error)) {
    return ErrorObject(env, "ensurePlayer", error);
  }

  const std::string kind = GetStringArg(env, args[0]);
  napi_valuetype id_type;
  napi_typeof(env, args[1], &id_type);
  const char* property = kind == "audio" ? "aid" : "sid";
  std::string value = "no";
  if (id_type == napi_number) {
    value = std::to_string(static_cast<int64_t>(GetNumberArg(env, args[1], 0)));
  }
  if (!SetPropertyString(*g_player, property, value, error)) {
    return ErrorObject(env, "setTrack", error);
  }
  return PlayerState(env);
}

napi_value AddSubtitle(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    return ErrorObject(env, "addSubtitle", "path is required");
  }

  std::string error;
  if (!EnsurePlayer(error)) {
    return ErrorObject(env, "ensurePlayer", error);
  }
  if (!g_player->loaded) {
    return ErrorObject(env, "addSubtitle", "no media loaded");
  }

  const std::string path = GetStringArg(env, args[0]);
  if (path.empty()) {
    return ErrorObject(env, "addSubtitle", "path is empty");
  }
  if (!Command(*g_player, {"sub-add", path, "select"}, error)) {
    return ErrorObject(env, "sub-add", error);
  }
  std::this_thread::sleep_for(std::chrono::milliseconds(120));
  return PlayerState(env);
}

napi_value Seek(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    return ErrorObject(env, "seek", "position is required");
  }

  std::string error;
  if (!EnsurePlayer(error)) {
    return ErrorObject(env, "ensurePlayer", error);
  }

  const double position = std::max(0.0, GetNumberArg(env, args[0], 0));
  if (!Command(*g_player, {"seek", std::to_string(position), "absolute+exact"}, error)) {
    return ErrorObject(env, "seek", error);
  }
  return SeekState(env, position);
}

napi_value SetVolume(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  const double volume = argc > 0 ? std::clamp(GetNumberArg(env, args[0], 100), 0.0, 100.0) : 100.0;

  std::string error;
  if (!EnsurePlayer(error)) {
    return ErrorObject(env, "ensurePlayer", error);
  }
  if (!SetPropertyString(*g_player, "volume", std::to_string(volume), error)) {
    return ErrorObject(env, "setVolume", error);
  }
  return PlayerState(env);
}

napi_value GetState(napi_env env, napi_callback_info) {
  return PlayerState(env);
}

napi_value RenderFrame(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    return ErrorObject(env, "renderFrame", "width and height are required");
  }

  const int width = std::clamp(static_cast<int>(GetNumberArg(env, args[0], 640)), 2, 3840);
  const int height = std::clamp(static_cast<int>(GetNumberArg(env, args[1], 360)), 2, 2160);

  std::string error;
  if (!EnsurePlayer(error)) {
    return ErrorObject(env, "ensurePlayer", error);
  }
  if (!g_player->loaded) {
    return ErrorObject(env, "renderFrame", "no media loaded");
  }
  mpv_render_context_update(g_player->render_context);

  const size_t pixel_count = static_cast<size_t>(width) * static_cast<size_t>(height);
  const size_t byte_count = pixel_count * 4;
  auto* pixels = new uint8_t[byte_count];
  const int size[] = {width, height};
  size_t stride = static_cast<size_t>(width) * 4;
  char format[] = "rgb0";
  mpv_render_param params[] = {
    {MPV_RENDER_PARAM_SW_SIZE, const_cast<int*>(size)},
    {MPV_RENDER_PARAM_SW_FORMAT, format},
    {MPV_RENDER_PARAM_SW_STRIDE, &stride},
    {MPV_RENDER_PARAM_SW_POINTER, pixels},
    {MPV_RENDER_PARAM_INVALID, nullptr},
  };
  const int code = mpv_render_context_render(g_player->render_context, params);
  if (code < 0) {
    delete[] pixels;
    return ErrorObject(env, "mpv_render_context_render", MpvError(code));
  }
  mpv_render_context_report_swap(g_player->render_context);

  napi_value result;
  napi_create_object(env, &result);
  SetBool(env, result, "ok", true);
  SetNumber(env, result, "width", width);
  SetNumber(env, result, "height", height);
  SetNumber(env, result, "stride", static_cast<double>(stride));
  double position = 0;
  if (GetPropertyDouble(*g_player, "time-pos", position)) {
    SetNumber(env, result, "position", position);
  }

  napi_value buffer;
  napi_create_external_buffer(env, byte_count, pixels, FinalizeFrameBuffer, nullptr, &buffer);
  napi_set_named_property(env, result, "pixels", buffer);
  return result;
}

napi_value Shutdown(napi_env env, napi_callback_info) {
  DestroyPlayer();
  napi_value result;
  napi_create_object(env, &result);
  SetBool(env, result, "ok", true);
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
    {"getBuildInfo", nullptr, GetBuildInfo, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"probeRenderContext", nullptr, ProbeRenderContext, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"probeWebglTextureRenderer", nullptr, ProbeWebglTextureRenderer, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"load", nullptr, Load, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stop", nullptr, Stop, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setPause", nullptr, SetPause, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setTrack", nullptr, SetTrack, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"addSubtitle", nullptr, AddSubtitle, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"seek", nullptr, Seek, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setVolume", nullptr, SetVolume, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"getState", nullptr, GetState, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"renderFrame", nullptr, RenderFrame, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"shutdown", nullptr, Shutdown, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 13, descriptors);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
