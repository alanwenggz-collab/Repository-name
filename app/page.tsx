"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AnimationItem } from "lottie-web";

type ShapeName = "circle" | "square" | "triangle" | "star" | "heart" | "hexagon" | "path";
type ColorInfo = { hex: string; label: string; count: number };
type ShapeInfo = { name: string; count: number; mode: "lottie-group" | "lottie-layer" | "component" | "reference" };

const SAMPLE = {
  name: "summer-campaign",
  canvas: { background: "#F6F5F2", width: 1080, height: 1080 },
  elements: [
    { id: "badge-1", name: "sun-badge", children: [{ shape: "circle", fill: "#FF6B4A" }, { shape: "star", fill: "#FFFFFF" }] },
    { id: "badge-2", name: "sun-badge", children: [{ shape: "circle", fill: "#FF6B4A" }, { shape: "star", fill: "#FFFFFF" }] },
    { id: "card", name: "dark-card", children: [{ shape: "square", fill: "#1F2937" }, { shape: "triangle", fill: [1, 0.804, 0.337, 1] }] },
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
const COLOR_KEY = /^(c|fc|sc|color|colour|fill|fillcolor|stroke|strokecolor|background|backgroundcolor|bg|tint|foreground)$/i;

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

function composedDescriptor(value: unknown, parentKey = "root"): Omit<ShapeInfo, "count"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (object.ty === "gr" && typeof object.nm === "string" && object.nm.trim()) return { name: object.nm.trim(), mode: "lottie-group" };
  if (parentKey === "layers" && typeof object.nm === "string" && object.nm.trim()) return { name: object.nm.trim(), mode: "lottie-layer" };
  const name = [object.name, object.nm, object.componentName].find((item) => typeof item === "string" && item.trim()) as string | undefined;
  const hasParts = ["children", "items", "elements", "shapes", "components", "paths"].some((key) => Array.isArray(object[key]) && (object[key] as unknown[]).length > 0);
  if (name && hasParts && !ALIASES[name.toLowerCase().replace(/[\s_-]/g, "")]) return { name: name.trim(), mode: "component" };
  const reference = [object.iconName, object.symbol, object.icon, object.shapeName].find((item) => typeof item === "string" && item.trim()) as string | undefined;
  if (reference && !ALIASES[reference.toLowerCase().replace(/[\s_-]/g, "")]) return { name: reference.trim(), mode: "reference" };
  return null;
}

function scanShapes(data: unknown) {
  const map = new Map<string, ShapeInfo>();
  const scan = (value: unknown, parentKey = "root") => {
    const candidate = composedDescriptor(value, parentKey);
    if (candidate) {
      const id = `${candidate.mode}:${candidate.name}`; const current = map.get(id);
      map.set(id, { ...candidate, count: (current?.count || 0) + 1 });
    }
    if (Array.isArray(value)) value.forEach((child) => scan(child, parentKey));
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

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

function findShapeTemplate(data: unknown, target: string, targetMode?: ShapeInfo["mode"], parentKey = "root"): Record<string, unknown> | null {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const descriptor = composedDescriptor(data, parentKey);
    if (descriptor?.name === target && descriptor.mode !== "reference" && (!targetMode || descriptor.mode === targetMode)) return data as Record<string, unknown>;
    for (const [childKey, child] of Object.entries(data as Record<string, unknown>)) {
      const found = findShapeTemplate(child, target, targetMode, childKey); if (found) return found;
    }
  } else if (Array.isArray(data)) for (const child of data) { const found = findShapeTemplate(child, target, targetMode, parentKey); if (found) return found; }
  return null;
}

function transplantShape(current: Record<string, unknown>, template: Record<string, unknown>, mode: ShapeInfo["mode"]) {
  const next = clone(template);
  if (mode === "lottie-group" && Array.isArray(current.it) && Array.isArray(next.it)) {
    const transform = (current.it as Record<string, unknown>[]).find((item) => item.ty === "tr");
    if (transform) next.it = (next.it as Record<string, unknown>[]).map((item) => item.ty === "tr" ? clone(transform) : item);
  }
  const preserve = mode === "lottie-layer" ? ["ind", "parent", "ks", "ip", "op", "st"] : ["id", "key", "x", "y", "position", "transform", "layout"];
  preserve.forEach((key) => { if (key in current) next[key] = clone(current[key]); });
  return next;
}

function renameComposed(object: Record<string, unknown>, from: ShapeInfo, target: string) {
  const next = { ...object };
  for (const key of ["nm", "name", "componentName", "iconName", "symbol", "icon", "shapeName"]) if (next[key] === from.name) next[key] = target;
  return next;
}

function replaceShape(data: unknown, from: ShapeInfo, target: string, template: Record<string, unknown> | null, parentKey = "root"): unknown {
  if (Array.isArray(data)) return data.map((child) => replaceShape(child, from, target, template, parentKey));
  if (data && typeof data === "object") {
    const object = data as Record<string, unknown>; const descriptor = composedDescriptor(object, parentKey);
    if (descriptor?.name === from.name && descriptor.mode === from.mode) {
      if (template && from.mode !== "reference") return transplantShape(object, template, from.mode);
      return renameComposed(object, from, target);
    }
    return Object.fromEntries(Object.entries(object).map(([childKey, child]) => [childKey, replaceShape(child, from, target, template, childKey)]));
  }
  return data;
}

function isLottie(data: unknown): data is Record<string, unknown> {
  return !!data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).layers) && typeof (data as Record<string, unknown>).fr === "number";
}

function ComposedMark() { return <span className="composed-mark"><i /><i /><i /></span>; }

function LottiePreview({ data }: { data: Record<string, unknown> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let animation: AnimationItem | undefined; let active = true;
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
    {items.map((item, index) => <div className="preview-object" key={`${item.name}-${index}`} style={{ color: colors[index % Math.max(colors.length, 1)]?.hex || "#7557E8" }}><ComposedMark /><small>{item.name}</small></div>)}
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
  const [replacementData, setReplacementData] = useState<unknown>(null);
  const [replacementFileName, setReplacementFileName] = useState("");
  const [selectedReplacement, setSelectedReplacement] = useState("");
  const [replacementError, setReplacementError] = useState("");
  const [colorEditor, setColorEditor] = useState<{ current: string; draft: string; count: number } | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("已识别示例 JSON");
  const fileRef = useRef<HTMLInputElement>(null);
  const replacementFileRef = useRef<HTMLInputElement>(null);
  const colors = useMemo(() => scanColors(data), [data]);
  const shapes = useMemo(() => scanShapes(data), [data]);
  const replacementShapes = useMemo(() => replacementData ? scanShapes(replacementData) : [], [replacementData]);
  const jsonText = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const activeShape = shapes.find((item) => `${item.mode}:${item.name}` === selectedShape) || shapes[0];
  const compatibleReplacementShapes = activeShape ? replacementShapes.filter((item) => item.mode === activeShape.mode) : [];
  const activeReplacement = compatibleReplacementShapes.find((item) => `${item.mode}:${item.name}` === selectedReplacement) || compatibleReplacementShapes[0];

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()); setData(parsed); setFileName(file.name); setError(""); setSelectedShape(""); setInspectorTab("preview");
      const foundColors = scanColors(parsed).length; const foundShapes = scanShapes(parsed).length;
      setToast(`识别完成：${foundColors} 种颜色，${foundShapes} 种形状`);
    } catch { setError("无法解析这个文件，请检查 JSON 格式后重试。"); }
    event.target.value = "";
  };

  const loadReplacementFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const foundShapes = scanShapes(parsed);
      if (!foundShapes.length) {
        setReplacementError("替换文件中没有识别到命名组合。请上传包含组合形状、Lottie 图层或组件的 JSON。");
        return;
      }
      setReplacementData(parsed); setReplacementFileName(file.name); setReplacementError("");
      setSelectedReplacement(`${foundShapes[0].mode}:${foundShapes[0].name}`);
      setToast(`替换文件已识别：${foundShapes.length} 个组合形状`);
    } catch { setReplacementError("无法解析替换文件，请检查 JSON 格式后重试。"); }
    finally { event.target.value = ""; }
  };

  const changeColor = (to: string) => {
    if (!colorEditor || !/^#[0-9A-F]{6}$/i.test(to)) return;
    const next = to.toUpperCase(); const from = colorEditor.current;
    setData((current: unknown) => replaceColor(current, from, next)); setColorEditor({ ...colorEditor, current: next, draft: next }); setInspectorTab("preview"); setToast(`已替换 ${from} 的全部引用`);
  };
  const changeShapeFromUpload = (from: ShapeInfo, replacement: ShapeInfo) => {
    if (!replacementData) return;
    const template = replacement.mode === "reference" ? null : findShapeTemplate(replacementData, replacement.name, replacement.mode);
    if (replacement.mode !== "reference" && !template) { setReplacementError("无法读取这个替换形状的完整结构，请尝试上传其他 JSON。"); return; }
    setData((current: unknown) => replaceShape(current, from, replacement.name, template)); setInspectorTab("preview");
    setToast(`已使用上传的「${replacement.name}」替换 ${from.count} 个「${from.name}」`);
  };
  const download = () => { const blob = new Blob([jsonText], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = fileName.replace(/\.json$/i, "") + "-edited.json"; a.click(); URL.revokeObjectURL(url); setToast("修改后的 JSON 已下载"); };

  return <main>
    <header className="topbar"><a className="brand" href="#" aria-label="Jsonicle 首页"><span className="brand-mark">J</span><span>Jsonicle</span></a><div className="top-actions"><span className="privacy"><span className="lock">◆</span>文件仅在本地处理</span><button className="button button-ghost" onClick={() => fileRef.current?.click()}>＋ 上传文件</button><button className="button button-dark" onClick={download}>下载 JSON <span>↓</span></button></div></header>
    <section className="hero"><div><span className="eyebrow">VISUAL JSON EDITOR · 03</span><h1>找到它，<em>看到它。</em></h1><p>识别颜色与已经拼合完成的命名形状；基础图元不会再作为独立形状出现。</p></div><button className="file-card" onClick={() => fileRef.current?.click()}><span className="file-icon">{"{ }"}</span><span><strong>{fileName}</strong><small>{(new Blob([jsonText]).size / 1024).toFixed(1)} KB · {isLottie(data) ? "LOTTIE JSON" : "JSON"}</small></span><span className="file-change">更换文件</span></button><input ref={fileRef} type="file" accept="application/json,.json" onChange={loadFile} hidden /></section>
    {error && <div className="error" role="alert">{error}</div>}
    <section className="workspace">
      <aside className="rail"><div className="rail-title">已识别</div><button className={activeTab === "colors" ? "rail-item active" : "rail-item"} onClick={() => setActiveTab("colors")}><span className="rail-icon">◒</span><span>颜色<small>Colors</small></span><b>{colors.length}</b></button><button className={activeTab === "shapes" ? "rail-item active" : "rail-item"} onClick={() => setActiveTab("shapes")}><span className="rail-icon">◇</span><span>组合形状<small>Groups</small></span><b>{shapes.length}</b></button><div className="rail-note"><span>↗</span><p>只识别命名组、图层和组件，不包含圆形、矩形或路径图元。</p></div></aside>
      <section className="editor-panel"><div className="section-head"><div><span className="index">0{activeTab === "colors" ? "1" : "2"}</span><h2>{activeTab === "colors" ? "颜色" : "组合形状"}</h2><span className="en">{activeTab === "colors" ? "COLORS" : "GROUPS"}</span></div><p>{activeTab === "colors" ? `识别到 ${colors.length} 种颜色；编辑窗口会保持开启。` : `选择主文件中的组合，再上传外部 JSON 作为替换来源。`}</p></div>
        {activeTab === "colors" ? <div className="color-grid">{colors.map((color, index) => <article className="color-card" key={color.hex}><div className="swatch" style={{ background: color.hex }}><span>{String(index + 1).padStart(2, "0")}</span></div><div className="color-meta"><label>识别结果</label><strong>{color.hex}</strong><small>{color.label} · {color.count} 个引用</small></div><button className="picker-button" onClick={() => setColorEditor({ current: color.hex, draft: color.hex, count: color.count })}><span className="picker-chip" style={{ background: color.hex }} />选择颜色</button></article>)}{!colors.length && <Empty text="暂未识别到颜色；可切到 JSON 查看原始字段" />}</div> :
        <div className="shape-workbench"><div className="shape-list">{shapes.map((shape) => { const id = `${shape.mode}:${shape.name}`; return <button key={id} className={activeShape && `${activeShape.mode}:${activeShape.name}` === id ? "shape-row selected" : "shape-row"} onClick={() => { setSelectedShape(id); setSelectedReplacement(""); }}><ComposedMark /><span><strong>{shape.name}</strong><small>{shape.mode.replace("lottie-", "Lottie ")}</small></span><b>× {shape.count}</b></button>; })}{!shapes.length && <Empty text="暂未识别到命名组合；基础圆形、矩形和路径已自动忽略" />}</div>{activeShape && <div className="replace-card"><span className="replace-kicker">EXTERNAL REPLACEMENT</span><h3>替换全部「{activeShape.name}」</h3><div className="composed-current"><ComposedMark /><span><small>主文件中的目标</small><strong>{activeShape.name}</strong></span><b>{activeShape.count} 个实例</b></div><button className="replacement-upload" onClick={() => replacementFileRef.current?.click()}><span className="replacement-upload-icon">＋</span><span><small>{replacementFileName ? "替换形状文件" : "上传替换形状"}</small><strong>{replacementFileName || "选择另一个 JSON 文件"}</strong></span><b>{replacementFileName ? "重新上传" : "选择文件"}</b></button><input ref={replacementFileRef} type="file" accept="application/json,.json" onChange={loadReplacementFile} hidden />{replacementError && <div className="replacement-error" role="alert">{replacementError}</div>}{replacementData !== null && <><div className="replacement-summary"><span>可用的同类型组合</span><b>{compatibleReplacementShapes.length}</b></div><div className="composed-options replacement-options">{compatibleReplacementShapes.map((shape) => { const id = `${shape.mode}:${shape.name}`; return <button key={id} className={activeReplacement && `${activeReplacement.mode}:${activeReplacement.name}` === id ? "selected" : ""} onClick={() => setSelectedReplacement(id)}><ComposedMark /><span>{shape.name}</span><b>{shape.mode.replace("lottie-", "Lottie ")}</b></button>; })}{!compatibleReplacementShapes.length && <div className="replacement-empty">替换文件里没有与当前目标相同类型的组合形状。</div>}</div>{activeReplacement && <button className="apply-replacement" onClick={() => changeShapeFromUpload(activeShape, activeReplacement)}>使用「{activeReplacement.name}」替换全部</button>}</>}<p>替换结构来自你上传的外部 JSON，并保留主文件中每个实例的位置与变换。所有文件只在本地浏览器中处理。</p></div>}</div>}
      </section>
      <aside className="json-panel"><div className="panel-tabs"><button className={inspectorTab === "preview" ? "active" : ""} onClick={() => setInspectorTab("preview")}><span className="status-dot" />视觉预览</button><button className={inspectorTab === "json" ? "active" : ""} onClick={() => setInspectorTab("json")}>实时 JSON</button></div>{inspectorTab === "preview" ? <div className="preview-panel"><div className="preview-head"><span>{isLottie(data) ? "LOTTIE LIVE" : "AUTO LAYOUT"}</span><b>{colors.length} COLORS · {shapes.length} SHAPES</b></div><VisualPreview data={data} colors={colors} shapes={shapes} /><div className="preview-foot">修改颜色或形状后自动刷新</div></div> : <><div className="json-head"><div><span className="status-dot" /> 已同步</div><button onClick={() => navigator.clipboard.writeText(jsonText).then(() => setToast("JSON 已复制"))}>复制</button></div><pre>{jsonText.split("\n").map((line, i) => <code key={i}><span>{String(i + 1).padStart(2, "0")}</span>{line}</code>)}</pre><div className="json-foot"><span>{jsonText.split("\n").length} 行</span><span>UTF-8</span></div></>}</aside>
    </section>
    {colorEditor && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label="颜色编辑器"><div className="color-dialog"><header><div><span className="eyebrow">COLOR EDITOR</span><h3>替换颜色</h3></div><button onClick={() => setColorEditor(null)} aria-label="关闭颜色编辑器">×</button></header><div className="color-dialog-main"><label className="large-picker" style={{ background: colorEditor.current }}><input type="color" value={colorEditor.current} onChange={(event) => changeColor(event.target.value)} /><span>点击选择色彩</span></label><div className="color-values"><label>HEX 色值</label><div><input value={colorEditor.draft} onChange={(event) => setColorEditor({ ...colorEditor, draft: event.target.value.toUpperCase() })} /><button onClick={() => changeColor(colorEditor.draft)}>应用</button></div><small>将同步修改 {colorEditor.count} 个引用，窗口不会自动关闭。</small></div></div><div className="quick-colors">{["#171717", "#FFFFFF", "#7557E8", "#FF6B4A", "#FFCD56", "#3AA16E"].map((hex) => <button key={hex} style={{ background: hex }} onClick={() => changeColor(hex)} aria-label={`选择 ${hex}`} />)}</div><footer><span>修改已实时写入预览和 JSON</span><button onClick={() => setColorEditor(null)}>关闭</button></footer></div></div>}
    <div className="toast" aria-live="polite"><span>✓</span>{toast}</div>
  </main>;
}

function Empty({ text }: { text: string }) { return <div className="empty"><span>◎</span><p>{text}</p></div>; }
