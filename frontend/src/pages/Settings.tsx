import { useEffect, useMemo, useState } from "react";
import { testQbittorrentConnection, type EditableSettings } from "../backend";
import { Button, Card, Switch } from "../ui";
import { ChevronRight, KeyIcon } from "../icons";
import { cn } from "../utils/cn";

type Section = "libraries" | "bangumi" | "dandanplay" | "resources" | "qbittorrent" | "about";

const sections: { id: Section; label: string; desc: string }[] = [
  { id: "libraries", label: "Media Libraries", desc: "目录与数据库" },
  { id: "bangumi", label: "Bangumi", desc: "元数据、匹配、图片缓存" },
  { id: "dandanplay", label: "DanDanPlay", desc: "弹幕匹配凭证" },
  { id: "resources", label: "Nyaa", desc: "在线资源搜索" },
  { id: "qbittorrent", label: "qBittorrent", desc: "本地下载器" },
  { id: "about", label: "About", desc: "当前构建信息" },
];

const emptySettings: EditableSettings = {
  mediaLibraries: [],
  databasePath: "data/nexplay.sqlite3",
  bangumiEnabled: true,
  bangumiBaseUrl: "https://api.bgm.tv",
  bangumiAccessToken: "",
  bangumiUserAgent: "NexPlay/0.1.0",
  bangumiRequestTimeoutSecs: 20,
  bangumiAutoMatch: true,
  bangumiCacheImages: true,
  dandanplayAppId: "",
  dandanplayAppSecret: "",
  dandanplayApiKey: "",
  nyaaEnabled: true,
  nyaaBaseUrl: "https://nyaa.si",
  nyaaCategory: "0_0",
  qbittorrentEnabled: false,
  qbittorrentBaseUrl: "http://127.0.0.1:8080",
  qbittorrentUsername: "admin",
  qbittorrentPassword: "",
  qbittorrentSavePath: "",
  qbittorrentCategory: "NexPlay",
  qbittorrentTags: "nexplay",
  loggingLevel: "info",
};

export function SettingsPage({
  onSnack,
}: {
  onSnack: (text: string, tone?: "neutral" | "success" | "danger") => void;
}) {
  const [section, setSection] = useState<Section>("libraries");
  const [settings, setSettings] = useState<EditableSettings>(emptySettings);
  const [librariesText, setLibrariesText] = useState("");
  const [loading, setLoading] = useState(Boolean(window.nexplay));
  const [saving, setSaving] = useState(false);
  const [testingQbit, setTestingQbit] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!window.nexplay) {
      setLoading(false);
      onSnack("当前页面没有连接到 NexPlay 后端，请从应用窗口使用设置页。", "danger");
      return;
    }

    window.nexplay
      .getSettings()
      .then((next) => {
        if (!alive) return;
        setSettings(next);
        setLibrariesText(next.mediaLibraries.join("\n"));
      })
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : String(caught);
        onSnack(`读取设置失败：${message}`, "danger");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const normalizedSettings = useMemo(
    () => ({
      ...settings,
      mediaLibraries: librariesText
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    }),
    [librariesText, settings]
  );

  const save = async () => {
    if (!window.nexplay) {
      onSnack("当前不是 Electron 环境，无法保存设置。", "danger");
      return;
    }

    setSaving(true);
    try {
      const saved = await window.nexplay.saveSettings(normalizedSettings);
      setSettings(saved);
      setLibrariesText(saved.mediaLibraries.join("\n"));
      onSnack("设置已保存到后端配置。", "success");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`保存设置失败：${message}`, "danger");
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof EditableSettings>(key: K, value: EditableSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const testQbit = async () => {
    if (!window.nexplay) {
      onSnack("当前不是 Electron 环境，无法测试 qBittorrent。", "danger");
      return;
    }

    setTestingQbit(true);
    try {
      const saved = await window.nexplay.saveSettings(normalizedSettings);
      setSettings(saved);
      setLibrariesText(saved.mediaLibraries.join("\n"));
      const result = await testQbittorrentConnection();
      onSnack(result.message, result.ok ? "success" : "danger");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`qBittorrent 连接失败：${message}`, "danger");
    } finally {
      setTestingQbit(false);
    }
  };

  return (
    <div className="page-shell h-full overflow-y-auto">
      <div className="mb-10 flex items-end justify-between gap-6">
        <div>
          <h1 className="text-[44px] font-bold leading-[1] tracking-tight">设置</h1>
          <div className="mt-3 text-[17px] font-medium text-[var(--color-on-surface-muted)]">
            这里的配置会直接写入 NexPlay 后端配置。
          </div>
        </div>
        <Button onClick={save} loading={saving} disabled={loading} className="h-10 px-5 text-[13px]">
          保存设置
        </Button>
      </div>

      <div className="grid grid-cols-[240px_minmax(0,1fr)] items-start gap-8">
        <Card className="p-2 settings-section-list">
          {sections.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={cn(
                "settings-option group flex w-full items-center gap-3 rounded-[var(--radius-card)] px-3.5 py-3 text-left transition-all",
                section === item.id
                  ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                  : "text-[var(--color-on-surface)] hover:bg-black/[0.045]"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold">{item.label}</div>
                <div
                  className={cn(
                    "mt-0.5 text-[11.5px] font-medium",
                    section === item.id
                      ? "text-[var(--color-primary)]/70"
                      : "text-[var(--color-on-surface-faint)] group-hover:text-[var(--color-on-surface-muted)]"
                  )}
                >
                  {item.desc}
                </div>
              </div>
              <ChevronRight className="size-4 opacity-50" />
            </button>
          ))}
        </Card>

        <div className="space-y-6">
          {section === "libraries" && (
            <Group title="媒体目录" desc="每行一个目录；保存时后端会校验目录必须存在。">
              <div className="px-6 py-5">
                <textarea
                  value={librariesText}
                  onChange={(event) => setLibrariesText(event.target.value)}
                  spellCheck={false}
                  className="min-h-36 w-full resize-y rounded-[var(--radius-card)] bg-[var(--color-surface-3)] ring-1 ring-inset ring-[var(--color-outline-soft)] focus:ring-[var(--color-primary)]/40 px-3 py-3 text-[13px] outline-none font-mono"
                  placeholder="/path/to/anime/library"
                />
              </div>
              <SettingsRow
                title="数据库路径"
                desc="后端 SQLite 数据库位置；修改后下次命令会使用新路径。"
                control={
                  <TextInput
                    value={settings.databasePath}
                    onChange={(value) => update("databasePath", value)}
                    className="w-full font-mono"
                  />
                }
              />
              <SettingsRow
                title="日志级别"
                desc="写入配置，供后端日志层读取。"
                control={
                  <select
                    value={settings.loggingLevel}
                    onChange={(event) => update("loggingLevel", event.target.value)}
                    className="h-9 rounded-[var(--radius-control)] bg-[var(--color-surface-3)] px-3 text-[13px] outline-none ring-1 ring-inset ring-[var(--color-outline-soft)]"
                  >
                    <option value="error">error</option>
                    <option value="warn">warn</option>
                    <option value="info">info</option>
                    <option value="debug">debug</option>
                    <option value="trace">trace</option>
                  </select>
                }
              />
            </Group>
          )}

          {section === "bangumi" && (
            <Group title="Bangumi" desc="控制条目查询、自动匹配和图片缓存。">
              <SettingsRow
                title="启用 Bangumi"
                control={<Switch checked={settings.bangumiEnabled} onChange={(value) => update("bangumiEnabled", value)} />}
              />
              <SettingsRow
                title="自动匹配"
                desc="扫描后自动查询 Bangumi 并写入匹配结果。"
                control={<Switch checked={settings.bangumiAutoMatch} onChange={(value) => update("bangumiAutoMatch", value)} />}
              />
              <SettingsRow
                title="缓存图片"
                desc="保存海报和头图到本地缓存。"
                control={<Switch checked={settings.bangumiCacheImages} onChange={(value) => update("bangumiCacheImages", value)} />}
              />
              <SettingsRow
                title="API 地址"
                control={
                  <TextInput
                    value={settings.bangumiBaseUrl}
                    onChange={(value) => update("bangumiBaseUrl", value)}
                    className="w-full font-mono"
                  />
                }
              />
              <SettingsRow
                title="User Agent"
                control={
                  <TextInput
                    value={settings.bangumiUserAgent}
                    onChange={(value) => update("bangumiUserAgent", value)}
                    className="w-full font-mono"
                  />
                }
              />
              <SettingsRow
                title="超时"
                desc="单位：秒"
                control={
                  <input
                    type="number"
                    min={1}
                    value={settings.bangumiRequestTimeoutSecs}
                    onChange={(event) => update("bangumiRequestTimeoutSecs", Number(event.target.value) || 1)}
                    className="h-9 w-24 rounded-[var(--radius-control)] bg-[var(--color-surface-3)] px-3 text-[13px] outline-none ring-1 ring-inset ring-[var(--color-outline-soft)]"
                  />
                }
              />
              <SettingsRow
                title="Access Token"
                control={
                  <SecretInput
                    value={settings.bangumiAccessToken}
                    show={showSecrets}
                    onToggleShow={() => setShowSecrets((value) => !value)}
                    onChange={(value) => update("bangumiAccessToken", value)}
                  />
                }
              />
            </Group>
          )}

          {section === "dandanplay" && (
            <Group title="DanDanPlay" desc="用于按单集文件名和哈希匹配弹幕。">
              <SettingsRow
                title="App ID"
                control={
                  <TextInput
                    value={settings.dandanplayAppId}
                    onChange={(value) => update("dandanplayAppId", value)}
                    className="w-full font-mono"
                  />
                }
              />
              <SettingsRow
                title="App Secret"
                control={
                  <SecretInput
                    value={settings.dandanplayAppSecret}
                    show={showSecrets}
                    onToggleShow={() => setShowSecrets((value) => !value)}
                    onChange={(value) => update("dandanplayAppSecret", value)}
                  />
                }
              />
              <SettingsRow
                title="API Key"
                desc="当前后端保留该字段；弹幕签名主要使用 App ID 和 App Secret。"
                control={
                  <SecretInput
                    value={settings.dandanplayApiKey}
                    show={showSecrets}
                    onToggleShow={() => setShowSecrets((value) => !value)}
                    onChange={(value) => update("dandanplayApiKey", value)}
                  />
                }
              />
            </Group>
          )}

          {section === "resources" && (
            <Group title="Nyaa" desc="用于在线搜索番剧资源候选。">
              <SettingsRow
                title="启用 Nyaa"
                control={<Switch checked={settings.nyaaEnabled} onChange={(value) => update("nyaaEnabled", value)} />}
              />
              <SettingsRow
                title="RSS 地址"
                desc="默认使用 nyaa.si 的 RSS 查询。"
                control={
                  <TextInput
                    value={settings.nyaaBaseUrl}
                    onChange={(value) => update("nyaaBaseUrl", value)}
                    className="w-full font-mono"
                  />
                }
              />
              <SettingsRow
                title="分类"
                desc="Nyaa 分类 ID，默认 0_0 为全分类搜索。"
                control={
                  <TextInput
                    value={settings.nyaaCategory}
                    onChange={(value) => update("nyaaCategory", value)}
                    className="w-full font-mono"
                  />
                }
              />
            </Group>
          )}

          {section === "qbittorrent" && (
            <Group title="qBittorrent" desc="通过 WebUI API 添加种子并回读任务状态。">
              <SettingsRow
                title="启用下载器"
                control={<Switch checked={settings.qbittorrentEnabled} onChange={(value) => update("qbittorrentEnabled", value)} />}
              />
              <SettingsRow
                title="WebUI 地址"
                control={
                  <TextInput
                    value={settings.qbittorrentBaseUrl}
                    onChange={(value) => update("qbittorrentBaseUrl", value)}
                    className="w-full font-mono"
                  />
                }
              />
              <SettingsRow
                title="用户名"
                control={
                  <TextInput
                    value={settings.qbittorrentUsername}
                    onChange={(value) => update("qbittorrentUsername", value)}
                    className="w-full font-mono"
                  />
                }
              />
              <SettingsRow
                title="密码"
                control={
                  <SecretInput
                    value={settings.qbittorrentPassword}
                    show={showSecrets}
                    onToggleShow={() => setShowSecrets((value) => !value)}
                    onChange={(value) => update("qbittorrentPassword", value)}
                  />
                }
              />
              <SettingsRow
                title="保存路径"
                desc="留空时使用 qBittorrent 默认路径。"
                control={
                  <TextInput
                    value={settings.qbittorrentSavePath}
                    onChange={(value) => update("qbittorrentSavePath", value)}
                    className="w-full font-mono"
                  />
                }
              />
              <SettingsRow
                title="分类"
                control={
                  <TextInput
                    value={settings.qbittorrentCategory}
                    onChange={(value) => update("qbittorrentCategory", value)}
                    className="w-full font-mono"
                  />
                }
              />
              <SettingsRow
                title="标签"
                control={
                  <TextInput
                    value={settings.qbittorrentTags}
                    onChange={(value) => update("qbittorrentTags", value)}
                    className="w-full font-mono"
                  />
                }
              />
              <div className="px-6 py-4">
                <Button onClick={testQbit} loading={testingQbit} className="h-9 px-4 text-[13px]">
                  测试连接
                </Button>
              </div>
            </Group>
          )}

          {section === "about" && (
            <Card className="p-8">
              <div className="text-[20px] font-semibold">NexPlay · 本地番剧库</div>
              <div className="text-[13px] text-[var(--color-on-surface-muted)] mt-2">
                配置、扫描和媒体库快照都由本地 Rust 后端统一处理。
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="px-6 pt-5 pb-4 border-b border-[var(--color-outline-soft)]">
        <div className="text-[17px] font-semibold tracking-tight">{title}</div>
        {desc && <div className="mt-1 text-[12.5px] font-medium text-[var(--color-on-surface-faint)]">{desc}</div>}
      </div>
      <div className="divide-y divide-[var(--color-outline-soft)]">{children}</div>
    </Card>
  );
}

function SettingsRow({
  title,
  desc,
  control,
}: {
  title: string;
  desc?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-5 px-6 py-4">
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold">{title}</div>
        {desc && <div className="mt-0.5 text-[12px] font-medium text-[var(--color-on-surface-faint)]">{desc}</div>}
      </div>
      <div className="min-w-0 justify-self-stretch">{control}</div>
    </div>
  );
}

function TextInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-9 rounded-[var(--radius-control)] bg-[var(--color-surface-3)] px-3 text-[13px] outline-none ring-1 ring-inset ring-[var(--color-outline-soft)] focus:ring-[var(--color-primary)]/40",
        className
      )}
    />
  );
}

function SecretInput({
  value,
  show,
  onToggleShow,
  onChange,
}: {
  value: string;
  show: boolean;
  onToggleShow: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-full">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full rounded-[var(--radius-control)] bg-[var(--color-surface-3)] pl-9 pr-3 font-mono text-[13px] outline-none ring-1 ring-inset ring-[var(--color-outline-soft)] focus:ring-[var(--color-primary)]/40"
        />
        <KeyIcon className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-on-surface-faint)]" />
      </div>
      <Button variant="text" size="sm" onClick={onToggleShow}>
        {show ? "隐藏" : "显示"}
      </Button>
    </div>
  );
}
