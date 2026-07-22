"use client";

import { ChangeEvent, DragEvent as ReactDragEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AnimationItem } from "lottie-web";

type ShapeName = "circle" | "square" | "triangle" | "star" | "heart" | "hexagon" | "path";
type ColorInfo = { hex: string; label: string; count: number };
type ShapeInfo = { name: string; count: number; mode: "lottie-group" | "lottie-layer" | "component" | "reference" };
type UploadedSvg = { fileName: string; name: string; preview: string; raw: string; group: Record<string, unknown>; partCount: number };
type ImageInfo = { id: string; name: string; value: string; preview: string; count: number; mode: "lottie-asset" | "field"; assetId?: string; key?: string };
type UploadedImage = { fileName: string; dataUrl: string; width: number; height: number; size: number };
type CompressionResult = { text: string; originalSize: number; compressedSize: number; percentage: number };
type MediaConversionResult = { text: string; kind: string; fileCount: number; originalSize: number; payloadSize: number; jsonSize: number; percentage: number; outputName: string };
type MediaFrame = { dataUrl: string; width: number; height: number; duration: number };

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

function ImageThumb({ source, label }: { source: string; label: string }) {
  return source ? <img src={source} alt={label} /> : <span className="image-placeholder">IMG</span>;
}

function CubeLogo() {
  return <span className="cube-logo" aria-hidden="true"><i /><i /><i /></span>;
}

const CUBE_FACES = ["front", "back", "right", "left", "top", "bottom"];

function MagicCube({ compact = false }: { compact?: boolean }) {
  const cubeRef = useRef<HTMLDivElement>(null);
  const motion = useRef({ x: -22, y: 28, targetX: -22, targetY: 28, vx: 0, vy: 0, interacted: false });
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const animate = (time: number) => {
      const state = motion.current;
      if (!state.interacted) { state.targetX = -22 + Math.sin(time / 1900) * 5; state.targetY = 28 + Math.sin(time / 2600) * 12; }
      state.vx = (state.vx + (state.targetX - state.x) * .032) * .88;
      state.vy = (state.vy + (state.targetY - state.y) * .032) * .88;
      state.x += state.vx; state.y += state.vy;
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
  return <div className={compact ? "cube-scene compact" : "cube-scene"} onPointerMove={followPointer} aria-label="跟随鼠标缓动旋转的 Jsonable 魔方视觉" role="img">
    <div className="cube-orbit cube-orbit-one" /><div className="cube-orbit cube-orbit-two" />
    <div className="magic-cube" ref={cubeRef}>
      {CUBE_FACES.map((face) => <div className={`cube-face cube-face-${face}`} key={face}>{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</div>)}
    </div>
    {!compact && <div className="cube-caption"><span>JSON / IN MOTION</span><strong>把复杂结构，转成看得见的改变。</strong></div>}
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
  const [compressionResult, setCompressionResult] = useState<CompressionResult | null>(null);
  const [mediaConverting, setMediaConverting] = useState(false);
  const [mediaConversion, setMediaConversion] = useState<MediaConversionResult | null>(null);
  const [mediaConversionError, setMediaConversionError] = useState("");
  const [isDraggingJson, setIsDraggingJson] = useState(false);
  const [toolsDocked, setToolsDocked] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("已识别示例 JSON");
  const fileRef = useRef<HTMLInputElement>(null);
  const replacementFileRef = useRef<HTMLInputElement>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const mediaFileRef = useRef<HTMLInputElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const colors = useMemo(() => scanColors(data), [data]);
  const shapes = useMemo(() => scanShapes(data), [data]);
  const images = useMemo(() => scanImages(data), [data]);
  const jsonText = useMemo(() => JSON.stringify(data, null, 2), [data]);
  useEffect(() => { setCompressionCountdown(null); setCompressionResult(null); }, [data]);
  useEffect(() => {
    if (compressionCountdown === null) return;
    if (compressionCountdown > 0) {
      const timer = window.setTimeout(() => setCompressionCountdown((current) => current === null ? null : current - 1), 1000);
      return () => window.clearTimeout(timer);
    }
    const text = JSON.stringify(data); const originalSize = new Blob([jsonText]).size; const compressedSize = new Blob([text]).size;
    const percentage = originalSize ? Math.max(0, (1 - compressedSize / originalSize) * 100) : 0;
    setCompressionResult({ text, originalSize, compressedSize, percentage }); setCompressionCountdown(null);
    setToast(`压缩完成：减少 ${percentage.toFixed(1)}%`);
  }, [compressionCountdown, data, jsonText]);
  useEffect(() => {
    if (!colorEditor && !shapeEditorOpen && !imageEditorOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setColorEditor(null); setShapeEditorOpen(false); setImageEditorOpen(false);
    };
    document.body.style.overflow = "hidden"; window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [colorEditor, shapeEditorOpen, imageEditorOpen]);
  useEffect(() => {
    const updateDock = () => {
      if (!heroRef.current || window.innerWidth < 1500) { setToolsDocked(false); return; }
      setToolsDocked(heroRef.current.getBoundingClientRect().top <= -72);
    };
    updateDock(); window.addEventListener("scroll", updateDock, { passive: true }); window.addEventListener("resize", updateDock);
    return () => { window.removeEventListener("scroll", updateDock); window.removeEventListener("resize", updateDock); };
  }, []);
  const activeShape = shapes.find((item) => `${item.mode}:${item.name}` === selectedShape) || shapes[0];
  const activeImage = images.find((item) => item.id === selectedImage) || images[0];
  const tabMeta = activeTab === "colors"
    ? { title: "颜色", english: "COLORS", description: `识别到 ${colors.length} 种颜色，编辑窗口会保持开启。` }
    : activeTab === "shapes"
      ? { title: "组合形状", english: "GROUPS", description: "选择主文件中的组合，再上传 SVG 作为新的矢量结构。" }
      : { title: "图片资源", english: "IMAGES", description: `识别到 ${images.length} 个图片资源，替换后保留原图层布局与动画。` };

  const loadJsonFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()); setData(parsed); setHasUploadedFile(true); setFileName(file.name); setError(""); setSelectedShape(""); setSelectedImage(""); setUploadedSvg(null); setUploadedImage(null); setShapeEditorOpen(false); setImageEditorOpen(false); setInspectorTab("preview");
      const foundColors = scanColors(parsed).length; const foundShapes = scanShapes(parsed).length; const foundImages = scanImages(parsed).length;
      setToast(`识别完成：${foundColors} 种颜色，${foundShapes} 种形状，${foundImages} 个图片资源`);
    } catch { setError("无法解析这个文件，请检查 JSON 格式后重试。"); }
  };
  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    await loadJsonFile(file);
    event.target.value = "";
  };
  const dropJson = async (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault(); setIsDraggingJson(false); const file = event.dataTransfer.files?.[0]; if (!file) return;
    if (!/\.json$/i.test(file.name) && file.type !== "application/json") { setError("请拖入 JSON 文件，其他格式请使用“上传非json文件”。"); return; }
    await loadJsonFile(file);
  };

  const convertMediaFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files || [])]; event.target.value = ""; if (!selected.length) return;
    const files = selected.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    const allowed = files.every((file) => /^(video\/mp4|image\/(gif|apng|png|jpeg|webp))$/i.test(file.type) || /\.(mp4|gif|apng|png|jpe?g|webp)$/i.test(file.name));
    if (!allowed) { setMediaConversionError("请选择 MP4、GIF、APNG、PNG、JPG 或 WebP 文件。"); return; }
    setMediaConverting(true); setMediaConversion(null); setMediaConversionError("");
    try {
      const extension = files[0].name.split(".").pop()?.toLowerCase(); const kind = files.length > 1 ? "sequence-frames" : extension === "mp4" ? "mp4" : extension === "gif" ? "gif" : extension === "apng" || files[0].type === "image/apng" ? "apng" : "image";
      const frames = files.length > 1 ? await Promise.all(files.slice(0, 96).map(decodeStill)) : kind === "mp4" ? await decodeVideo(files[0]) : kind === "gif" || kind === "apng" ? await decodeAnimatedImage(files[0]) : [await decodeStill(files[0])];
      const lottie = framesToLottie(frames); const text = JSON.stringify(lottie); const jsonSize = new Blob([text]).size; const originalSize = files.reduce((sum, file) => sum + file.size, 0); const payloadSize = frames.reduce((sum, frame) => sum + Math.ceil(frame.dataUrl.length * .75), 0); const percentage = originalSize ? Math.max(0, (1 - Math.min(payloadSize, originalSize) / originalSize) * 100) : 0;
      const baseName = files.length > 1 ? "sequence-frames" : files[0].name.replace(/\.[^.]+$/, "");
      setMediaConversion({ text, kind, fileCount: frames.length, originalSize, payloadSize, jsonSize, percentage, outputName: `${baseName}-lottie.json` });
      setToast(`转换完成：已生成 ${frames.length} 帧可播放 Lottie JSON`);
    } catch { setMediaConversionError("转换失败：请确认浏览器支持该媒体编码，或缩短视频、减少序列帧后重试。"); }
    finally { setMediaConverting(false); }
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
    setData((current: unknown) => replaceColor(current, from, next)); setColorEditor({ ...colorEditor, current: next, draft: next }); setInspectorTab("preview"); setToast(`已替换 ${from} 的全部引用`);
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
    setData((current: unknown) => replaceImageResource(current, target, uploadedImage.dataUrl)); setInspectorTab("preview"); setImageError("");
    setToast(`已替换 ${target.count} 个「${target.name}」图片引用`);
  };
  const changeShapeFromUpload = (from: ShapeInfo) => {
    if (!uploadedSvg) return;
    if (from.mode === "reference") { setReplacementError("当前目标只是外部引用，无法写入 SVG 路径。请选择组合、组件或 Lottie 图层。"); return; }
    const group = clone(uploadedSvg.group); group.nm = from.name; group.__jsonableSvg = true;
    const template = from.mode === "lottie-group" ? group : from.mode === "lottie-layer"
      ? { ty: 4, nm: from.name, shapes: [group], ks: {}, ip: 0, op: 1, st: 0, __jsonableSvg: true }
      : { name: from.name, componentName: from.name, type: "svg", svg: uploadedSvg.raw, items: [group], __jsonableSvg: true };
    setData((current: unknown) => replaceShape(current, from, from.name, template)); setInspectorTab("preview"); setReplacementError("");
    setToast(`已使用 ${uploadedSvg.fileName} 替换 ${from.count} 个「${from.name}」`);
  };
  const download = () => { const blob = new Blob([jsonText], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = fileName.replace(/\.json$/i, "") + "-edited.json"; a.click(); URL.revokeObjectURL(url); setToast("修改后的 JSON 已下载"); };
  const downloadCompressed = () => {
    if (!compressionResult) return;
    const blob = new Blob([compressionResult.text], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = fileName.replace(/\.json$/i, "") + "-compressed.json"; a.click(); URL.revokeObjectURL(url); setToast("压缩后的 JSON 已下载");
  };
  const downloadMediaJson = () => {
    if (!mediaConversion) return;
    const blob = new Blob([mediaConversion.text], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = mediaConversion.outputName; a.click(); URL.revokeObjectURL(url); setToast("转换后的媒体 JSON 已下载");
  };

  return <main>
    <header className="topbar"><a className="brand" href="#" aria-label="Jsonable 首页"><CubeLogo /><span>Jsonable</span></a><div className="top-actions"><span className="privacy"><span className="lock">◆</span>文件仅在本地处理</span><button className="button button-ghost" onClick={() => fileRef.current?.click()}>＋ 上传文件</button><button className="button button-dark" onClick={download}>下载 JSON <span>↓</span></button></div></header>
    <section className="hero" ref={heroRef}>
      <div className="hero-copy"><span className="eyebrow">VISUAL JSON EDITOR</span><h1>让每一层 JSON，<em>都看得见。</em></h1><p>上传 JSON，直接替换颜色、组合形状与图片资源；结构再复杂，也能边改边看。</p></div>
      <MagicCube compact />
      <div className={toolsDocked ? "hero-tools docked" : "hero-tools"}>
        <article className={compressionResult ? "compress-card complete" : "compress-card"}><span className="compress-copy"><small>{compressionResult ? "COMPRESSION COMPLETE" : "JSON MINIFIER"}</small><strong>{compressionResult ? `压缩后 ${formatBytes(compressionResult.compressedSize)}` : "压缩当前 JSON"}</strong><em>{compressionResult ? `原始 ${formatBytes(compressionResult.originalSize)}，减少 ${compressionResult.percentage.toFixed(1)}%` : `当前 ${formatBytes(new Blob([jsonText]).size)}，移除缩进与换行`}</em></span><button className={compressionCountdown !== null ? "compress-action running" : "compress-action"} onClick={() => { setCompressionResult(null); setCompressionCountdown(3); }} disabled={compressionCountdown !== null} aria-label="压缩当前 JSON"><span>{compressionCountdown ?? (compressionResult ? "再压缩" : "压缩")}</span></button>{compressionResult && <button className="compress-download" onClick={downloadCompressed} aria-label="下载压缩后的 JSON">↓</button>}</article>
        <article className={mediaConversion ? "media-convert-card complete" : "media-convert-card"}><span className="compress-copy"><small>{mediaConversion ? "PLAYABLE LOTTIE READY" : "MEDIA TO LOTTIE JSON"}</small><strong>{mediaConversion ? `${mediaConversion.fileCount} 帧，${formatBytes(mediaConversion.jsonSize)}` : "转换为可播放 JSON"}</strong><em>{mediaConversion ? `图像压缩 ${mediaConversion.percentage.toFixed(1)}%，${mediaConversion.kind}` : "MP4、GIF、APNG 或序列帧"}</em></span><button className="media-upload-button" onClick={() => mediaFileRef.current?.click()} disabled={mediaConverting}>{mediaConverting ? "正在抽帧..." : "上传非json文件"}</button>{mediaConversion && <button className="compress-download" onClick={downloadMediaJson} aria-label="下载可播放的 Lottie JSON">↓</button>}{mediaConversionError && <span className="media-inline-error">{mediaConversionError}</span>}</article>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" onChange={loadFile} hidden /><input ref={mediaFileRef} type="file" accept="video/mp4,image/gif,image/apng,image/png,image/jpeg,image/webp,.apng" multiple onChange={convertMediaFiles} hidden />
    </section>
    {error && <div className="error" role="alert">{error}</div>}
    <section className="workspace">
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
    </section>
    {colorEditor && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label="颜色编辑器"><div className="color-dialog"><header><div><span className="eyebrow">COLOR EDITOR</span><h3>替换颜色</h3></div><button onClick={() => setColorEditor(null)} aria-label="关闭颜色编辑器">×</button></header><div className="color-dialog-main"><label className="large-picker" style={{ background: colorEditor.current }}><input type="color" value={colorEditor.current} onChange={(event) => changeColor(event.target.value)} /><span>点击选择色彩</span></label><div className="color-values"><label>HEX 色值</label><div><input value={colorEditor.draft} onChange={(event) => setColorEditor({ ...colorEditor, draft: event.target.value.toUpperCase() })} /><button onClick={() => changeColor(colorEditor.draft)}>应用</button></div><small>将同步修改 {colorEditor.count} 个引用，窗口不会自动关闭。</small></div></div><div className="quick-colors">{["#101513", "#E8F0ED", "#48C5A1", "#2A6F5C", "#E66E58", "#5E8DA0"].map((hex) => <button key={hex} style={{ background: hex }} onClick={() => changeColor(hex)} aria-label={`选择 ${hex}`} />)}</div><footer><span>修改已实时写入预览和 JSON</span><button onClick={() => setColorEditor(null)}>关闭</button></footer></div></div>}
    {shapeEditorOpen && activeShape && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label={`替换形状 ${activeShape.name}`}><div className="color-dialog asset-dialog"><header><div><span className="eyebrow">SVG REPLACEMENT</span><h3>替换「{activeShape.name}」</h3></div><button onClick={() => setShapeEditorOpen(false)} aria-label="关闭形状替换窗口">×</button></header><div className="asset-dialog-body"><div className="replace-card"><div className="composed-current"><ShapeThumb data={data} shape={activeShape} /><span><small>主文件中的目标</small><strong>{activeShape.name}</strong></span><b>{activeShape.count} 个实例</b></div><button className="replacement-upload" onClick={() => replacementFileRef.current?.click()}>{uploadedSvg ? <img className="replacement-svg-preview" src={uploadedSvg.preview} alt="上传的 SVG 预览" /> : <span className="replacement-upload-icon">＋</span>}<span><small>{uploadedSvg ? "已转换为矢量路径" : "上传替换形状"}</small><strong>{uploadedSvg?.fileName || "选择 SVG 文件"}</strong></span><b>{uploadedSvg ? "重新上传" : "选择文件"}</b></button><input ref={replacementFileRef} type="file" accept="image/svg+xml,.svg" onChange={loadReplacementFile} hidden />{replacementError && <div className="replacement-error" role="alert">{replacementError}</div>}{uploadedSvg && <><div className="replacement-summary"><span>已转换的矢量部分</span><b>{uploadedSvg.partCount}</b></div><button className="apply-replacement" onClick={() => changeShapeFromUpload(activeShape)} disabled={activeShape.mode === "reference"}>使用这个 SVG 替换全部同名形状</button>{activeShape.mode === "reference" && <div className="replacement-empty">当前目标是外部引用，不能直接写入 SVG 路径。</div>}</>}<p>SVG 会转换为 JSON 内的矢量路径，同时保留同名实例的位置、缩放和动画变换。</p></div></div><footer><span>文件仅在本地浏览器中处理</span><button onClick={() => setShapeEditorOpen(false)}>关闭</button></footer></div></div>}
    {imageEditorOpen && activeImage && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label={`替换图片 ${activeImage.name}`}><div className="color-dialog asset-dialog"><header><div><span className="eyebrow">IMAGE REPLACEMENT</span><h3>替换「{activeImage.name}」</h3></div><button onClick={() => setImageEditorOpen(false)} aria-label="关闭图片替换窗口">×</button></header><div className="asset-dialog-body"><div className="replace-card image-replace-card"><div className="current-image"><span className="current-image-preview"><ImageThumb source={activeImage.preview} label={activeImage.name} /></span><span><small>当前资源</small><strong>{activeImage.name}</strong><em>{activeImage.count} 个引用</em></span></div><button className="replacement-upload image-upload" onClick={() => imageFileRef.current?.click()}>{uploadedImage ? <img className="replacement-svg-preview" src={uploadedImage.dataUrl} alt="新图片预览" /> : <span className="replacement-upload-icon">＋</span>}<span><small>{uploadedImage ? `${uploadedImage.width} × ${uploadedImage.height}` : "上传新图片"}</small><strong>{uploadedImage?.fileName || "选择 PNG、JPG、WebP 或 GIF"}</strong></span><b>{uploadedImage ? "重新上传" : "选择文件"}</b></button><input ref={imageFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={loadImageReplacement} hidden />{imageError && <div className="replacement-error" role="alert">{imageError}</div>}{uploadedImage && <button className="apply-replacement" onClick={() => changeImage(activeImage)}>使用这张图片替换全部引用</button>}<p>新图片会内嵌写入 JSON，原图层的位置、尺寸、透明度和动画保持不变。</p></div></div><footer><span>文件不会上传到服务器</span><button onClick={() => setImageEditorOpen(false)}>关闭</button></footer></div></div>}
    <div className="toast" aria-live="polite"><span>✓</span>{toast}</div>
  </main>;
}

function Empty({ text }: { text: string }) { return <div className="empty"><span>◎</span><p>{text}</p></div>; }
