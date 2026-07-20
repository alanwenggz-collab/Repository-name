"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type ShapeName = "circle" | "square" | "triangle" | "star" | "heart" | "hexagon" | "path";
type ColorInfo = { hex: string; label: string; count: number };
type ShapeInfo = { name: ShapeName; raw: string; label: string; count: number; mode: "named" | "lottie" };

const SAMPLE = {
  name: "summer-campaign",
  canvas: { background: "#F6F5F2", width: 1080, height: 1080 },
  elements: [
    { id: "badge-1", shape: "circle", fill: "#FF6B4A", icon: "star" },
    { id: "badge-2", shape: "circle", fill: "#FF6B4A", icon: "star" },
    { id: "card", shape: "square", fill: "#1F2937", stroke: "#FFFFFF" },
    { id: "accent", shape: "triangle", fill: [1, 0.804, 0.337, 1] },
  ],
};

const SHAPES: ShapeName[] = ["circle", "square", "triangle", "star", "heart", "hexagon"];
const SHAPE_LABEL: Record<string, string> = {
  circle: "圆形", square: "方形", triangle: "三角形", star: "星形", heart: "爱心", hexagon: "六边形", path: "路径",
};
const ALIASES: Record<string, ShapeName> = {
  circle: "circle", ellipse: "circle", oval: "circle", round: "circle", el: "circle",
  square: "square", rectangle: "square", rect: "square", box: "square", rc: "square",
  triangle: "triangle", polygon3: "triangle", star: "star", sr: "star", heart: "heart",
  hexagon: "hexagon", polygon: "hexagon", path: "path", shape: "path", sh: "path",
};
const LOTTIE_TARGET: Partial<Record<ShapeName, string>> = { circle: "el", square: "rc", star: "sr", path: "sh" };
const COLOR_KEY = /^(c|fc|sc|color|colour|fill|fillcolor|stroke|strokecolor|background|backgroundcolor|bg|tint|foreground)$/i;
const SHAPE_KEY = /^(shape|shapeName|icon|iconName|symbol|type|kind|element|primitive)$/i;
const CUSTOM_SHAPE_KEY = /^(shape|shapeName|icon|iconName|symbol)$/i;

function clamp(value: number) { return Math.max(0, Math.min(255, Math.round(value))); }
function rgbHex(r: number, g: number, b: number) { return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase(); }
function normalizeHex(value: string) {
  const argb = /^0x/i.test(value); let raw = value.replace(/^#|^0x/i, "");
  if (raw.length === 3 || raw.length === 4) raw = raw.slice(0, 3).split("").map((c) => c + c).join("");
  if (raw.length === 8) raw = argb ? raw.slice(2) : raw.slice(0, 6);
  return raw.length === 6 ? `#${raw.toUpperCase()}` : null;
}

function parseCssColor(value: string) {
  const trimmed = value.trim();
  if (/^(#|0x)[0-9a-f]{3,8}$/i.test(trimmed)) return normalizeHex(trimmed);
  const rgb = trimmed.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/i);
  return rgb ? rgbHex(+rgb[1], +rgb[2], +rgb[3]) : null;
}

function colorCandidate(value: unknown, key: string, parents: string[]): { hex: string; label: string } | null {
  const context = COLOR_KEY.test(key) || parents.some((part) => COLOR_KEY.test(part));
  if (typeof value === "string") {
    const css = parseCssColor(value);
    if (css) return { hex: css, label: value };
    if (context && /^[0-9a-f]{6,8}$/i.test(value.trim())) {
      const hex = normalizeHex(value.trim());
      return hex ? { hex, label: value } : null;
    }
  }
  if (context && Array.isArray(value) && value.length >= 3 && value.length <= 4 && value.every((v) => typeof v === "number")) {
    const nums = value as number[]; const scale = Math.max(...nums.slice(0, 3)) <= 1 ? 255 : 1;
    return { hex: rgbHex(nums[0] * scale, nums[1] * scale, nums[2] * scale), label: `[${nums.map((n) => Number(n.toFixed(3))).join(", ")}]` };
  }
  if (context && value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    if ([object.r, object.g, object.b].every((v) => typeof v === "number")) {
      const nums = [object.r as number, object.g as number, object.b as number]; const scale = Math.max(...nums) <= 1 ? 255 : 1;
      return { hex: rgbHex(nums[0] * scale, nums[1] * scale, nums[2] * scale), label: `{ r, g, b }` };
    }
  }
  if (context && typeof value === "number" && Number.isInteger(value) && value > 255) {
    return { hex: rgbHex((value >> 16) & 255, (value >> 8) & 255, value & 255), label: String(value) };
  }
  return null;
}

function scanColors(data: unknown) {
  const map = new Map<string, ColorInfo>();
  const scan = (value: unknown, key = "root", parents: string[] = []) => {
    const candidate = colorCandidate(value, key, parents);
    if (candidate) {
      const current = map.get(candidate.hex);
      map.set(candidate.hex, { ...candidate, count: (current?.count || 0) + 1 });
      return;
    }
    if (Array.isArray(value)) value.forEach((child, index) => scan(child, String(index), [...parents, key]));
    else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => scan(child, childKey, [...parents, key]));
  };
  scan(data); return [...map.values()];
}

function shapeCandidate(value: unknown, key: string): Omit<ShapeInfo, "count"> | null {
  if (typeof value !== "string") return null;
  const raw = value.trim(); const lower = raw.toLowerCase().replace(/[\s_-]/g, "");
  if (key === "ty" && ALIASES[lower]) return { name: ALIASES[lower], raw, label: SHAPE_LABEL[ALIASES[lower]], mode: "lottie" };
  if ((SHAPE_KEY.test(key) || ALIASES[lower]) && ALIASES[lower]) return { name: ALIASES[lower], raw, label: SHAPE_LABEL[ALIASES[lower]], mode: "named" };
  if (CUSTOM_SHAPE_KEY.test(key) && raw.length <= 80) return { name: "square", raw, label: raw, mode: "named" };
  return null;
}

function scanShapes(data: unknown) {
  const map = new Map<string, ShapeInfo>();
  const scan = (value: unknown, key = "root") => {
    const candidate = shapeCandidate(value, key);
    if (candidate) {
      const id = `${candidate.mode}:${candidate.raw}`; const current = map.get(id);
      map.set(id, { ...candidate, count: (current?.count || 0) + 1 });
    }
    if (Array.isArray(value)) value.forEach((child, index) => scan(child, String(index)));
    else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => scan(child, childKey));
  };
  scan(data); return [...map.values()];
}

function colorForOriginal(original: unknown, hex: string): unknown {
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) => parseInt(part, 16));
  if (typeof original === "string") {
    if (/^rgba?/i.test(original)) return original.toLowerCase().startsWith("rgba") ? `rgba(${r}, ${g}, ${b}, 1)` : `rgb(${r}, ${g}, ${b})`;
    if (!original.startsWith("#") && !original.startsWith("0x")) return hex.slice(1);
    return original.startsWith("0x") ? `0x${hex.slice(1)}` : hex;
  }
  if (Array.isArray(original)) {
    const scaled = Math.max(...(original as number[]).slice(0, 3)) <= 1; const alpha = original.length === 4 ? original[3] : undefined;
    const next = scaled ? [r / 255, g / 255, b / 255] : [r, g, b]; return alpha === undefined ? next : [...next, alpha];
  }
  if (original && typeof original === "object") {
    const object = original as Record<string, unknown>; const scaled = Math.max(object.r as number, object.g as number, object.b as number) <= 1;
    return { ...object, r: scaled ? r / 255 : r, g: scaled ? g / 255 : g, b: scaled ? b / 255 : b };
  }
  if (typeof original === "number") return (((original > 0xffffff ? original & 0xff000000 : 0) | (r << 16) | (g << 8) | b) >>> 0);
  return original;
}

function replaceColor(data: unknown, fromHex: string, toHex: string, key = "root", parents: string[] = []): unknown {
  const candidate = colorCandidate(data, key, parents);
  if (candidate) return candidate.hex === fromHex ? colorForOriginal(data, toHex) : data;
  if (Array.isArray(data)) return data.map((child, index) => replaceColor(child, fromHex, toHex, String(index), [...parents, key]));
  if (data && typeof data === "object") return Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([childKey, child]) => [childKey, replaceColor(child, fromHex, toHex, childKey, [...parents, key])]));
  return data;
}

function replaceShape(data: unknown, from: ShapeInfo, target: string, key = "root"): unknown {
  const candidate = shapeCandidate(data, key);
  if (candidate && candidate.raw === from.raw && candidate.mode === from.mode) return from.mode === "lottie" ? (LOTTIE_TARGET[target as ShapeName] || data) : target;
  if (Array.isArray(data)) return data.map((child, index) => replaceShape(child, from, target, String(index)));
  if (data && typeof data === "object") return Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([childKey, child]) => [childKey, replaceShape(child, from, target, childKey)]));
  return data;
}

function isLottie(data: unknown): data is Record<string, unknown> {
  return !!data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).layers) && typeof (data as Record<string, unknown>).fr === "number";
}

function Shape({ name, className = "" }: { name: string; className?: string }) {
  const safe = [...SHAPES, "path"].includes(name as ShapeName) ? name : "square";
  return <span className={`shape shape-${safe} ${className}`} aria-label={SHAPE_LABEL[safe]} />;
}

function LottiePreview({ data }: { data: Record<string, unknown> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let animation: { destroy: () => void } | undefined; let active = true;
    import("lottie-web/build/player/lottie_light").then(({ default: lottie }) => {
      if (!active || !ref.current) return;
      ref.current.innerHTML = "";
      animation = lottie.loadAnimation({ container: ref.current, renderer: "svg", loop: true, autoplay: true, animationData: JSON.parse(JSON.stringify(data)) });
      animation.addEventListener?.("data_failed", () => setFailed(true));
    }).catch(() => setFailed(true));
    return () => { active = false; animation?.destroy(); };
  }, [data]);
  return failed ? <div className="preview-message">动画结构无法直接渲染，已显示识别到的视觉元素。</div> : <div ref={ref} className="lottie-stage" />;
}

function VisualPreview({ data, colors, shapes }: { data: unknown; colors: ColorInfo[]; shapes: ShapeInfo[] }) {
  const items = shapes.flatMap((shape) => Array.from({ length: Math.min(shape.count, 6) }, () => shape)).slice(0, 24);
  if (isLottie(data)) return <LottiePreview data={data} />;
  return <div className="token-stage" style={{ background: colors.find((c) => c.hex === "#FFFFFF")?.hex || "#F6F5F2" }}>
    {items.map((item, index) => <div className="preview-object" key={`${item.raw}-${index}`} style={{ color: colors[index % Math.max(colors.length, 1)]?.hex || "#7557E8" }}><Shape name={item.name} /><small>{item.raw}</small></div>)}
    {!items.length && colors.map((color) => <div className="preview-color" key={color.hex} style={{ background: color.hex }}><span>{color.hex}</span></div>)}
    {!items.length && !colors.length && <div className="preview-message">暂未找到可视化元素<br /><small>支持 CSS、RGB 数组、Lottie 颜色与常见形状字段</small></div>}
  </div>;
}

export default function Home() {
  const [data, setData] = useState<unknown>(SAMPLE);
  const [fileName, setFileName] = useState("summer-campaign.json");
  const [activeTab, setActiveTab] = useState<"colors" | "shapes">("colors");
  const [inspectorTab, setInspectorTab] = useState<"preview" | "json">("preview");
  const [selectedShape, setSelectedShape] = useState("");
  const [customShape, setCustomShape] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("已识别示例 JSON");
  const fileRef = useRef<HTMLInputElement>(null);
  const colors = useMemo(() => scanColors(data), [data]);
  const shapes = useMemo(() => scanShapes(data), [data]);
  const jsonText = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const activeShape = shapes.find((item) => `${item.mode}:${item.raw}` === selectedShape) || shapes[0];

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()); setData(parsed); setFileName(file.name); setError(""); setSelectedShape(""); setInspectorTab("preview");
      const foundColors = scanColors(parsed).length; const foundShapes = scanShapes(parsed).length;
      setToast(`识别完成：${foundColors} 种颜色，${foundShapes} 种形状`);
    } catch { setError("无法解析这个文件，请检查 JSON 格式后重试。"); }
    event.target.value = "";
  };

  const changeColor = (from: string, to: string) => { setData((current) => replaceColor(current, from, to)); setInspectorTab("preview"); setToast(`已替换 ${from} 的全部引用`); };
  const changeShape = (from: ShapeInfo, to: string) => { if (!to.trim()) return; setData((current) => replaceShape(current, from, to.trim())); setSelectedShape(""); setCustomShape(""); setInspectorTab("preview"); setToast(`已同步替换 ${from.count} 个「${from.raw}」实例`); };
  const download = () => { const blob = new Blob([jsonText], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = fileName.replace(/\.json$/i, "") + "-edited.json"; a.click(); URL.revokeObjectURL(url); setToast("修改后的 JSON 已下载"); };

  return <main>
    <header className="topbar"><a className="brand" href="#" aria-label="Jsonicle 首页"><span className="brand-mark">J</span><span>Jsonicle</span></a><div className="top-actions"><span className="privacy"><span className="lock">◆</span>文件仅在本地处理</span><button className="button button-ghost" onClick={() => fileRef.current?.click()}>＋ 上传文件</button><button className="button button-dark" onClick={download}>下载 JSON <span>↓</span></button></div></header>
    <section className="hero"><div><span className="eyebrow">VISUAL JSON EDITOR · 02</span><h1>找到它，<em>看到它。</em></h1><p>现已支持 CSS、RGB 数组、Lottie 颜色与形状代码，修改结果在右侧画布实时呈现。</p></div><button className="file-card" onClick={() => fileRef.current?.click()}><span className="file-icon">{"{ }"}</span><span><strong>{fileName}</strong><small>{(new Blob([jsonText]).size / 1024).toFixed(1)} KB · {isLottie(data) ? "LOTTIE JSON" : "JSON"}</small></span><span className="file-change">更换文件</span></button><input ref={fileRef} type="file" accept="application/json,.json" onChange={loadFile} hidden /></section>
    {error && <div className="error" role="alert">{error}</div>}
    <section className="workspace">
      <aside className="rail"><div className="rail-title">已识别</div><button className={activeTab === "colors" ? "rail-item active" : "rail-item"} onClick={() => setActiveTab("colors")}><span className="rail-icon">◒</span><span>颜色<small>Colors</small></span><b>{colors.length}</b></button><button className={activeTab === "shapes" ? "rail-item active" : "rail-item"} onClick={() => setActiveTab("shapes")}><span className="rail-icon">◇</span><span>形状<small>Shapes</small></span><b>{shapes.length}</b></button><div className="rail-note"><span>↗</span><p>颜色数组和 Lottie 的 c.k / ty 字段也会被识别。</p></div></aside>
      <section className="editor-panel"><div className="section-head"><div><span className="index">0{activeTab === "colors" ? "1" : "2"}</span><h2>{activeTab === "colors" ? "颜色" : "形状"}</h2><span className="en">{activeTab.toUpperCase()}</span></div><p>{activeTab === "colors" ? `识别到 ${colors.length} 种颜色，包含不同 JSON 表达格式。` : `识别到 ${shapes.length} 类形状，修改后立即刷新预览。`}</p></div>
        {activeTab === "colors" ? <div className="color-grid">{colors.map((color, index) => <article className="color-card" key={color.hex}><div className="swatch" style={{ background: color.hex }}><span>{String(index + 1).padStart(2, "0")}</span></div><div className="color-meta"><label>识别结果</label><strong>{color.hex}</strong><small>{color.label} · {color.count} 个引用</small></div><label className="picker-label">替换为<input type="color" value={color.hex} onChange={(e) => changeColor(color.hex, e.target.value.toUpperCase())} /><span>选择颜色</span></label></article>)}{!colors.length && <Empty text="暂未识别到颜色；可切到 JSON 查看原始字段" />}</div> :
        <div className="shape-workbench"><div className="shape-list">{shapes.map((shape) => { const id = `${shape.mode}:${shape.raw}`; return <button key={id} className={activeShape && `${activeShape.mode}:${activeShape.raw}` === id ? "shape-row selected" : "shape-row"} onClick={() => setSelectedShape(id)}><Shape name={shape.name} /><span><strong>{shape.label}</strong><small>{shape.raw}{shape.mode === "lottie" ? " · Lottie" : ""}</small></span><b>× {shape.count}</b></button>; })}{!shapes.length && <Empty text="暂未识别到形状；支持 shape、icon、type 与 Lottie ty" />}</div>{activeShape && <div className="replace-card"><span className="replace-kicker">REPLACE ALL</span><h3>替换全部「{activeShape.raw}」</h3><div className="replacement-line"><div><Shape name={activeShape.name} /><small>当前</small></div><span>→</span><div className="shape-options">{SHAPES.filter((shape) => shape !== activeShape.name && (activeShape.mode !== "lottie" || LOTTIE_TARGET[shape])).map((shape) => <button key={shape} title={SHAPE_LABEL[shape]} onClick={() => changeShape(activeShape, shape)}><Shape name={shape} /></button>)}</div></div>{activeShape.mode === "named" && <div className="custom-replace"><input value={customShape} onChange={(event) => setCustomShape(event.target.value)} placeholder="输入新形状 / Icon 名称" onKeyDown={(event) => event.key === "Enter" && changeShape(activeShape, customShape)} /><button onClick={() => changeShape(activeShape, customShape)}>替换</button></div>}<p>这会同步更新 JSON 中 {activeShape.count} 个同名实例。</p></div>}</div>}
      </section>
      <aside className="json-panel"><div className="panel-tabs"><button className={inspectorTab === "preview" ? "active" : ""} onClick={() => setInspectorTab("preview")}><span className="status-dot" />视觉预览</button><button className={inspectorTab === "json" ? "active" : ""} onClick={() => setInspectorTab("json")}>实时 JSON</button></div>{inspectorTab === "preview" ? <div className="preview-panel"><div className="preview-head"><span>{isLottie(data) ? "LOTTIE LIVE" : "AUTO LAYOUT"}</span><b>{colors.length} COLORS · {shapes.length} SHAPES</b></div><VisualPreview data={data} colors={colors} shapes={shapes} /><div className="preview-foot">修改颜色或形状后自动刷新</div></div> : <><div className="json-head"><div><span className="status-dot" /> 已同步</div><button onClick={() => navigator.clipboard.writeText(jsonText).then(() => setToast("JSON 已复制"))}>复制</button></div><pre>{jsonText.split("\n").map((line, i) => <code key={i}><span>{String(i + 1).padStart(2, "0")}</span>{line}</code>)}</pre><div className="json-foot"><span>{jsonText.split("\n").length} 行</span><span>UTF-8</span></div></>}</aside>
    </section>
    <div className="toast" aria-live="polite"><span>✓</span>{toast}</div>
  </main>;
}

function Empty({ text }: { text: string }) { return <div className="empty"><span>◎</span><p>{text}</p></div>; }
