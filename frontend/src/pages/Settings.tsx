import { useState } from "react";
import { Button, Card, Chip, Switch } from "../ui";
import { ChevronRight, FolderPlus, KeyIcon, RefreshIcon, ScanIcon } from "../icons";
import { cn } from "../utils/cn";

type Section = "libraries" | "match" | "api" | "about";

const sections: { id: Section; label: string; desc: string }[] = [
  { id: "libraries", label: "Media Libraries", desc: "目录、扫描计划与缓存" },
  { id: "match", label: "Match", desc: "匹配策略与命名规则" },
  { id: "api", label: "API", desc: "Bangumi · 弹幕源 · 凭证" },
  { id: "about", label: "About", desc: "版本与依赖信息" },
];

export function SettingsPage({
  onSnack,
}: {
  onSnack: (text: string, tone?: "neutral" | "success" | "danger") => void;
}) {
  const [section, setSection] = useState<Section>("libraries");

  return (
    <div className="px-10 py-10">
      <h1 className="text-[36px] font-semibold tracking-tight">设置</h1>
      <div className="text-[14px] text-[var(--color-on-surface-muted)] mt-2 mb-8">
        管理媒体目录、匹配策略与外部 API 凭证。
      </div>

      <div className="grid grid-cols-[260px_1fr] gap-8 items-start">
        {/* Section list */}
        <Card className="p-2">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors",
                section === s.id
                  ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                  : "hover:bg-white/[0.05] text-[var(--color-on-surface)]"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium">{s.label}</div>
                <div className={cn(
                  "text-[11px] mt-0.5",
                  section === s.id ? "text-[var(--color-primary)]/70" : "text-[var(--color-on-surface-faint)]"
                )}>
                  {s.desc}
                </div>
              </div>
              <ChevronRight className="size-4 opacity-50" />
            </button>
          ))}
        </Card>

        {/* Section content */}
        <div className="space-y-6">
          {section === "libraries" && <LibrariesSection onSnack={onSnack} />}
          {section === "match" && <MatchSection />}
          {section === "api" && <ApiSection onSnack={onSnack} />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}

function Group({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="px-6 pt-5 pb-4 border-b border-[var(--color-outline-soft)]">
        <div className="text-[16px] font-medium">{title}</div>
        {desc && <div className="text-[12px] text-[var(--color-on-surface-faint)] mt-1">{desc}</div>}
      </div>
      <div className="divide-y divide-[var(--color-outline-soft)]">{children}</div>
    </Card>
  );
}

function Row({
  title,
  desc,
  control,
}: {
  title: string;
  desc?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-6 py-4">
      <div className="flex-1 min-w-0">
        <div className="text-[14px]">{title}</div>
        {desc && <div className="text-[12px] text-[var(--color-on-surface-faint)] mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function LibrariesSection({ onSnack }: { onSnack: (t: string, tone?: any) => void }) {
  const [autoScan, setAutoScan] = useState(true);
  const [matchOnAdd, setMatchOnAdd] = useState(true);
  return (
    <>
      <Group title="媒体目录" desc="NexPlay 会在这些目录中搜索视频文件">
        <div className="px-6 py-5 flex items-start gap-4">
          <div className="size-10 rounded-xl bg-[var(--color-surface-3)] grid place-items-center text-[var(--color-on-surface-muted)]">
            <FolderPlus className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px]">尚未从后端读取媒体目录配置</div>
            <div className="text-[12px] text-[var(--color-on-surface-faint)] mt-1">
              现在请编辑项目根目录的 config.toml，在 media_libraries 中填写真实路径，然后回到媒体库点击 Scan Now。
            </div>
          </div>
        </div>
        <div className="px-6 py-4 flex items-center gap-3">
          <Button icon={<FolderPlus className="size-4" />} onClick={() => onSnack("目录选择尚未接入。请先编辑 config.toml。")}>
            添加目录
          </Button>
          <Button variant="tonal" icon={<ScanIcon className="size-4" />} onClick={() => onSnack("请到媒体库页面点击 Scan Now 调用 Rust 后端扫描。")}>
            扫描全部
          </Button>
        </div>
      </Group>

      <Group title="扫描行为">
        <Row
          title="启动时自动扫描"
          desc="启动 NexPlay 时检查所有已注册目录的变更"
          control={<Switch checked={autoScan} onChange={setAutoScan} />}
        />
        <Row
          title="添加时自动匹配"
          desc="新增文件自动查询 Bangumi 元数据"
          control={<Switch checked={matchOnAdd} onChange={setMatchOnAdd} />}
        />
        <Row
          title="文件监听"
          desc="使用 FSEvents 实时响应目录变化"
          control={
            <select className="bg-[var(--color-surface-3)] ring-1 ring-inset ring-[var(--color-outline-soft)] rounded-lg h-9 px-3 text-[13px] outline-none">
              <option>实时</option>
              <option>每 30 分钟</option>
              <option>每 6 小时</option>
              <option>关闭</option>
            </select>
          }
        />
        <Row
          title="并发线程"
          desc="扫描时同时处理的文件数量"
          control={
            <div className="flex items-center gap-2">
              <button className="size-8 rounded-full bg-[var(--color-surface-3)] hover:bg-[var(--color-surface-4)]">−</button>
              <div className="w-10 text-center text-[14px] tabular-nums">4</div>
              <button className="size-8 rounded-full bg-[var(--color-surface-3)] hover:bg-[var(--color-surface-4)]">+</button>
            </div>
          }
        />
      </Group>

      <Group title="缓存">
        <Row
          title="海报缓存"
          desc="缓存统计尚未接入后端"
          control={<Button variant="outlined" size="sm">清理</Button>}
        />
        <Row
          title="元数据缓存"
          desc="缓存统计尚未接入后端"
          control={<Button variant="outlined" size="sm">清理</Button>}
        />
      </Group>
    </>
  );
}

function MatchSection() {
  const [confidence, setConfidence] = useState(0.75);
  const [preferCn, setPreferCn] = useState(true);
  return (
    <>
      <Group title="匹配策略" desc="影响识别引擎对模糊文件名的判断">
        <Row
          title="自动确认阈值"
          desc={`匹配度高于 ${(confidence * 100).toFixed(0)}% 时自动确认，否则标记为待确认`}
          control={
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.01}
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              className="w-40 accent-[var(--color-primary)]"
            />
          }
        />
        <Row
          title="优先使用中文标题"
          desc="界面优先展示 zh-Hans 名称"
          control={<Switch checked={preferCn} onChange={setPreferCn} />}
        />
        <Row
          title="文件命名解析"
          desc="选择优先识别的字段顺序"
          control={
            <div className="flex gap-1.5">
              <Chip selected>季度</Chip>
              <Chip selected>集数</Chip>
              <Chip>分辨率</Chip>
              <Chip>字幕组</Chip>
            </div>
          }
        />
      </Group>
      <Group title="过滤词">
        <Row
          title="忽略关键字"
          desc="包含这些词的文件不会被解析"
          control={
            <input
              defaultValue="sample, trailer, NCED, NCOP"
              className="bg-[var(--color-surface-3)] ring-1 ring-inset ring-[var(--color-outline-soft)] focus:ring-[var(--color-primary)]/40 rounded-lg h-9 px-3 text-[13px] outline-none w-72"
            />
          }
        />
      </Group>
    </>
  );
}

function ApiSection({ onSnack }: { onSnack: (t: string, tone?: any) => void }) {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  return (
    <>
      <Group title="Bangumi API" desc="用于查询条目、获取元数据与同步收藏">
        <Row
          title="服务器"
          desc="API 基础地址"
          control={
            <input
              defaultValue="https://api.bgm.tv"
              className="bg-[var(--color-surface-3)] ring-1 ring-inset ring-[var(--color-outline-soft)] rounded-lg h-9 px-3 text-[13px] outline-none w-72 font-mono"
            />
          }
        />
        <Row
          title="Access Token"
          desc="用于个人收藏读写操作"
          control={
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="bg-[var(--color-surface-3)] ring-1 ring-inset ring-[var(--color-outline-soft)] rounded-lg h-9 pl-9 pr-3 text-[13px] outline-none w-72 font-mono"
                />
                <KeyIcon className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-on-surface-faint)]" />
              </div>
              <Button variant="text" size="sm" onClick={() => setShowToken((v) => !v)}>
                {showToken ? "Hide" : "Show"}
              </Button>
            </div>
          }
        />
        <Row
          title="测试连接"
          desc="验证当前凭证可用性"
          control={
            <Button
              variant="tonal"
              size="sm"
              icon={<RefreshIcon className="size-4" />}
              onClick={() => onSnack("连接测试尚未接入 IPC。请先使用后端配置运行扫描。")}
            >
              Test
            </Button>
          }
        />
      </Group>

      <Group title="弹幕源">
        <Row
          title="DanDanPlay"
          desc="自动匹配并下载弹幕"
          control={<Switch checked={true} onChange={() => {}} />}
        />
        <Row
          title="本地弹幕优先"
          desc="存在同目录 .xml/.ass 时跳过在线源"
          control={<Switch checked={false} onChange={() => {}} />}
        />
      </Group>

      <Card className="p-4 ring-1 ring-amber-400/30 bg-amber-500/10">
        <div className="flex items-start gap-3">
          <div className="size-8 rounded-full bg-amber-500/20 grid place-items-center text-amber-300 shrink-0">!</div>
          <div className="flex-1">
            <div className="text-[14px] font-medium text-amber-200">设置写入尚未接入</div>
            <div className="text-[12px] text-amber-100/70 mt-0.5">
              当前设置页只展示配置项。真实配置请先编辑 config.toml，后续再接入 IPC 写入。
            </div>
          </div>
          <Button size="sm" variant="tonal">了解</Button>
        </div>
      </Card>
    </>
  );
}

function AboutSection() {
  return (
    <>
      <Card className="p-8 flex items-center gap-5">
        <div className="size-16 rounded-2xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] grid place-items-center shadow-lg">
          <svg viewBox="0 0 24 24" className="size-8 text-[var(--color-on-primary)]" fill="currentColor">
            <path d="M12 2l2.4 6.9H22l-6 4.4 2.3 7L12 16l-6.3 4.3 2.3-7-6-4.4h7.6z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-[20px] font-semibold">NexPlay · 本地番剧库</div>
          <div className="text-[13px] text-[var(--color-on-surface-muted)] mt-1">
            v0.18.2 · 构建 2026.03.14 · macOS / Windows / Linux
          </div>
        </div>
        <Button variant="outlined" size="sm">检查更新</Button>
      </Card>
      <Group title="法务">
        <Row title="开源许可" desc="MIT License" control={<Button variant="text" size="sm">查看</Button>} />
        <Row title="第三方组件" desc="包含 React, Tailwind 等" control={<Button variant="text" size="sm">查看</Button>} />
      </Group>
    </>
  );
}
