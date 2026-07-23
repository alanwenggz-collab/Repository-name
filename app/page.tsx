"use client";

import { ChangeEvent, DragEvent as ReactDragEvent, type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { AnimationItem } from "lottie-web";
import { strToU8, zipSync } from "fflate";

type ShapeName = "circle" | "square" | "triangle" | "star" | "heart" | "hexagon" | "path";
type ColorInfo = { hex: string; label: string; count: number };
type ShapeInfo = { name: string; count: number; mode: "lottie-group" | "lottie-layer" | "component" | "reference" };
type UploadedSvg = { fileName: string; name: string; preview: string; raw: string; group: Record<string, unknown>; partCount: number };
type ImageInfo = { id: string; name: string; value: string; preview: string; count: number; mode: "lottie-asset" | "field"; assetId?: string; key?: string };
type UploadedImage = { fileName: string; dataUrl: string; width: number; height: number; size: number };
type OptimizationItem = { key: string; title: string; description: string; count: number; examples: string[] };
type CompressionResult = { text: string; originalSize: number; compressedSize: number; percentage: number; optimizations: OptimizationItem[] };
type CompressionResults = { normal: CompressionResult; advanced: CompressionResult };
type MediaConversionResult = { text: string; kind: string; fileCount: number; originalSize: number; payloadSize: number; jsonSize: number; percentage: number; outputName: string };
type MediaFrame = { dataUrl: string; width: number; height: number; duration: number };
type EditVersion = { id: string; label: string; createdAt: number; data: unknown };
type DiffItem = { path: string; before: string; after: string };
type SavedDraft = { version: 1; fileName: string; originalData: unknown; data: unknown; savedAt: number };

const SAMPLE = {
  name: "summer-campaign",
  canvas: { background: "#101513", width: 1080, height: 1080 },
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
function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`; }
function bytesToBase64(bytes: Uint8Array) {
  let binary = ""; const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(binary);
}
async function packMediaFile(file: File) {
  const source = new Uint8Array(await file.arrayBuffer()); let packed = source; let encoding = "base64";
  if (typeof CompressionStream !== "undefined") {
    const stream = file.stream().pipeThrough(new CompressionStream("gzip")); const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    if (compressed.length < source.length) { packed = compressed; encoding = "gzip+base64"; }
  }
  return { name: file.name, mime: file.type || "application/octet-stream", originalSize: file.size, packedSize: packed.length, encoding, data: bytesToBase64(packed) };
}
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
  if (object.ty === "gr" && typeof object.nm === "string" && object.nm.trim() && !/^__json(?:icle|able)_svg_part_/.test(object.nm)) return { name: object.nm.trim(), mode: "lottie-group" };
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

const IMAGE_KEY = /^(src|url|path|image|imageurl|image_url|href|poster|thumbnail|backgroundimage|background_image)$/i;
const IMAGE_VALUE = /^(data:image\/|blob:|https?:\/\/)|\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i;

function previewableImageSource(source: string) {
  return /^(data:image\/|blob:|https?:\/\/)/i.test(source) ? source : "";
}

function scanImages(data: unknown) {
  const images: ImageInfo[] = [];
  const referenceNames = new Map<string, { names: Set<string>; count: number }>();
  const collectReferences = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(collectReferences);
    else if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      if (typeof object.refId === "string") {
        const current = referenceNames.get(object.refId) || { names: new Set<string>(), count: 0 };
        if (typeof object.nm === "string" && object.nm.trim()) current.names.add(object.nm.trim()); current.count += 1; referenceNames.set(object.refId, current);
      }
      Object.values(object).forEach(collectReferences);
    }
  };
  collectReferences(data);
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).assets)) {
    ((data as Record<string, unknown>).assets as unknown[]).forEach((asset, index) => {
      if (!asset || typeof asset !== "object") return;
      const object = asset as Record<string, unknown>; if (typeof object.p !== "string" || !object.p.trim()) return;
      const assetId = typeof object.id === "string" ? object.id : `asset-${index}`; const refs = referenceNames.get(assetId);
      const joined = `${typeof object.u === "string" ? object.u : ""}${object.p}`; const source = /^(data:image\/|blob:|https?:\/\/)/i.test(object.p) ? object.p : joined;
      const fallbackName = object.p.split("/").pop()?.split("?")[0] || assetId; const name = refs?.names.size ? [...refs.names].join(" / ") : typeof object.nm === "string" ? object.nm : fallbackName;
      images.push({ id: `lottie:${assetId}`, name, value: object.p, preview: previewableImageSource(source), count: refs?.count || 1, mode: "lottie-asset", assetId });
    });
  }
  const fieldMap = new Map<string, ImageInfo>();
  const scanFields = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(scanFields);
    else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      if (typeof child === "string" && IMAGE_KEY.test(key) && IMAGE_VALUE.test(child)) {
        const id = `field:${key}:${child}`; const current = fieldMap.get(id);
        fieldMap.set(id, { id, name: key, value: child, preview: previewableImageSource(child), count: (current?.count || 0) + 1, mode: "field", key });
      } else scanFields(child);
    });
  };
  scanFields(data); return [...images, ...fieldMap.values()];
}

function replaceImageResource(data: unknown, target: ImageInfo, dataUrl: string): unknown {
  if (Array.isArray(data)) return data.map((item) => replaceImageResource(item, target, dataUrl));
  if (data && typeof data === "object") {
    const object = data as Record<string, unknown>;
    if (target.mode === "lottie-asset" && object.id === target.assetId && object.p === target.value) return { ...object, u: "", p: dataUrl, e: 1 };
    return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, target.mode === "field" && key === target.key && child === target.value ? dataUrl : replaceImageResource(child, target, dataUrl)]));
  }
  return data;
}

function readImageFile(file: File): Promise<UploadedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error("READ_FAILED")); reader.readAsDataURL(file);
    reader.onload = () => {
      const dataUrl = String(reader.result || ""); const image = new Image(); image.onerror = () => reject(new Error("INVALID_IMAGE"));
      image.onload = () => resolve({ fileName: file.name, dataUrl, width: image.naturalWidth, height: image.naturalHeight, size: file.size }); image.src = dataUrl;
    };
  });
}

function waitForEvent(target: EventTarget, eventName: string) {
  return new Promise<void>((resolve, reject) => {
    const done = () => { cleanup(); resolve(); }; const failed = () => { cleanup(); reject(new Error("MEDIA_DECODE_FAILED")); };
    const cleanup = () => { target.removeEventListener(eventName, done); target.removeEventListener("error", failed); };
    target.addEventListener(eventName, done, { once: true }); target.addEventListener("error", failed, { once: true });
  });
}

function renderFrame(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, duration = 1000 / 12): MediaFrame {
  const maxSide = 720; const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale)); const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true }); if (!context) throw new Error("CANVAS_FAILED");
  context.drawImage(source, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL("image/webp", .72), width, height, duration: Math.max(16, duration) };
}

async function decodeStill(file: File) {
  const source = await readImageFile(file); const image = new Image(); image.src = source.dataUrl;
  if (!image.complete) await waitForEvent(image, "load");
  return renderFrame(image, image.naturalWidth, image.naturalHeight);
}

async function decodeAnimatedImage(file: File) {
  const Decoder = (window as unknown as { ImageDecoder?: new (options: { data: ArrayBuffer; type: string }) => { tracks: { ready: Promise<void>; selectedTrack?: { frameCount?: number } }; decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>; close(): void } }).ImageDecoder;
  if (!Decoder) return [await decodeStill(file)];
  const decoder = new Decoder({ data: await file.arrayBuffer(), type: file.type || (file.name.toLowerCase().endsWith(".gif") ? "image/gif" : "image/apng") });
  try {
    await decoder.tracks.ready; const total = decoder.tracks.selectedTrack?.frameCount || 1; const limit = Math.min(total, 96); const step = Math.max(1, Math.floor(total / limit)); const frames: MediaFrame[] = [];
    for (let frameIndex = 0; frameIndex < total && frames.length < limit; frameIndex += step) {
      const { image } = await decoder.decode({ frameIndex });
      frames.push(renderFrame(image, image.displayWidth, image.displayHeight, Number(image.duration || 83333) / 1000 * step)); image.close();
    }
    return frames;
  } finally { decoder.close(); }
}

async function decodeVideo(file: File) {
  const url = URL.createObjectURL(file); const video = document.createElement("video"); video.muted = true; video.playsInline = true; video.preload = "auto"; video.src = url;
  try {
    await waitForEvent(video, "loadedmetadata"); if (video.readyState < 2) await waitForEvent(video, "loadeddata"); const duration = Number.isFinite(video.duration) ? video.duration : 0; if (!duration) throw new Error("INVALID_VIDEO");
    const total = Math.min(96, Math.max(1, Math.ceil(duration * 12))); const frames: MediaFrame[] = [];
    for (let index = 0; index < total; index += 1) {
      const targetTime = Math.min(duration - .001, index / 12); if (Math.abs(video.currentTime - targetTime) > .001) { video.currentTime = targetTime; await waitForEvent(video, "seeked"); }
      frames.push(renderFrame(video, video.videoWidth, video.videoHeight));
    }
    return frames;
  } finally { URL.revokeObjectURL(url); video.remove(); }
}

function framesToLottie(frames: MediaFrame[]) {
  if (!frames.length) throw new Error("NO_FRAMES"); const fr = 12; const width = Math.max(...frames.map((frame) => frame.width)); const height = Math.max(...frames.map((frame) => frame.height));
  const timeline = frames.flatMap((frame, frameIndex) => Array.from({ length: Math.max(1, Math.round(frame.duration / 1000 * fr)) }, () => frameIndex)).slice(0, 240);
  const assets = frames.map((frame, index) => ({ id: `image_${index}`, w: frame.width, h: frame.height, u: "", p: frame.dataUrl, e: 1 }));
  const layers = timeline.map((assetIndex, index) => { const frame = frames[assetIndex]; return { ddd: 0, ind: index + 1, ty: 2, nm: `Frame ${String(index + 1).padStart(3, "0")}`, refId: `image_${assetIndex}`, sr: 1, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [width / 2, height / 2, 0] }, a: { a: 0, k: [frame.width / 2, frame.height / 2, 0] }, s: { a: 0, k: [100, 100, 100] } }, ao: 0, ip: index, op: index + 1, st: index, bm: 0 }; }).reverse();
  return { v: "5.12.2", fr, ip: 0, op: timeline.length, w: width, h: height, nm: "Jsonable Media Conversion", ddd: 0, assets, layers, markers: [], meta: { generator: "Jsonable", sourceFrames: frames.length, playback: "lottie" } };
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

const DRAFT_DB = "jsonable-local-drafts";
const DRAFT_STORE = "drafts";
const DRAFT_KEY = "latest-edit";

function openDraftDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DRAFT_DB, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(DRAFT_STORE)) request.result.createObjectStore(DRAFT_STORE); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

async function saveLocalDraft(draft: SavedDraft) {
  const db = await openDraftDb();
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction(DRAFT_STORE, "readwrite"); transaction.objectStore(DRAFT_STORE).put(draft, DRAFT_KEY); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  db.close();
}

async function readLocalDraft() {
  const db = await openDraftDb();
  const draft = await new Promise<SavedDraft | null>((resolve, reject) => { const request = db.transaction(DRAFT_STORE, "readonly").objectStore(DRAFT_STORE).get(DRAFT_KEY); request.onsuccess = () => resolve((request.result as SavedDraft | undefined) || null); request.onerror = () => reject(request.error); });
  db.close(); return draft;
}

function createVersion(label: string, data: unknown): EditVersion { return { id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, label, createdAt: Date.now(), data: clone(data) }; }

function diffValue(value: unknown) {
  if (value === undefined) return "未设置";
  if (typeof value === "string") {
    if (/^data:/i.test(value)) return `${value.slice(0, value.indexOf(",") + 1)}…（${formatBytes(value.length)}）`;
    return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }
  const text = JSON.stringify(value); return text && text.length > 120 ? `${text.slice(0, 117)}…` : text ?? String(value);
}

function diffJson(before: unknown, after: unknown, path = "$", result: DiffItem[] = []): DiffItem[] {
  if (result.length >= 80 || Object.is(before, after)) return result;
  const beforeObject = before !== null && typeof before === "object"; const afterObject = after !== null && typeof after === "object";
  if (!beforeObject || !afterObject || Array.isArray(before) !== Array.isArray(after)) { result.push({ path, before: diffValue(before), after: diffValue(after) }); return result; }
  const beforeRecord = before as Record<string, unknown>; const afterRecord = after as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])];
  for (const key of keys) { if (result.length >= 80) break; const childPath = Array.isArray(after) || Array.isArray(before) ? `${path}[${key}]` : `${path}.${key}`; diffJson(beforeRecord[key], afterRecord[key], childPath, result); }
  return result;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function optimizeJson(data: unknown, prettyText: string) {
  const report = new Map<string, OptimizationItem>();
  const record = (key: string, title: string, description: string, example: string, amount = 1) => {
    const current = report.get(key) || { key, title, description, count: 0, examples: [] }; current.count += amount;
    if (example && current.examples.length < 6 && !current.examples.includes(example)) current.examples.push(example); report.set(key, current);
  };
  const constantKeyframe = (frames: unknown[]) => {
    let value: unknown = undefined; let found = false;
    for (const frame of frames) {
      if (!frame || typeof frame !== "object" || Array.isArray(frame)) return undefined;
      const object = frame as Record<string, unknown>;
      for (const candidate of [object.s, object.e]) {
        if (candidate === undefined) continue;
        if (!found) { value = candidate; found = true; }
        else if (stableJson(candidate) !== stableJson(value)) return undefined;
      }
    }
    const safelyStatic = typeof value === "number" || (Array.isArray(value) && value.every((item) => typeof item === "number"));
    return found && safelyStatic ? clone(value) : undefined;
  };
  const walk = (value: unknown, path = "$", parentKey = "") : unknown => {
    if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) {
      const rounded = Math.round(value * 100000) / 100000;
      if (rounded !== value) record("precision", "收敛数值精度", "将过长小数统一保留到 5 位，减少路径和关键帧数据。", path);
      return rounded;
    }
    if (Array.isArray(value)) {
      const source = (parentKey === "shapes" || parentKey === "it") ? value.filter((item, index) => {
        const hidden = !!item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).hd === true;
        if (hidden) record("hidden-shapes", "删除隐藏矢量项", "移除明确标记为隐藏、不会参与渲染的矢量结构。", `${path}[${index}]`); return !hidden;
      }) : value;
      return source.map((child, index) => walk(child, `${path}[${index}]`, parentKey));
    }
    if (!value || typeof value !== "object") return value;
    const source = value as Record<string, unknown>; const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source)) {
      const childPath = `${path}.${key}`;
      if (key.startsWith("__jsonable")) { record("editor-fields", "清理编辑器内部字段", "删除只用于编辑过程、不属于 Lottie 标准的辅助字段。", childPath); continue; }
      const emptyArray = Array.isArray(child) && child.length === 0 && ["markers", "chars", "assets"].includes(key);
      const emptyObject = !!child && typeof child === "object" && !Array.isArray(child) && Object.keys(child as Record<string, unknown>).length === 0 && ["slots", "meta"].includes(key);
      if (emptyArray || emptyObject) { record("empty-metadata", "移除空的可选数据", "删除不包含内容的可选资源、标记和元数据容器。", childPath); continue; }
      next[key] = walk(child, childPath, key);
    }
    if (next.a === 1 && Array.isArray(next.k) && next.k.length && next.k.every((frame) => !!frame && typeof frame === "object" && !Array.isArray(frame) && typeof (frame as Record<string, unknown>).t === "number") && next.x === undefined) {
      const constant = constantKeyframe(next.k);
      if (constant !== undefined) { next.a = 0; next.k = constant; record("static-keyframes", "合并静态关键帧", "将数值始终相同的动画属性还原为静态值。", path); }
    }
    return next;
  };
  let optimized = walk(clone(data));
  if (isLottie(optimized) && Array.isArray(optimized.assets)) {
    const assets = optimized.assets.filter((asset): asset is Record<string, unknown> => !!asset && typeof asset === "object" && !Array.isArray(asset));
    const signatures = new Map<string, string>(); const remap = new Map<string, string>(); const uniqueAssets: Record<string, unknown>[] = [];
    assets.forEach((asset, index) => {
      const id = typeof asset.id === "string" ? asset.id : ""; const signature = stableJson(Object.fromEntries(Object.entries(asset).filter(([key]) => key !== "id")));
      const existing = signatures.get(signature);
      if (id && existing) { remap.set(id, existing); record("duplicate-assets", "合并重复资源", "复用内容完全相同的图片或预合成资源，并同步更新引用。", `$.assets[${index}] (${id} → ${existing})`); }
      else { if (id) signatures.set(signature, id); uniqueAssets.push(asset); }
    });
    const rewriteRefs = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rewriteRefs);
      if (!value || typeof value !== "object") return value;
      const object = value as Record<string, unknown>;
      return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, key === "refId" && typeof child === "string" && remap.has(child) ? remap.get(child) : rewriteRefs(child)]));
    };
    optimized = rewriteRefs({ ...optimized, assets: uniqueAssets }) as Record<string, unknown>;
    const root = optimized as Record<string, unknown>; const currentAssets = Array.isArray(root.assets) ? root.assets.filter((asset): asset is Record<string, unknown> => !!asset && typeof asset === "object" && !Array.isArray(asset)) : [];
    const assetMap = new Map(currentAssets.filter((asset) => typeof asset.id === "string").map((asset) => [asset.id as string, asset])); const used = new Set<string>(); const queue: string[] = [];
    const scanRefs = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(scanRefs);
      else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([key, child]) => { if (key === "refId" && typeof child === "string" && !used.has(child)) { used.add(child); queue.push(child); } else scanRefs(child); });
    };
    scanRefs(Object.fromEntries(Object.entries(root).filter(([key]) => key !== "assets")));
    while (queue.length) { const asset = assetMap.get(queue.shift() || ""); if (asset) scanRefs(asset); }
    const kept = currentAssets.filter((asset, index) => {
      const id = typeof asset.id === "string" ? asset.id : ""; const keep = !id || used.has(id);
      if (!keep) record("unused-assets", "删除未引用资源", "移除没有任何图层引用的图片和预合成资源。", `$.assets[${index}] (${id})`); return keep;
    });
    if (kept.length) root.assets = kept; else delete root.assets;
  }
  const text = JSON.stringify(optimized); const whitespaceSaved = Math.max(0, new Blob([prettyText]).size - new Blob([JSON.stringify(data)]).size);
  if (whitespaceSaved > 0) record("whitespace", "移除格式空白", "删除缩进、换行与多余空格，同时保持 JSON 内容不变。", `整份文件 · ${formatBytes(whitespaceSaved)}`);
  return { text, optimizations: [...report.values()] };
}

function lottieTransform() {
  return { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } };
}

function rgbArray(value: string) {
  const hex = parseCssColor(value) || "#171717";
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, 1];
}

async function svgToLottieGroup(svgText: string, name: string) {
  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.tagName.toLowerCase() !== "svg") throw new Error("INVALID_SVG");
  const imported = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:1000px;height:1000px;visibility:hidden;pointer-events:none";
  imported.style.width = "1000px"; imported.style.height = "1000px"; host.appendChild(imported); document.body.appendChild(host);
  try {
    const elements = [...imported.querySelectorAll<SVGGeometryElement>("path,rect,circle,ellipse,polygon,polyline,line")];
    if (!elements.length) throw new Error("NO_GEOMETRY");
    const sampled = elements.map((element, index) => {
      const length = element.getTotalLength();
      if (!Number.isFinite(length) || length <= 0) return null;
      const tag = element.tagName.toLowerCase();
      const closed = ["rect", "circle", "ellipse", "polygon"].includes(tag) || (tag === "path" && /z\s*$/i.test(element.getAttribute("d") || ""));
      const count = Math.min(96, Math.max(closed ? 12 : 8, Math.ceil(length / 4)));
      const matrix = element.getCTM();
      const vertices = Array.from({ length: count }, (_, pointIndex) => {
        const distance = closed ? length * pointIndex / count : length * pointIndex / Math.max(count - 1, 1);
        const point = element.getPointAtLength(distance);
        const transformed = matrix ? new DOMPoint(point.x, point.y).matrixTransform(matrix) : point;
        return [transformed.x, transformed.y];
      });
      const style = getComputedStyle(element);
      return { index, vertices, closed, fill: style.fill, fillOpacity: Number(style.fillOpacity || 1), stroke: style.stroke, strokeOpacity: Number(style.strokeOpacity || 1), strokeWidth: Number.parseFloat(style.strokeWidth || "1") || 1 };
    }).filter((item): item is NonNullable<typeof item> => !!item);
    if (!sampled.length) throw new Error("NO_GEOMETRY");
    const points = sampled.flatMap((item) => item.vertices); const xs = points.map((point) => point[0]); const ys = points.map((point) => point[1]);
    const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
    const scale = 100 / Math.max(maxX - minX || 1, maxY - minY || 1); const centerX = (minX + maxX) / 2; const centerY = (minY + maxY) / 2;
    const parts = sampled.map((item) => {
      const vertices = item.vertices.map(([x, y]) => [(x - centerX) * scale, (y - centerY) * scale]);
      const zeroTangents = vertices.map(() => [0, 0]);
      const items: Record<string, unknown>[] = [{ ty: "sh", nm: `Path ${item.index + 1}`, ks: { a: 0, k: { i: zeroTangents, o: zeroTangents, v: vertices, c: item.closed } }, hd: false }];
      if (item.fill !== "none") items.push({ ty: "fl", c: { a: 0, k: rgbArray(item.fill) }, o: { a: 0, k: Math.max(0, Math.min(100, item.fillOpacity * 100)) }, r: 1, hd: false });
      if (item.stroke !== "none" && item.strokeWidth > 0) items.push({ ty: "st", c: { a: 0, k: rgbArray(item.stroke) }, o: { a: 0, k: Math.max(0, Math.min(100, item.strokeOpacity * 100)) }, w: { a: 0, k: item.strokeWidth * scale }, lc: 2, lj: 2, hd: false });
      items.push(lottieTransform());
      return { ty: "gr", nm: `__jsonable_svg_part_${item.index + 1}`, it: items, hd: false };
    });
    return { ty: "gr", nm: name, it: [...parts, lottieTransform()], hd: false, __jsonableSvg: true } as Record<string, unknown>;
  } finally { host.remove(); }
}

function collectPathVertices(value: unknown, output: number[][] = []) {
  if (Array.isArray(value)) value.forEach((item) => collectPathVertices(item, output));
  else if (value && typeof value === "object") {
    const object = value as Record<string, unknown>; const ks = object.ks as Record<string, unknown> | undefined; const k = ks?.k as Record<string, unknown> | undefined;
    if (object.ty === "sh" && Array.isArray(k?.v)) (k.v as unknown[]).forEach((point) => { if (Array.isArray(point) && point.length >= 2) output.push(point as number[]); });
    Object.values(object).forEach((item) => collectPathVertices(item, output));
  }
  return output;
}

function fitSvgPaths(template: Record<string, unknown>, current: Record<string, unknown>) {
  const source = collectPathVertices(template); const target = collectPathVertices(current);
  if (!source.length || !target.length) return;
  const bounds = (points: number[][]) => ({ minX: Math.min(...points.map((p) => p[0])), maxX: Math.max(...points.map((p) => p[0])), minY: Math.min(...points.map((p) => p[1])), maxY: Math.max(...points.map((p) => p[1])) });
  const a = bounds(source); const b = bounds(target); const sourceW = a.maxX - a.minX || 1; const sourceH = a.maxY - a.minY || 1; const targetW = b.maxX - b.minX || 100; const targetH = b.maxY - b.minY || 100;
  const scale = Math.min(targetW / sourceW, targetH / sourceH); const sourceCX = (a.minX + a.maxX) / 2; const sourceCY = (a.minY + a.maxY) / 2; const targetCX = (b.minX + b.maxX) / 2; const targetCY = (b.minY + b.maxY) / 2;
  source.forEach((point) => { point[0] = (point[0] - sourceCX) * scale + targetCX; point[1] = (point[1] - sourceCY) * scale + targetCY; });
}

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
  if (next.__jsonableSvg || next.__jsonicleSvg) { fitSvgPaths(next, current); delete next.__jsonableSvg; delete next.__jsonicleSvg; }
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

function shapePreviewData(data: unknown, shape: ShapeInfo) {
  const template = findShapeTemplate(data, shape.name, shape.mode);
  if (!template || (shape.mode !== "lottie-group" && shape.mode !== "lottie-layer")) return null;
  const root = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const frameRate = typeof root.fr === "number" ? root.fr : 30;
  const duration = typeof root.op === "number" ? Math.max(root.op as number, 1) : 60;
  const layer = shape.mode === "lottie-layer"
    ? { ...clone(template), ip: 0, op: duration, st: 0 }
    : { ty: 4, nm: shape.name, shapes: [clone(template)], ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } }, ip: 0, op: duration, st: 0 };
  return { v: typeof root.v === "string" ? root.v : "5.10.0", fr: frameRate, ip: 0, op: duration, w: typeof root.w === "number" ? root.w : 512, h: typeof root.h === "number" ? root.h : 512, nm: `${shape.name} preview`, ddd: 0, assets: Array.isArray(root.assets) ? clone(root.assets) : [], layers: [layer] } as Record<string, unknown>;
}

function LottieShapeThumb({ animationData, label }: { animationData: Record<string, unknown>; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let animation: AnimationItem | undefined; let active = true; let timer = 0;
    import("lottie-web/build/player/lottie_light").then(({ default: lottie }) => {
      if (!active || !ref.current) return;
      ref.current.innerHTML = "";
      animation = lottie.loadAnimation({ container: ref.current, renderer: "svg", loop: false, autoplay: false, animationData: clone(animationData) });
      const fit = () => {
        if (!ref.current) return;
        const svg = ref.current.querySelector("svg"); const graphic = svg?.querySelector("g");
        if (!svg || !graphic) return;
        try {
          const box = (graphic as SVGGElement).getBBox();
          if (box.width > 0 && box.height > 0) {
            const pad = Math.max(box.width, box.height) * .12;
            svg.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`);
            svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
          }
        } catch { /* SVG may not be measurable until its first frame. */ }
      };
      animation.addEventListener?.("DOMLoaded", () => { animation?.goToAndStop(0, true); timer = window.setTimeout(fit, 30); });
    });
    return () => { active = false; window.clearTimeout(timer); animation?.destroy(); };
  }, [animationData]);
  return <div ref={ref} className="shape-thumb-canvas" role="img" aria-label={`${label} 形状预览`} />;
}

function ShapeThumb({ data, shape }: { data: unknown; shape: ShapeInfo }) {
  const animationData = useMemo(() => shapePreviewData(data, shape), [data, shape]);
  if (animationData) return <span className="shape-thumb"><LottieShapeThumb animationData={animationData} label={shape.name} /></span>;
  const template = findShapeTemplate(data, shape.name, shape.mode);
  const primitives: ShapeName[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      if ((key === "shape" || key === "type" || key === "ty") && typeof child === "string") {
        const primitive = ALIASES[child.toLowerCase().replace(/[\s_-]/g, "")]; if (primitive) primitives.push(primitive);
      }
      visit(child);
    });
  };
  visit(template);
  return <span className="shape-thumb shape-thumb-generic">{primitives.slice(0, 4).map((primitive, index) => <i key={`${primitive}-${index}`} className={`shape shape-${primitive}`} />)}{!primitives.length && <ComposedMark />}</span>;
}

function LottiePreview({ data }: { data: Record<string, unknown> }) {
  const ref = useRef<HTMLDivElement>(null);
  const animationRef = useRef<AnimationItem | null>(null);
  const totalFramesRef = useRef(1);
  const lastProgressUpdate = useRef(0);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    let animation: AnimationItem | undefined; let active = true;
    setFailed(false); setPlaying(true); setProgress(0); setCurrentTime(0); setDuration(0);
    import("lottie-web/build/player/lottie_light").then(({ default: lottie }) => {
      if (!active || !ref.current) return;
      ref.current.innerHTML = "";
      animation = lottie.loadAnimation({ container: ref.current, renderer: "svg", loop: true, autoplay: true, animationData: JSON.parse(JSON.stringify(data)) });
      animationRef.current = animation;
      animation.addEventListener?.("DOMLoaded", () => {
        const totalFrames = Math.max(1, animation?.getDuration(true) || 1); const totalSeconds = Math.max(0, animation?.getDuration(false) || 0);
        totalFramesRef.current = totalFrames; setDuration(totalSeconds);
      });
      animation.addEventListener?.("enterFrame", () => {
        const now = performance.now(); if (now - lastProgressUpdate.current < 50 || !animation) return;
        lastProgressUpdate.current = now;
        const nextProgress = Math.max(0, Math.min(1, animation.currentFrame / totalFramesRef.current));
        setProgress(nextProgress); setCurrentTime(nextProgress * (animation.getDuration(false) || 0));
      });
      animation.addEventListener?.("data_failed", () => setFailed(true));
    }).catch(() => setFailed(true));
    return () => { active = false; animationRef.current = null; animation?.destroy(); };
  }, [data]);
  const togglePlayback = () => {
    const animation = animationRef.current; if (!animation) return;
    if (playing) animation.pause(); else animation.play();
    setPlaying(!playing);
  };
  const seek = (value: number) => {
    const nextProgress = Math.max(0, Math.min(1, value)); const animation = animationRef.current; if (!animation) return;
    animation.goToAndStop(nextProgress * totalFramesRef.current, true); setPlaying(false); setProgress(nextProgress); setCurrentTime(nextProgress * duration);
  };
  const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
  return failed ? <div className="preview-message">动画结构无法直接渲染，已显示识别到的视觉元素。</div> : <div className="lottie-player"><div ref={ref} className="lottie-stage" /><div className="playback-controls"><button type="button" onClick={togglePlayback} aria-label={playing ? "暂停预览" : "播放预览"}><span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span></button><span className="playback-time">{timeLabel(currentTime)}</span><input type="range" min="0" max="1000" step="1" value={Math.round(progress * 1000)} onChange={(event) => seek(Number(event.target.value) / 1000)} aria-label="动画播放进度" style={{ "--playback-progress": `${progress * 100}%` } as CSSProperties} /><span className="playback-time">{timeLabel(duration)}</span></div></div>;
}

function ImageThumb({ source, label }: { source: string; label: string }) {
  return source ? <img src={source} alt={label} /> : <span className="image-placeholder">IMG</span>;
}

function CubeLogo() {
  return <img className="brand-logo" src="/jsonable-logo-v2.png" alt="" aria-hidden="true" />;
}

function ActionIcon({ name }: { name: "upload" | "compress" | "download" }) {
  if (name === "upload") return <svg className="action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" /></svg>;
  if (name === "compress") return <svg className="action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 3v5H3m13-5v5h5M8 21v-5H3m13 5v-5h5M8 8 4 4m12 4 4-4M8 16l-4 4m12-4 4 4" /></svg>;
  return <svg className="action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M5 20h14" /></svg>;
}

function CompressionResultWindow({ mode, result, onDownload, onDotLottie }: { mode: "normal" | "advanced"; result: CompressionResult; onDownload(): void; onDotLottie?(): void }) {
  const advanced = mode === "advanced";
  return <section className={advanced ? "compression-result-window advanced" : "compression-result-window"}><div className="result-window-head"><div><span>{advanced ? "ADVANCED OPTIMIZATION" : "STANDARD MINIFY"}</span><h4>{advanced ? "高级压缩" : "普通压缩"}{advanced && <b>PRO</b>}</h4></div><strong>-{result.percentage.toFixed(1)}%</strong></div><div className="result-size-row"><span><small>压缩前</small>{formatBytes(result.originalSize)}</span><i>→</i><span><small>压缩后</small>{formatBytes(result.compressedSize)}</span></div><div className="result-work-list"><div><span>完成的处理</span><b>{result.optimizations.reduce((sum, item) => sum + item.count, 0)} 处</b></div>{result.optimizations.map((item) => <article key={item.key}><span>{String(item.count).padStart(2, "0")}</span><div><strong>{item.title}</strong><p>{item.description}</p>{item.examples.length > 0 && <ul>{item.examples.map((example) => <li key={example}><code>{example}</code></li>)}</ul>}</div></article>)}</div><div className="result-downloads"><button className="result-download" onClick={onDownload}><ActionIcon name="download" /><span>下载 JSON</span></button>{advanced && onDotLottie && <button className="result-download dotlottie" onClick={onDotLottie}><span className="dotlottie-mark">.L</span><span>导出 dotLottie</span></button>}</div></section>;
}

const CUBE_FACES = ["front", "back", "right", "left", "top", "bottom"];

function MagicCube({ compact = false }: { compact?: boolean }) {
  const cubeRef = useRef<HTMLDivElement>(null);
  const motion = useRef({ x: -22, y: 28, targetX: -22, targetY: 28, interacted: false, lastTime: 0 });
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const animate = (time: number) => {
      const state = motion.current;
      if (!state.interacted) { state.targetX = -22 + Math.sin(time / 1900) * 5; state.targetY = 28 + Math.sin(time / 2600) * 12; }
      const delta = state.lastTime ? Math.min(40, time - state.lastTime) : 16.67;
      state.lastTime = time;
      const ease = 1 - Math.exp(-delta / 250);
      state.x += (state.targetX - state.x) * ease;
      state.y += (state.targetY - state.y) * ease;
      if (cubeRef.current) cubeRef.current.style.transform = `rotateX(${state.x.toFixed(2)}deg) rotateY(${state.y.toFixed(2)}deg)`;
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame);
  }, []);
  const followPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect(); const nx = ((event.clientX - rect.left) / rect.width - .5) * 2; const ny = ((event.clientY - rect.top) / rect.height - .5) * 2;
    motion.current.interacted = true; motion.current.targetX = -18 - ny * 24; motion.current.targetY = 28 + nx * 62;
  };
  return <div className={compact ? "cube-scene compact" : "cube-scene"} onPointerMove={followPointer} aria-label="跟随鼠标约一秒无回弹缓动旋转的 Jsonable 魔方视觉" role="img">
    <div className="cube-orbit cube-orbit-one" /><div className="cube-orbit cube-orbit-two" />
    <div className="magic-cube" ref={cubeRef}>
      {CUBE_FACES.map((face) => <div className={`cube-face cube-face-${face}`} key={face}>{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</div>)}
    </div>
    {!compact && <div className="cube-caption"><span>JSON / IN MOTION</span><strong>把复杂结构，转成看得见的改变。</strong></div>}
  </div>;
}

const LANDING_STEPS = [
  { number: "01", label: "上传" },
  { number: "02", label: "预览与代码" },
  { number: "03", label: "修改元素" },
];

function LandingGuideVisual({ step }: { step: number }) {
  if (step === 1) return <div className="landing-guide-visual circuit-visual" role="img" aria-label="魔方落入接口并激活电路地面">
    <div className="circuit-floor" aria-hidden="true">
      <span className="circuit-hole" />
      {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
      {Array.from({ length: 7 }, (_, index) => <b key={index} />)}
    </div>
    <div className="cube-seat"><MagicCube compact /></div>
    <div className="activation-wave" aria-hidden="true" />
    <span className="visual-status">STRUCTURE ONLINE</span>
  </div>;

  if (step === 2) return <div className="landing-guide-visual morph-visual" role="img" aria-label="魔方平滑转变为可编辑的数据球">
    <div className="morph-source"><MagicCube compact /></div>
    <div className="data-orb" aria-hidden="true">
      {Array.from({ length: 16 }, (_, index) => <span key={index} />)}
    </div>
    <div className="orb-ring ring-one" aria-hidden="true" />
    <div className="orb-ring ring-two" aria-hidden="true" />
    <span className="visual-status">ELEMENTS UNLOCKED</span>
  </div>;

  return <div className="landing-guide-visual upload-visual" role="img" aria-label="等待上传文件的 Jsonable 魔方">
    <MagicCube compact />
    <span className="visual-status">READY FOR INPUT</span>
  </div>;
}

function VisualPreview({ data, colors, shapes, images, isDefault }: { data: unknown; colors: ColorInfo[]; shapes: ShapeInfo[]; images: ImageInfo[]; isDefault: boolean }) {
  if (isDefault) return <div className="token-stage default-cube-stage"><MagicCube /></div>;
  const items = shapes.flatMap((shape) => Array.from({ length: Math.min(shape.count, 6) }, () => shape)).slice(0, 24);
  if (isLottie(data)) return <LottiePreview data={data} />;
  const object = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const canvas = object.canvas && typeof object.canvas === "object" ? object.canvas as Record<string, unknown> : {};
  const canvasBackground = typeof canvas.background === "string" ? parseCssColor(canvas.background) : null;
  return <div className="token-stage" style={{ background: canvasBackground || "#101513" }}>
    {images.slice(0, 8).map((item) => <div className="preview-image" key={item.id}><ImageThumb source={item.preview} label={item.name} /><small>{item.name}</small></div>)}
    {items.map((item, index) => <div className="preview-object" key={`${item.name}-${index}`} style={{ color: colors[index % Math.max(colors.length, 1)]?.hex || "#48C5A1" }}><ComposedMark /><small>{item.name}</small></div>)}
    {!items.length && !images.length && colors.map((color) => <div className="preview-color" key={color.hex} style={{ background: color.hex }}><span>{color.hex}</span></div>)}
    {!items.length && !images.length && !colors.length && <div className="preview-message">暂未找到可视化元素<br /><small>支持颜色、命名组合、Lottie 与常见图片字段</small></div>}
  </div>;
}

export default function Home() {
  const [data, setData] = useState<unknown>(SAMPLE);
  const [originalData, setOriginalData] = useState<unknown>(SAMPLE);
  const [versions, setVersions] = useState<EditVersion[]>([]);
  const [versionIndex, setVersionIndex] = useState(-1);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(0);
  const [hasUploadedFile, setHasUploadedFile] = useState(false);
  const [fileName, setFileName] = useState("summer-campaign.json");
  const [activeTab, setActiveTab] = useState<"colors" | "shapes" | "images">("colors");
  const [inspectorTab, setInspectorTab] = useState<"preview" | "json">("preview");
  const [selectedShape, setSelectedShape] = useState("");
  const [selectedImage, setSelectedImage] = useState("");
  const [uploadedSvg, setUploadedSvg] = useState<UploadedSvg | null>(null);
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);
  const [replacementError, setReplacementError] = useState("");
  const [imageError, setImageError] = useState("");
  const [colorEditor, setColorEditor] = useState<{ current: string; draft: string; count: number } | null>(null);
  const [shapeEditorOpen, setShapeEditorOpen] = useState(false);
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const [compressionCountdown, setCompressionCountdown] = useState<number | null>(null);
  const [compressionResult, setCompressionResult] = useState<CompressionResults | null>(null);
  const [compressionReportOpen, setCompressionReportOpen] = useState(false);
  const [mediaConverting, setMediaConverting] = useState(false);
  const [mediaConversion, setMediaConversion] = useState<MediaConversionResult | null>(null);
  const [mediaConversionError, setMediaConversionError] = useState("");
  const [isDraggingJson, setIsDraggingJson] = useState(false);
  const [isDraggingLanding, setIsDraggingLanding] = useState(false);
  const [landingStep, setLandingStep] = useState(0);
  const [landingCycle, setLandingCycle] = useState(0);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const replacementFileRef = useRef<HTMLInputElement>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const unifiedFileRef = useRef<HTMLInputElement>(null);
  const versionsRef = useRef<EditVersion[]>([]);
  const versionIndexRef = useRef(-1);
  const colors = useMemo(() => scanColors(data), [data]);
  const shapes = useMemo(() => scanShapes(data), [data]);
  const images = useMemo(() => scanImages(data), [data]);
  const jsonText = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const selectedVersionIndex = versions.findIndex((version) => version.id === selectedVersionId);
  const selectedVersion = selectedVersionIndex >= 0 ? versions[selectedVersionIndex] : versions[versionIndex];
  const selectedDiff = useMemo(() => {
    const index = versions.findIndex((version) => version.id === selectedVersion?.id); if (index <= 0) return [];
    return diffJson(versions[index - 1].data, versions[index].data);
  }, [versions, selectedVersion?.id]);
  useEffect(() => {
    readLocalDraft().then((draft) => {
      if (!draft || draft.version !== 1) return;
      const initial = createVersion("原始文件", draft.originalData); const restored = JSON.stringify(draft.originalData) === JSON.stringify(draft.data) ? [initial] : [initial, createVersion("自动恢复的最近编辑状态", draft.data)];
      versionsRef.current = restored; versionIndexRef.current = restored.length - 1; setVersions(restored); setVersionIndex(restored.length - 1); setSelectedVersionId(restored.at(-1)?.id || ""); setOriginalData(clone(draft.originalData)); setData(clone(draft.data)); setFileName(draft.fileName); setHasUploadedFile(true); setLastSavedAt(draft.savedAt); setToast("已恢复上次自动保存的编辑状态");
    }).catch(() => { /* Private browsing may disable IndexedDB. */ }).finally(() => setDraftHydrated(true));
  }, []);
  useEffect(() => {
    if (!draftHydrated || !hasUploadedFile || versionIndex < 0) return;
    const timer = window.setTimeout(() => {
      const savedAt = Date.now(); saveLocalDraft({ version: 1, fileName, originalData: clone(originalData), data: clone(data), savedAt }).then(() => setLastSavedAt(savedAt)).catch(() => { /* Editing remains available when local persistence is unavailable. */ });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [data, draftHydrated, fileName, hasUploadedFile, originalData, versionIndex]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (hasUploadedFile) return;
    const timer = window.setTimeout(() => {
      setLandingStep((current) => (current + 1) % LANDING_STEPS.length);
      setLandingCycle((current) => current + 1);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [hasUploadedFile, landingStep, landingCycle]);
  useEffect(() => { setCompressionCountdown(null); setCompressionResult(null); setCompressionReportOpen(false); }, [data]);
  useEffect(() => {
    if (compressionCountdown === null) return;
    if (compressionCountdown > 0) {
      const timer = window.setTimeout(() => setCompressionCountdown((current) => current === null ? null : current - 1), 1000);
      return () => window.clearTimeout(timer);
    }
    const originalSize = new Blob([jsonText]).size; const normalText = JSON.stringify(data); const normalSize = new Blob([normalText]).size; const normalPercentage = originalSize ? Math.max(0, (1 - normalSize / originalSize) * 100) : 0;
    const normal: CompressionResult = { text: normalText, originalSize, compressedSize: normalSize, percentage: normalPercentage, optimizations: [{ key: "whitespace", title: "移除格式空白", description: "仅删除缩进、换行与多余空格，不改变任何字段、数值或资源结构。", count: 1, examples: [`整份文件 · 减少 ${formatBytes(Math.max(0, originalSize - normalSize))}`] }] };
    const optimized = optimizeJson(data, jsonText); const advancedSize = new Blob([optimized.text]).size; const advancedPercentage = originalSize ? Math.max(0, (1 - advancedSize / originalSize) * 100) : 0;
    const advanced: CompressionResult = { text: optimized.text, originalSize, compressedSize: advancedSize, percentage: advancedPercentage, optimizations: optimized.optimizations };
    setCompressionResult({ normal, advanced }); setCompressionCountdown(null); setCompressionReportOpen(true);
    setToast(`一键压缩完成：已生成普通版和高级版`);
  }, [compressionCountdown, data, jsonText]);
  useEffect(() => {
    if (!colorEditor && !shapeEditorOpen && !imageEditorOpen && !historyOpen && !compressionReportOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setColorEditor(null); setShapeEditorOpen(false); setImageEditorOpen(false); setHistoryOpen(false); setCompressionReportOpen(false);
    };
    document.body.style.overflow = "hidden"; window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [colorEditor, shapeEditorOpen, imageEditorOpen, historyOpen, compressionReportOpen]);
  const activeShape = shapes.find((item) => `${item.mode}:${item.name}` === selectedShape) || shapes[0];
  const activeImage = images.find((item) => item.id === selectedImage) || images[0];
  const tabMeta = activeTab === "colors"
    ? { title: "颜色", english: "COLORS", description: `识别到 ${colors.length} 种颜色，编辑窗口会保持开启。` }
    : activeTab === "shapes"
      ? { title: "组合形状", english: "GROUPS", description: "选择主文件中的组合，再上传 SVG 作为新的矢量结构。" }
      : { title: "图片资源", english: "IMAGES", description: `识别到 ${images.length} 个图片资源，替换后保留原图层布局与动画。` };

  const setHistoryState = (nextVersions: EditVersion[], nextIndex: number) => {
    versionsRef.current = nextVersions; versionIndexRef.current = nextIndex; setVersions(nextVersions); setVersionIndex(nextIndex); setSelectedVersionId(nextVersions[nextIndex]?.id || "");
  };
  const beginDocument = (nextData: unknown) => {
    const initial = createVersion("原始文件", nextData); setOriginalData(clone(nextData)); setData(clone(nextData)); setHistoryState([initial], 0);
  };
  const commitEdit = (nextData: unknown, label: string) => {
    if (JSON.stringify(nextData) === JSON.stringify(data)) { setToast("内容没有发生变化"); return false; }
    const base = versionsRef.current.slice(0, versionIndexRef.current + 1); let nextVersions = [...base, createVersion(label, nextData)];
    if (nextVersions.length > 30) nextVersions = [nextVersions[0], ...nextVersions.slice(-29)];
    setData(clone(nextData)); setHistoryState(nextVersions, nextVersions.length - 1); return true;
  };
  const applyHistoryIndex = (nextIndex: number, action: "undo" | "redo") => {
    const nextVersion = versionsRef.current[nextIndex]; if (!nextVersion) return;
    versionIndexRef.current = nextIndex; setVersionIndex(nextIndex); setSelectedVersionId(nextVersion.id); setData(clone(nextVersion.data)); setInspectorTab("preview"); setToast(`${action === "undo" ? "已撤销" : "已重做"}：${nextVersion.label}`);
  };
  const undoEdit = () => applyHistoryIndex(versionIndexRef.current - 1, "undo");
  const redoEdit = () => applyHistoryIndex(versionIndexRef.current + 1, "redo");
  const restoreOriginal = () => { if (commitEdit(clone(originalData), "恢复原始文件")) { setInspectorTab("preview"); setToast("已恢复原始文件，可继续撤销"); } };
  const openHistory = () => { setSelectedVersionId(versionsRef.current[versionIndexRef.current]?.id || ""); setHistoryOpen(true); };
  const restoreSelectedVersion = () => {
    if (!selectedVersion) return; const label = selectedVersion.label;
    if (commitEdit(clone(selectedVersion.data), `恢复版本：${label}`)) { setInspectorTab("preview"); setHistoryOpen(false); setToast(`已恢复到「${label}」`); }
  };
  useEffect(() => {
    if (!hasUploadedFile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null; if (target?.closest("input,textarea,[contenteditable='true']")) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redoEdit(); else undoEdit(); }
      else if (event.key.toLowerCase() === "y") { event.preventDefault(); redoEdit(); }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  });

  const loadJsonFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()); beginDocument(parsed); setHasUploadedFile(true); setFileName(file.name); setError(""); setMediaConversion(null); setMediaConversionError(""); setSelectedShape(""); setSelectedImage(""); setUploadedSvg(null); setUploadedImage(null); setShapeEditorOpen(false); setImageEditorOpen(false); setInspectorTab("preview");
      const foundColors = scanColors(parsed).length; const foundShapes = scanShapes(parsed).length; const foundImages = scanImages(parsed).length;
      setToast(`识别完成：${foundColors} 种颜色，${foundShapes} 种形状，${foundImages} 个图片资源`);
    } catch { setError("无法解析这个文件，请检查 JSON 格式后重试。"); }
  };
  const dropJson = async (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault(); setIsDraggingJson(false); const file = event.dataTransfer.files?.[0]; if (!file) return;
    if (!/\.json$/i.test(file.name) && file.type !== "application/json") { setError("请拖入 JSON 文件，其他格式请使用“上传非json文件”。"); return; }
    await loadJsonFile(file);
  };

  const convertMediaList = async (selected: File[]) => {
    if (!selected.length) return;
    const files = selected.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    const allowed = files.every((file) => /^(video\/mp4|image\/(gif|apng|png|jpeg|webp))$/i.test(file.type) || /\.(mp4|gif|apng|png|jpe?g|webp)$/i.test(file.name));
    if (!allowed) { setMediaConversionError("请选择 MP4、GIF、APNG、PNG、JPG 或 WebP 文件。"); return; }
    setMediaConverting(true); setMediaConversion(null); setMediaConversionError("");
    try {
      const extension = files[0].name.split(".").pop()?.toLowerCase(); const kind = files.length > 1 ? "sequence-frames" : extension === "mp4" ? "mp4" : extension === "gif" ? "gif" : extension === "apng" || files[0].type === "image/apng" ? "apng" : "image";
      const frames = files.length > 1 ? await Promise.all(files.slice(0, 96).map(decodeStill)) : kind === "mp4" ? await decodeVideo(files[0]) : kind === "gif" || kind === "apng" ? await decodeAnimatedImage(files[0]) : [await decodeStill(files[0])];
      const lottie = framesToLottie(frames); const text = JSON.stringify(lottie); const jsonSize = new Blob([text]).size; const originalSize = files.reduce((sum, file) => sum + file.size, 0); const payloadSize = frames.reduce((sum, frame) => sum + Math.ceil(frame.dataUrl.length * .75), 0); const percentage = originalSize ? Math.max(0, (1 - Math.min(payloadSize, originalSize) / originalSize) * 100) : 0;
      const baseName = files.length > 1 ? "sequence-frames" : files[0].name.replace(/\.[^.]+$/, "");
      const outputName = `${baseName}-lottie.json`;
      setMediaConversion({ text, kind, fileCount: frames.length, originalSize, payloadSize, jsonSize, percentage, outputName });
      beginDocument(lottie); setHasUploadedFile(true); setFileName(outputName); setInspectorTab("preview"); setError("");
      setToast(`转换完成：已生成 ${frames.length} 帧可播放 Lottie JSON`);
    } catch { setMediaConversionError("转换失败：请确认浏览器支持该媒体编码，或缩短视频、减少序列帧后重试。"); }
    finally { setMediaConverting(false); }
  };
  const unifiedUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files || [])]; event.target.value = ""; if (!selected.length) return;
    if (selected.length === 1 && (/\.json$/i.test(selected[0].name) || selected[0].type === "application/json")) await loadJsonFile(selected[0]);
    else await convertMediaList(selected);
  };
  const dropUnified = async (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault(); setIsDraggingLanding(false); const selected = [...(event.dataTransfer.files || [])]; if (!selected.length) return;
    if (selected.length === 1 && (/\.json$/i.test(selected[0].name) || selected[0].type === "application/json")) await loadJsonFile(selected[0]);
    else await convertMediaList(selected);
  };

  const loadReplacementFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const raw = await file.text(); const name = file.name.replace(/\.svg$/i, "") || "uploaded-shape";
      const group = await svgToLottieGroup(raw, name); const partCount = Array.isArray(group.it) ? Math.max(0, group.it.length - 1) : 0;
      setUploadedSvg({ fileName: file.name, name, preview: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}`, raw, group, partCount }); setReplacementError("");
      setToast(`SVG 已转换：${partCount} 个矢量部分`);
    } catch (reason) {
      const message = reason instanceof Error && reason.message === "NO_GEOMETRY" ? "SVG 中没有找到可转换的路径或基础图形。" : "无法读取这个 SVG，请确认文件内容完整后重试。";
      setReplacementError(message);
    }
    finally { event.target.value = ""; }
  };

  const changeColor = (to: string) => {
    if (!colorEditor || !/^#[0-9A-F]{6}$/i.test(to)) return;
    const next = to.toUpperCase(); const from = colorEditor.current;
    if (commitEdit(replaceColor(data, from, next), `替换颜色 ${from} → ${next}`)) { setColorEditor({ ...colorEditor, current: next, draft: next }); setInspectorTab("preview"); setToast(`已替换 ${from} 的全部引用`); }
  };
  const loadImageReplacement = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) throw new Error("UNSUPPORTED_IMAGE");
      const loaded = await readImageFile(file); setUploadedImage(loaded); setImageError(""); setToast(`图片已读取：${loaded.width} × ${loaded.height}`);
    } catch { setImageError("无法读取图片，请上传 PNG、JPG、WebP 或 GIF 文件。"); }
    finally { event.target.value = ""; }
  };
  const changeImage = (target: ImageInfo) => {
    if (!uploadedImage) return;
    if (commitEdit(replaceImageResource(data, target, uploadedImage.dataUrl), `替换图片「${target.name}」`)) { setInspectorTab("preview"); setImageError(""); setToast(`已替换 ${target.count} 个「${target.name}」图片引用`); }
  };
  const changeShapeFromUpload = (from: ShapeInfo) => {
    if (!uploadedSvg) return;
    if (from.mode === "reference") { setReplacementError("当前目标只是外部引用，无法写入 SVG 路径。请选择组合、组件或 Lottie 图层。"); return; }
    const group = clone(uploadedSvg.group); group.nm = from.name; group.__jsonableSvg = true;
    const template = from.mode === "lottie-group" ? group : from.mode === "lottie-layer"
      ? { ty: 4, nm: from.name, shapes: [group], ks: {}, ip: 0, op: 1, st: 0, __jsonableSvg: true }
      : { name: from.name, componentName: from.name, type: "svg", svg: uploadedSvg.raw, items: [group], __jsonableSvg: true };
    if (commitEdit(replaceShape(data, from, from.name, template), `替换形状「${from.name}」`)) { setInspectorTab("preview"); setReplacementError(""); setToast(`已使用 ${uploadedSvg.fileName} 替换 ${from.count} 个「${from.name}」`); }
  };
  const download = () => { const blob = new Blob([jsonText], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = fileName.replace(/\.json$/i, "") + "-edited.json"; a.click(); URL.revokeObjectURL(url); setToast("修改后的 JSON 已下载"); };
  const downloadCompressed = (mode: "normal" | "advanced") => {
    const result = compressionResult?.[mode]; if (!result) return;
    const blob = new Blob([result.text], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = fileName.replace(/\.json$/i, "") + (mode === "advanced" ? "-optimized-pro.json" : "-minified.json"); a.click(); URL.revokeObjectURL(url); setToast(mode === "advanced" ? "高级压缩结果已下载" : "普通压缩结果已下载");
  };
  const downloadDotLottie = () => {
    const result = compressionResult?.advanced;
    if (!result || !isLottie(data)) return;
    const baseName = fileName.replace(/\.[^.]+$/, "") || "animation";
    const animationId = baseName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "animation";
    const manifest = {
      version: "2",
      generator: "Jsonable",
      initial: { animation: animationId },
      animations: [{ id: animationId }],
    };
    const archive = zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest)),
      [`a/${animationId}.json`]: strToU8(result.text),
    }, { level: 9 });
    const archiveBuffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
    const blob = new Blob([archiveBuffer], { type: "application/zip+dotlottie" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `${baseName}-optimized.lottie`; a.click(); URL.revokeObjectURL(url); setToast("dotLottie 文件已导出");
  };
  const goHome = () => {
    setData(SAMPLE); setOriginalData(SAMPLE); setHasUploadedFile(false); setFileName("summer-campaign.json"); setActiveTab("colors"); setInspectorTab("preview"); setSelectedShape(""); setSelectedImage(""); setUploadedSvg(null); setUploadedImage(null); setColorEditor(null); setShapeEditorOpen(false); setImageEditorOpen(false); setHistoryOpen(false); setCompressionReportOpen(false); setCompressionCountdown(null); setCompressionResult(null); setMediaConversion(null); setMediaConversionError(""); setError(""); setLandingStep(0); setLandingCycle((current) => current + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return <main>
    <header className="topbar">
      <button className="brand" type="button" onClick={goHome} aria-label="返回 Jsonable 首页"><CubeLogo /><span>Jsonable</span></button>
      <div className="top-actions"><span className="privacy"><span className="privacy-dot" />文件仅在本地处理</span>
        <button className="button button-ghost action-button" onClick={() => unifiedFileRef.current?.click()} disabled={mediaConverting}><ActionIcon name="upload" /><span>{mediaConverting ? "正在转换" : hasUploadedFile ? "更换文件" : "上传文件"}</span></button>
        <button className="button button-ghost action-button" disabled={!hasUploadedFile || compressionCountdown !== null} title={!hasUploadedFile ? "上传 JSON 后可使用一键压缩" : undefined} onClick={() => { setCompressionResult(null); setCompressionReportOpen(false); setCompressionCountdown(3); }}><ActionIcon name="compress" /><span>{compressionCountdown !== null ? `压缩中 ${compressionCountdown}` : "一键压缩"}</span></button>
        <button className="button button-dark action-button" onClick={download} disabled={!hasUploadedFile} title={!hasUploadedFile ? "上传文件后可下载 JSON" : undefined}><span>{mediaConversion ? "下载转换 JSON" : "下载 JSON"}</span><ActionIcon name="download" /></button>
      </div>
    </header>
    <input ref={unifiedFileRef} type="file" accept="application/json,.json,video/mp4,image/gif,image/apng,image/png,image/jpeg,image/webp,.apng" multiple onChange={unifiedUpload} hidden />
    {!hasUploadedFile ? <section className={isDraggingLanding ? "landing-hero is-dragging" : "landing-hero"} onDragEnter={(event) => { event.preventDefault(); setIsDraggingLanding(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDraggingLanding(false); }} onDrop={dropUnified}>
      <div className="landing-copy"><span className="eyebrow">VISUAL JSON EDITOR</span><h1>先把文件放进来，<br /><em>再把每一层看清。</em></h1><p>JSON、MP4、GIF、APNG 与序列帧都可以。媒体文件会先转换成可播放、可编辑的 Lottie JSON。</p><div className="landing-steps" role="tablist" aria-label="Jsonable 使用流程">{LANDING_STEPS.map((item, index) => <button key={`${item.number}-${index === landingStep ? landingCycle : "idle"}`} type="button" role="tab" aria-selected={index === landingStep} className={index === landingStep ? "active" : ""} onClick={() => { setLandingStep(index); setLandingCycle((current) => current + 1); }}><span>{item.number}</span>{item.label}</button>)}</div></div>
      <div className={`landing-upload guide-step-${landingStep}`}><LandingGuideVisual key={`${landingStep}-${landingCycle}`} step={landingStep} /><button onClick={() => unifiedFileRef.current?.click()} disabled={mediaConverting}>{mediaConverting ? "正在转换媒体..." : "选择文件"}<span>＋</span></button><strong>或把文件拖到这里</strong><small>支持单个 JSON / 视频 / 动图，也支持多选序列帧</small>{mediaConversionError && <em>{mediaConversionError}</em>}{isDraggingLanding && <div className="landing-drop-state">松开开始处理</div>}</div>
    </section> : <section className="editor-context"><div className="file-summary"><span className="eyebrow">NOW EDITING</span><strong>{fileName}</strong><small>{isLottie(data) ? "可播放 Lottie" : "JSON 视觉结构"} · {formatBytes(new Blob([jsonText]).size)} · {lastSavedAt ? "已自动保存" : "等待自动保存"}</small></div><div className="history-actions"><button onClick={undoEdit} disabled={versionIndex <= 0} title="撤销（⌘/Ctrl + Z）">撤销</button><button onClick={redoEdit} disabled={versionIndex < 0 || versionIndex >= versions.length - 1} title="重做（⌘/Ctrl + Shift + Z）">重做</button><button onClick={restoreOriginal} disabled={versionIndex === 0}>恢复原始</button><button className="history-button" onClick={openHistory}>修改记录 <b>{Math.max(0, versions.length - 1)}</b></button>{compressionResult && <button className="history-button optimization-report-button" onClick={() => setCompressionReportOpen(true)}>压缩结果 <b>2</b></button>}</div></section>}
    {error && <div className="error" role="alert">{error}</div>}
    {hasUploadedFile && <section className="workspace">
      <aside className="rail"><div className="rail-title">已识别</div><button className={activeTab === "colors" ? "rail-item active" : "rail-item"} onClick={() => setActiveTab("colors")}><span className="rail-icon">◒</span><span>颜色<small>Colors</small></span><b>{colors.length}</b></button><button className={activeTab === "shapes" ? "rail-item active" : "rail-item"} onClick={() => setActiveTab("shapes")}><span className="rail-icon">◇</span><span>组合形状<small>Groups</small></span><b>{shapes.length}</b></button><button className={activeTab === "images" ? "rail-item active" : "rail-item"} onClick={() => setActiveTab("images")}><span className="rail-icon">▧</span><span>图片资源<small>Images</small></span><b>{images.length}</b></button><div className="rail-note"><span>↗</span><p>支持颜色、组合矢量和图片资源的本地批量替换。</p></div></aside>
      <section className="editor-panel"><div className="resource-tabs" role="tablist" aria-label="可替换资源"><button role="tab" aria-selected={activeTab === "colors"} className={activeTab === "colors" ? "active" : ""} onClick={() => setActiveTab("colors")}><span>颜色</span><small>COLORS</small><b>{colors.length}</b></button><button role="tab" aria-selected={activeTab === "shapes"} className={activeTab === "shapes" ? "active" : ""} onClick={() => setActiveTab("shapes")}><span>组合形状</span><small>GROUPS</small><b>{shapes.length}</b></button><button role="tab" aria-selected={activeTab === "images"} className={activeTab === "images" ? "active" : ""} onClick={() => setActiveTab("images")}><span>图片资源</span><small>IMAGES</small><b>{images.length}</b></button></div><div className="section-head"><div><h2>{tabMeta.title}</h2><span className="en">{tabMeta.english}</span></div><p>{tabMeta.description}</p></div>
        {activeTab === "colors" ? <div className="color-grid">{colors.map((color, index) => <article className="color-card" key={color.hex}><div className="swatch" style={{ background: color.hex }}><span>{String(index + 1).padStart(2, "0")}</span></div><div className="color-meta"><label>识别结果</label><strong>{color.hex}</strong><small>{color.label} · {color.count} 个引用</small></div><button className="picker-button" onClick={() => setColorEditor({ current: color.hex, draft: color.hex, count: color.count })}><span className="picker-chip" style={{ background: color.hex }} />选择颜色</button></article>)}{!colors.length && <Empty text="暂未识别到颜色；可切到 JSON 查看原始字段" />}</div> : activeTab === "shapes" ?
        <div className="shape-workbench"><div className="shape-list">{shapes.map((shape) => { const id = `${shape.mode}:${shape.name}`; return <button key={id} className={activeShape && `${activeShape.mode}:${activeShape.name}` === id ? "shape-row selected" : "shape-row"} onClick={() => { setSelectedShape(id); setUploadedSvg(null); setReplacementError(""); setShapeEditorOpen(true); }}><ShapeThumb data={data} shape={shape} /><span><strong>{shape.name}</strong><small>{shape.mode.replace("lottie-", "Lottie ")}</small></span><b>× {shape.count}</b></button>; })}{!shapes.length && <Empty text="暂未识别到命名组合；基础圆形、矩形和路径已自动忽略" />}</div></div> :
        <div className="image-workbench"><div className="image-list">{images.map((item) => <button key={item.id} className={activeImage?.id === item.id ? "image-row selected" : "image-row"} onClick={() => { setSelectedImage(item.id); setUploadedImage(null); setImageError(""); setImageEditorOpen(true); }}><span className="image-thumb"><ImageThumb source={item.preview} label={item.name} /></span><span><strong>{item.name}</strong><small>{item.mode === "lottie-asset" ? "Lottie 图片资源" : item.key}</small></span><b>× {item.count}</b></button>)}{!images.length && <Empty text="暂未识别到图片资源；支持 Lottie assets 和常见图片地址字段" />}</div></div>}
      </section>
      <aside className="json-panel">
        <div className="panel-tabs"><button className={inspectorTab === "preview" ? "active" : ""} onClick={() => setInspectorTab("preview")}><span className="status-dot" />视觉预览</button><button className={inspectorTab === "json" ? "active" : ""} onClick={() => setInspectorTab("json")}>实时 JSON</button></div>
        {inspectorTab === "preview" ? <div className={isDraggingJson ? "preview-panel is-dragging" : "preview-panel"} onDragEnter={(event) => { event.preventDefault(); setIsDraggingJson(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDraggingJson(false); }} onDrop={dropJson}>
          <div className="preview-head"><span>{!hasUploadedFile ? "JSONABLE CUBE" : isLottie(data) ? "LOTTIE LIVE" : "AUTO LAYOUT"}</span><b>{colors.length} COLORS · {shapes.length} SHAPES · {images.length} IMAGES</b></div>
          <VisualPreview data={data} colors={colors} shapes={shapes} images={images} isDefault={!hasUploadedFile} />
          <div className="preview-foot">{hasUploadedFile ? "修改颜色、形状或图片后自动刷新 · 也可拖入新的 JSON" : "拖入 JSON 到预览框，或使用顶部上传按钮"}</div>
          {isDraggingJson && <div className="drop-overlay"><span>↓</span><strong>松开即可载入 JSON</strong><small>文件只在本地浏览器中处理</small></div>}
        </div> : <><div className="json-head"><div><span className="status-dot" /> 已同步</div><button onClick={() => navigator.clipboard.writeText(jsonText).then(() => setToast("JSON 已复制"))}>复制</button></div><pre>{jsonText.split("\n").map((line, i) => <code key={i}><span>{String(i + 1).padStart(2, "0")}</span>{line}</code>)}</pre><div className="json-foot"><span>{jsonText.split("\n").length} 行</span><span>UTF-8</span></div></>}
      </aside>
    </section>}
    {compressionReportOpen && compressionResult && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label="一键压缩结果"><div className="color-dialog compression-dialog comparison"><header><div><span className="eyebrow">ONE-CLICK COMPRESSION</span><h3>两种压缩结果</h3></div><button onClick={() => setCompressionReportOpen(false)} aria-label="关闭压缩结果">×</button></header><div className="compression-result-windows"><CompressionResultWindow mode="normal" result={compressionResult.normal} onDownload={() => downloadCompressed("normal")} /><CompressionResultWindow mode="advanced" result={compressionResult.advanced} onDownload={() => downloadCompressed("advanced")} onDotLottie={isLottie(data) ? downloadDotLottie : undefined} /></div><footer className="compression-footer compression-footer-note"><span>普通压缩不改变任何字段；高级压缩采用保真优先的结构优化策略。Lottie 文件可直接导出标准 dotLottie。</span></footer></div></div>}
    {historyOpen && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label="修改记录"><div className="color-dialog history-dialog"><header><div><span className="eyebrow">VERSION HISTORY</span><h3>修改记录</h3></div><button onClick={() => setHistoryOpen(false)} aria-label="关闭修改记录">×</button></header><div className="history-dialog-body"><aside className="version-list">{versions.map((version, index) => ({ version, index })).reverse().map(({ version, index }) => <button key={version.id} className={selectedVersion?.id === version.id ? "active" : ""} onClick={() => setSelectedVersionId(version.id)}><span><strong>{version.label}</strong><small>{new Date(version.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small></span><b>{index === versionIndex ? "当前" : String(index).padStart(2, "0")}</b></button>)}</aside><section className="history-diff"><div className="history-diff-head"><div><span>版本差异</span><strong>{selectedVersion?.label || "请选择一个版本"}</strong></div><button onClick={restoreSelectedVersion} disabled={!selectedVersion || selectedVersion.id === versions[versionIndex]?.id}>恢复到此版本</button></div>{selectedVersionIndex <= 0 ? <div className="history-empty"><strong>这是原始文件</strong><p>后续的颜色、形状与图片修改都会记录在这里。</p></div> : selectedDiff.length ? <div className="diff-list">{selectedDiff.map((item, index) => <article key={`${item.path}-${index}`}><code>{item.path}</code><div><span><small>修改前</small>{item.before}</span><span><small>修改后</small>{item.after}</span></div></article>)}{selectedDiff.length >= 80 && <p className="diff-limit">仅展示前 80 处变化</p>}</div> : <div className="history-empty"><strong>没有检测到字段变化</strong><p>这个版本与前一个版本内容一致。</p></div>}</section></div><footer><span>最近状态会自动保存在当前浏览器，不会上传服务器</span><button onClick={() => setHistoryOpen(false)}>关闭</button></footer></div></div>}
    {colorEditor && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label="颜色编辑器"><div className="color-dialog"><header><div><span className="eyebrow">COLOR EDITOR</span><h3>替换颜色</h3></div><button onClick={() => setColorEditor(null)} aria-label="关闭颜色编辑器">×</button></header><div className="color-dialog-main"><label className="large-picker" style={{ background: colorEditor.current }}><input type="color" value={colorEditor.current} onChange={(event) => changeColor(event.target.value)} /><span>点击选择色彩</span></label><div className="color-values"><label>HEX 色值</label><div><input value={colorEditor.draft} onChange={(event) => setColorEditor({ ...colorEditor, draft: event.target.value.toUpperCase() })} /><button onClick={() => changeColor(colorEditor.draft)}>应用</button></div><small>将同步修改 {colorEditor.count} 个引用，窗口不会自动关闭。</small></div></div><div className="quick-colors">{["#101513", "#E8F0ED", "#48C5A1", "#2A6F5C", "#E66E58", "#5E8DA0"].map((hex) => <button key={hex} style={{ background: hex }} onClick={() => changeColor(hex)} aria-label={`选择 ${hex}`} />)}</div><footer><span>修改已实时写入预览和 JSON</span><button onClick={() => setColorEditor(null)}>关闭</button></footer></div></div>}
    {shapeEditorOpen && activeShape && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label={`替换形状 ${activeShape.name}`}><div className="color-dialog asset-dialog"><header><div><span className="eyebrow">SVG REPLACEMENT</span><h3>替换「{activeShape.name}」</h3></div><button onClick={() => setShapeEditorOpen(false)} aria-label="关闭形状替换窗口">×</button></header><div className="asset-dialog-body"><div className="replace-card"><div className="composed-current"><ShapeThumb data={data} shape={activeShape} /><span><small>主文件中的目标</small><strong>{activeShape.name}</strong></span><b>{activeShape.count} 个实例</b></div><button className="replacement-upload" onClick={() => replacementFileRef.current?.click()}>{uploadedSvg ? <img className="replacement-svg-preview" src={uploadedSvg.preview} alt="上传的 SVG 预览" /> : <span className="replacement-upload-icon">＋</span>}<span><small>{uploadedSvg ? "已转换为矢量路径" : "上传替换形状"}</small><strong>{uploadedSvg?.fileName || "选择 SVG 文件"}</strong></span><b>{uploadedSvg ? "重新上传" : "选择文件"}</b></button><input ref={replacementFileRef} type="file" accept="image/svg+xml,.svg" onChange={loadReplacementFile} hidden />{replacementError && <div className="replacement-error" role="alert">{replacementError}</div>}{uploadedSvg && <><div className="replacement-summary"><span>已转换的矢量部分</span><b>{uploadedSvg.partCount}</b></div><button className="apply-replacement" onClick={() => changeShapeFromUpload(activeShape)} disabled={activeShape.mode === "reference"}>使用这个 SVG 替换全部同名形状</button>{activeShape.mode === "reference" && <div className="replacement-empty">当前目标是外部引用，不能直接写入 SVG 路径。</div>}</>}<p>SVG 会转换为 JSON 内的矢量路径，同时保留同名实例的位置、缩放和动画变换。</p></div></div><footer><span>文件仅在本地浏览器中处理</span><button onClick={() => setShapeEditorOpen(false)}>关闭</button></footer></div></div>}
    {imageEditorOpen && activeImage && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label={`替换图片 ${activeImage.name}`}><div className="color-dialog asset-dialog"><header><div><span className="eyebrow">IMAGE REPLACEMENT</span><h3>替换「{activeImage.name}」</h3></div><button onClick={() => setImageEditorOpen(false)} aria-label="关闭图片替换窗口">×</button></header><div className="asset-dialog-body"><div className="replace-card image-replace-card"><div className="current-image"><span className="current-image-preview"><ImageThumb source={activeImage.preview} label={activeImage.name} /></span><span><small>当前资源</small><strong>{activeImage.name}</strong><em>{activeImage.count} 个引用</em></span></div><button className="replacement-upload image-upload" onClick={() => imageFileRef.current?.click()}>{uploadedImage ? <img className="replacement-svg-preview" src={uploadedImage.dataUrl} alt="新图片预览" /> : <span className="replacement-upload-icon">＋</span>}<span><small>{uploadedImage ? `${uploadedImage.width} × ${uploadedImage.height}` : "上传新图片"}</small><strong>{uploadedImage?.fileName || "选择 PNG、JPG、WebP 或 GIF"}</strong></span><b>{uploadedImage ? "重新上传" : "选择文件"}</b></button><input ref={imageFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={loadImageReplacement} hidden />{imageError && <div className="replacement-error" role="alert">{imageError}</div>}{uploadedImage && <button className="apply-replacement" onClick={() => changeImage(activeImage)}>使用这张图片替换全部引用</button>}<p>新图片会内嵌写入 JSON，原图层的位置、尺寸、透明度和动画保持不变。</p></div></div><footer><span>文件不会上传到服务器</span><button onClick={() => setImageEditorOpen(false)}>关闭</button></footer></div></div>}
    {toast && <div className="toast" aria-live="polite"><span>✓</span>{toast}</div>}
  </main>;
}

function Empty({ text }: { text: string }) { return <div className="empty"><span>◎</span><p>{text}</p></div>; }
