"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";

type ShapeName = "circle" | "square" | "triangle" | "star" | "heart" | "hexagon";

const SAMPLE = {
  name: "summer-campaign",
  canvas: { background: "#F6F5F2", width: 1080, height: 1080 },
  elements: [
    { id: "badge-1", shape: "circle", fill: "#FF6B4A", icon: "star" },
    { id: "badge-2", shape: "circle", fill: "#FF6B4A", icon: "star" },
    { id: "card", shape: "square", fill: "#1F2937", stroke: "#FFFFFF" },
    { id: "accent", shape: "triangle", fill: "rgba(255, 205, 86, 1)" },
  ],
};

const SHAPES: ShapeName[] = ["circle", "square", "triangle", "star", "heart", "hexagon"];
const SHAPE_LABEL: Record<string, string> = {
  circle: "圆形", square: "方形", triangle: "三角形", star: "星形", heart: "爱心", hexagon: "六边形",
};

function Shape({ name, className = "" }: { name: string; className?: string }) {
  const safe = SHAPES.includes(name as ShapeName) ? name : "square";
  return <span className={`shape shape-${safe} ${className}`} aria-label={SHAPE_LABEL[safe]} />;
}

function walk(value: unknown, visit: (key: string, value: unknown) => void, key = "root") {
  visit(key, value);
  if (Array.isArray(value)) value.forEach((item, i) => walk(item, visit, `${key}.${i}`));
  else if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => walk(v, visit, k));
  }
}

const colorPattern = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;

function collectColors(data: unknown) {
  const counts = new Map<string, number>();
  walk(data, (_, value) => {
    if (typeof value === "string" && colorPattern.test(value.trim())) {
      const color = value.trim();
      counts.set(color, (counts.get(color) || 0) + 1);
    }
  });
  return [...counts.entries()].map(([value, count]) => ({ value, count }));
}

function collectShapes(data: unknown) {
  const counts = new Map<string, number>();
  walk(data, (key, value) => {
    if (typeof value !== "string") return;
    const normalized = value.toLowerCase() as ShapeName;
    if ((key === "shape" || key === "icon" || key === "type") && SHAPES.includes(normalized)) {
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  });
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

function replaceEvery(value: unknown, oldValue: string, newValue: string): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceEvery(item, oldValue, newValue));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, replaceEvery(v, oldValue, newValue)]));
  }
  return value === oldValue ? newValue : value;
}

function replaceNamedShape(value: unknown, oldValue: string, newValue: string): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceNamedShape(item, oldValue, newValue));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => {
      const isShapeField = key === "shape" || key === "icon" || key === "type";
      return [key, isShapeField && child === oldValue ? newValue : replaceNamedShape(child, oldValue, newValue)];
    }));
  }
  return value;
}

function toPickerColor(value: string) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${value.slice(1).split("").map((c) => c + c).join("")}`;
  return "#7C5CFC";
}

export default function Home() {
  const [data, setData] = useState<unknown>(SAMPLE);
  const [fileName, setFileName] = useState("summer-campaign.json");
  const [activeTab, setActiveTab] = useState<"colors" | "shapes">("colors");
  const [selectedShape, setSelectedShape] = useState<string>("circle");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("已识别示例 JSON");
  const fileRef = useRef<HTMLInputElement>(null);
  const colors = useMemo(() => collectColors(data), [data]);
  const shapes = useMemo(() => collectShapes(data), [data]);
  const jsonText = useMemo(() => JSON.stringify(data, null, 2), [data]);

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      setData(parsed); setFileName(file.name); setError(""); setToast(`已识别 ${file.name}`);
    } catch {
      setError("无法解析这个文件，请检查 JSON 格式后重试。");
    }
    event.target.value = "";
  };

  const changeColor = (from: string, to: string) => {
    setData((current) => replaceEvery(current, from, to));
    setToast(`已将 ${from} 的全部引用替换为 ${to}`);
  };

  const changeShape = (from: string, to: string) => {
    setData((current) => replaceNamedShape(current, from, to));
    setSelectedShape(to); setToast(`已同步替换全部 ${SHAPE_LABEL[from]} 实例`);
  };

  const download = () => {
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = fileName.replace(/\.json$/i, "") + "-edited.json"; a.click();
    URL.revokeObjectURL(url); setToast("修改后的 JSON 已下载");
  };

  const activeShape = shapes.find((item) => item.name === selectedShape) || shapes[0];

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#" aria-label="Jsonicle 首页"><span className="brand-mark">J</span><span>Jsonicle</span></a>
        <div className="top-actions">
          <span className="privacy"><span className="lock">◆</span>文件仅在本地处理</span>
          <button className="button button-ghost" onClick={() => fileRef.current?.click()}><span>＋</span> 新建文件</button>
          <button className="button button-dark" onClick={download}>下载 JSON <span className="arrow">↓</span></button>
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow">VISUAL JSON EDITOR · 01</span>
          <h1>找到它，<em>换掉它。</em></h1>
          <p>上传 JSON，自动识别其中的颜色与形状。一次修改，所有同名实例同步更新。</p>
        </div>
        <button className="file-card" onClick={() => fileRef.current?.click()} aria-label="上传 JSON 文件">
          <span className="file-icon">{"{ }"}</span>
          <span><strong>{fileName}</strong><small>{(new Blob([jsonText]).size / 1024).toFixed(1)} KB · JSON</small></span>
          <span className="file-change">更换文件</span>
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={loadFile} hidden />
      </section>

      {error && <div className="error" role="alert">{error}</div>}

      <section className="workspace">
        <aside className="rail">
          <div className="rail-title">已识别</div>
          <button className={activeTab === "colors" ? "rail-item active" : "rail-item"} onClick={() => setActiveTab("colors")}>
            <span className="rail-icon palette-icon">◒</span><span>颜色<small>Colors</small></span><b>{colors.length}</b>
          </button>
          <button className={activeTab === "shapes" ? "rail-item active" : "rail-item"} onClick={() => setActiveTab("shapes")}>
            <span className="rail-icon">◇</span><span>形状<small>Shapes</small></span><b>{shapes.length}</b>
          </button>
          <div className="rail-note"><span>↗</span><p>所有修改都会实时写入右侧 JSON 预览。</p></div>
        </aside>

        <section className="editor-panel">
          <div className="section-head">
            <div><span className="index">0{activeTab === "colors" ? "1" : "2"}</span><h2>{activeTab === "colors" ? "颜色" : "形状"}</h2><span className="en">{activeTab === "colors" ? "COLORS" : "SHAPES"}</span></div>
            <p>{activeTab === "colors" ? `共识别到 ${colors.length} 种颜色，点击色块进行替换。` : `共识别到 ${shapes.length} 种形状，选择同名实例后统一替换。`}</p>
          </div>

          {activeTab === "colors" ? (
            <div className="color-grid">
              {colors.map((color, index) => (
                <article className="color-card" key={color.value}>
                  <div className="swatch" style={{ background: color.value }}><span>{String(index + 1).padStart(2, "0")}</span></div>
                  <div className="color-meta"><label>当前颜色</label><strong>{color.value}</strong><small>{color.count} 个引用</small></div>
                  <label className="picker-label">替换为<input type="color" value={toPickerColor(color.value)} onChange={(e) => changeColor(color.value, e.target.value.toUpperCase())} /><span>选择颜色</span></label>
                </article>
              ))}
              {colors.length === 0 && <Empty text="这个 JSON 中暂未识别到颜色值" />}
            </div>
          ) : (
            <div className="shape-workbench">
              <div className="shape-list">
                {shapes.map((shape) => <button key={shape.name} className={activeShape?.name === shape.name ? "shape-row selected" : "shape-row"} onClick={() => setSelectedShape(shape.name)}><Shape name={shape.name} /><span><strong>{SHAPE_LABEL[shape.name]}</strong><small>{shape.name}</small></span><b>× {shape.count}</b></button>)}
                {shapes.length === 0 && <Empty text="这个 JSON 中暂未识别到形状名称" />}
              </div>
              {activeShape && <div className="replace-card">
                <span className="replace-kicker">REPLACE ALL</span>
                <h3>替换全部「{SHAPE_LABEL[activeShape.name]}」</h3>
                <div className="replacement-line"><div><Shape name={activeShape.name} /><small>当前</small></div><span>→</span><div className="shape-options">{SHAPES.filter((shape) => shape !== activeShape.name).map((shape) => <button key={shape} title={SHAPE_LABEL[shape]} onClick={() => changeShape(activeShape.name, shape)}><Shape name={shape} /></button>)}</div></div>
                <p>这会同步更新 JSON 中 {activeShape.count} 个同名实例。</p>
              </div>}
            </div>
          )}
        </section>

        <aside className="json-panel">
          <div className="json-head"><div><span className="status-dot" /> 实时 JSON</div><button onClick={() => navigator.clipboard.writeText(jsonText).then(() => setToast("JSON 已复制"))}>复制</button></div>
          <pre>{jsonText.split("\n").map((line, i) => <code key={i}><span>{String(i + 1).padStart(2, "0")}</span>{line}</code>)}</pre>
          <div className="json-foot"><span>{jsonText.split("\n").length} 行</span><span>UTF-8</span></div>
        </aside>
      </section>

      <div className="toast" aria-live="polite"><span>✓</span>{toast}</div>
    </main>
  );
}

function Empty({ text }: { text: string }) { return <div className="empty"><span>◎</span><p>{text}</p></div>; }
