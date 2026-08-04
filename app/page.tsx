"use client";

import { ChangeEvent, DragEvent as ReactDragEvent, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnimationItem } from "lottie-web";
import { strToU8, zipSync } from "fflate";

const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

type ShapeName = "circle" | "square" | "triangle" | "star" | "heart" | "hexagon" | "path";
type ColorInfo = { hex: string; label: string; count: number };
type ShapeInfo = { name: string; count: number; mode: "lottie-precomp" | "lottie-group" | "lottie-layer" | "component" | "reference" };
type UploadedSvg = { fileName: string; name: string; preview: string; raw: string; group: Record<string, unknown>; partCount: number };
type ImageInfo = { id: string; name: string; value: string; preview: string; count: number; mode: "lottie-asset" | "field"; assetId?: string; key?: string };
type UploadedImage = { fileName: string; dataUrl: string; width: number; height: number; size: number };
type EasingCurve = { outX: number; outY: number; inX: number; inY: number };
type MotionElement = { id: string; name: string };
type MotionCategory = "move" | "scale" | "opacity" | "rotation" | "other";
type EasingInfo = EasingCurve & { id: string; count: number; paths: string[]; elements: MotionElement[]; category: MotionCategory };
type OptimizationItem = { key: string; title: string; description: string; count: number; examples: string[] };
type CompressionResult = { text: string; originalSize: number; compressedSize: number; percentage: number; optimizations: OptimizationItem[] };
type CompressionResults = { normal: CompressionResult; advanced: CompressionResult };
type FrameSamplingMethod = "half" | "third" | "fps12" | "fps8" | "custom";
type FrameSamplingSetting = { enabled: boolean; method: FrameSamplingMethod; selectedFrames: number[] };
type CompressionSamplingSettings = { advanced: FrameSamplingSetting };
type SequenceFrameOption = { index: number; label: string; preview: string; time: number };
type MediaConversionResult = { text: string; kind: string; fileCount: number; originalSize: number; payloadSize: number; jsonSize: number; percentage: number; outputName: string };
type MediaFrame = { dataUrl: string; width: number; height: number; duration: number };
type EditVersion = { id: string; label: string; createdAt: number; data: unknown };
type DiffItem = { path: string; before: string; after: string };

const SAMPLE = {
  name: "summer-campaign",
  canvas: { background: "#101513", width: 1080, height: 1080 },
  elements: [
    { id: "badge-1", name: "sun-badge", children: [{ shape: "circle", fill: "#FF6B4A" }, { shape: "star", fill: "#FFFFFF" }] },
    { id: "badge-2", name: "sun-badge", children: [{ shape: "circle", fill: "#FF6B4A" }, { shape: "star", fill: "#FFFFFF" }] },
    { id: "card", name: "dark-card", children: [{ shape: "square", fill: "#1F2937" }, { shape: "triangle", fill: [1, 0.804, 0.337, 1] }] },
  ],
};

const ALIASES: Record<string, ShapeName> = {
  circle: "circle", ellipse: "circle", oval: "circle", round: "circle", el: "circle",
  square: "square", rectangle: "square", rect: "square", box: "square", rc: "square",
  triangle: "triangle", polygon3: "triangle", star: "star", sr: "star", heart: "heart",
  hexagon: "hexagon", polygon: "hexagon", path: "path", shape: "path", sh: "path",
};
const EASING_PRESETS: { name: string; curve: EasingCurve }[] = [
  { name: "匀速", curve: { outX: 0, outY: 0, inX: 1, inY: 1 } },
  { name: "柔和", curve: { outX: .42, outY: 0, inX: .58, inY: 1 } },
  { name: "缓入", curve: { outX: .7, outY: 0, inX: .84, inY: 0 } },
  { name: "缓出", curve: { outX: .16, outY: 1, inX: .3, inY: 1 } },
  { name: "灵敏", curve: { outX: .2, outY: .85, inX: .35, inY: 1 } },
];
const EASING_CATEGORIES: { id: MotionCategory; label: string; english: string }[] = [
  { id: "move", label: "移动", english: "MOVE" },
  { id: "scale", label: "缩放", english: "SCALE" },
  { id: "opacity", label: "透明度", english: "OPACITY" },
  { id: "rotation", label: "旋转", english: "ROTATE" },
  { id: "other", label: "其他", english: "OTHER" },
];
const COLOR_KEY = /^(c|fc|sc|color|colour|fill|fillcolor|stroke|strokecolor|background|backgroundcolor|bg|tint|foreground)$/i;

function clamp(value: number) { return Math.max(0, Math.min(255, Math.round(value))); }
function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`; }
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

const LOTTIE_GEOMETRY_TYPES = new Set(["sh", "rc", "el", "sr"]);

function hasRenderableLottieGeometry(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasRenderableLottieGeometry);
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  if (object.hd === true) return false;
  if (typeof object.ty === "string" && LOTTIE_GEOMETRY_TYPES.has(object.ty)) return true;
  return Object.values(object).some(hasRenderableLottieGeometry);
}

function isNonVisualLottieLayer(value: unknown, parentKey: string) {
  if (parentKey !== "layers" || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  const isNullOrHelper = object.ty === 3 || object.ty === 6 || object.ty === 13;
  const isTrackMatteSource = typeof object.td === "number" && object.td > 0;
  return object.hd === true || isNullOrHelper || isTrackMatteSource;
}

function composedDescriptor(value: unknown, parentKey = "root"): Omit<ShapeInfo, "count"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (parentKey === "layers" && object.ty === 0 && typeof object.refId === "string" && object.refId.trim() && typeof object.nm === "string" && object.nm.trim()) return { name: object.nm.trim(), mode: "lottie-precomp" };
  if (object.ty === "gr" && hasRenderableLottieGeometry(object.it) && typeof object.nm === "string" && object.nm.trim() && !/^__json(?:icle|able)_svg_part_/.test(object.nm)) return { name: object.nm.trim(), mode: "lottie-group" };
  if (parentKey === "layers" && object.ty === 4 && hasRenderableLottieGeometry(object.shapes) && typeof object.nm === "string" && object.nm.trim()) return { name: object.nm.trim(), mode: "lottie-layer" };
  const name = [object.name, object.nm, object.componentName].find((item) => typeof item === "string" && item.trim()) as string | undefined;
  const hasParts = ["children", "items", "elements", "shapes", "components", "paths"].some((key) => Array.isArray(object[key]) && (object[key] as unknown[]).length > 0);
  if (name && hasParts && !ALIASES[name.toLowerCase().replace(/[\s_-]/g, "")]) return { name: name.trim(), mode: "component" };
  const reference = [object.iconName, object.symbol, object.icon, object.shapeName].find((item) => typeof item === "string" && item.trim()) as string | undefined;
  if (reference && !ALIASES[reference.toLowerCase().replace(/[\s_-]/g, "")]) return { name: reference.trim(), mode: "reference" };
  return null;
}

function scanShapes(data: unknown) {
  const map = new Map<string, ShapeInfo>();
  const root = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  const lottieRoot = !!root && Array.isArray(root.layers) && Array.isArray(root.assets);
  const addCandidate = (candidate: Omit<ShapeInfo, "count">) => {
    const id = `${candidate.mode}:${candidate.name}`; const current = map.get(id);
    map.set(id, { ...candidate, count: (current?.count || 0) + 1 });
  };
  const collectPrecompReferences = (value: unknown, parentKey = "root") => {
    const candidate = composedDescriptor(value, parentKey);
    if (candidate?.mode === "lottie-precomp") addCandidate(candidate);
    if (Array.isArray(value)) value.forEach((child) => collectPrecompReferences(child, parentKey));
    else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => collectPrecompReferences(child, childKey));
  };
  if (lottieRoot) collectPrecompReferences(data);
  const scan = (value: unknown, parentKey = "root", isRoot = false) => {
    if (lottieRoot && isNonVisualLottieLayer(value, parentKey)) return;
    const candidate = composedDescriptor(value, parentKey);
    if (candidate) {
      if (candidate.mode === "lottie-precomp") {
        if (!lottieRoot) addCandidate(candidate);
        return;
      }
      addCandidate(candidate);
    }
    if (Array.isArray(value)) value.forEach((child) => scan(child, parentKey));
    else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => {
      if (isRoot && lottieRoot && childKey === "assets") return;
      scan(child, childKey);
    });
  };
  scan(data, "root", true); return [...map.values()];
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

function easingNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.find((item) => typeof item === "number" && Number.isFinite(item)) as number | undefined;
  return undefined;
}

function easingCurve(value: unknown): EasingCurve | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (typeof object.t !== "number" || !object.o || !object.i || typeof object.o !== "object" || typeof object.i !== "object") return null;
  const outgoing = object.o as Record<string, unknown>; const incoming = object.i as Record<string, unknown>;
  const outX = easingNumber(outgoing.x); const outY = easingNumber(outgoing.y); const inX = easingNumber(incoming.x); const inY = easingNumber(incoming.y);
  return [outX, outY, inX, inY].every((item) => typeof item === "number") ? { outX: outX!, outY: outY!, inX: inX!, inY: inY! } : null;
}

function easingSignature(curve: EasingCurve) {
  return [curve.outX, curve.outY, curve.inX, curve.inY].map((value) => value.toFixed(3)).join(":");
}

function animatedPropertyCategory(key: string, value: unknown, inherited: MotionCategory | null) {
  if (inherited) return inherited;
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, "k")) return null;
  if (/^(p|px|py|pz|a)$/i.test(key)) return "move" as const;
  if (/^s$/i.test(key)) return "scale" as const;
  if (/^o$/i.test(key)) return "opacity" as const;
  if (/^(r|rx|ry|rz|or)$/i.test(key)) return "rotation" as const;
  return "other" as const;
}

function scanEasings(data: unknown) {
  const profiles = new Map<string, EasingInfo>();
  const scan = (value: unknown, path = "$", parentElement: MotionElement | null = null, inheritedCategory: MotionCategory | null = null) => {
    const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    const currentElement = object && typeof object.nm === "string" && (typeof object.ty === "number" || typeof object.ind === "number")
      ? { id: path, name: object.nm.trim() || `图层 ${String(object.ind || "")}` }
      : parentElement;
    const curve = easingCurve(value);
    if (curve) {
      const category = inheritedCategory || "other"; const id = `${category}:${easingSignature(curve)}`; const existing = profiles.get(id);
      if (existing) {
        existing.count += 1; existing.paths.push(path);
        if (currentElement && !existing.elements.some((element) => element.id === currentElement.id)) existing.elements.push(currentElement);
      } else profiles.set(id, { ...curve, id, count: 1, paths: [path], elements: currentElement ? [currentElement] : [], category });
    }
    if (Array.isArray(value)) value.forEach((child, index) => scan(child, `${path}[${index}]`, currentElement, inheritedCategory));
    else if (object) Object.entries(object).forEach(([key, child]) => scan(child, `${path}.${key}`, currentElement, animatedPropertyCategory(key, child, inheritedCategory)));
  };
  scan(data); return [...profiles.values()].sort((a, b) => b.count - a.count);
}

function lottieDataWithMotionHighlights(data: Record<string, unknown>, elementIds: string[]) {
  const highlighted = new Set(elementIds);
  if (!highlighted.size) return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const next = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const visit = (value: unknown, path = "$") => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (highlighted.has(path)) {
      const existingClass = typeof object.cl === "string" ? object.cl.trim() : "";
      object.cl = [existingClass, "jsonable-motion-highlight"].filter(Boolean).join(" ");
    }
    Object.entries(object).forEach(([key, child]) => visit(child, `${path}.${key}`));
  };
  visit(next);
  return next;
}

function updateEasingPoint(point: unknown, x: number, y: number) {
  if (!point || typeof point !== "object" || Array.isArray(point)) return point;
  const object = point as Record<string, unknown>;
  const replaceValue = (current: unknown, next: number) => Array.isArray(current) ? current.map(() => next) : next;
  return { ...object, x: replaceValue(object.x, x), y: replaceValue(object.y, y) };
}

function replaceEasing(data: unknown, from: EasingCurve, to: EasingCurve, targetPaths: Set<string>, path = "$"): unknown {
  if (Array.isArray(data)) return data.map((child, index) => replaceEasing(child, from, to, targetPaths, `${path}[${index}]`));
  if (data && typeof data === "object") {
    const object = data as Record<string, unknown>; const current = easingCurve(object);
    if (current && easingSignature(current) === easingSignature(from) && targetPaths.has(path)) {
      return Object.fromEntries(Object.entries({ ...object, o: updateEasingPoint(object.o, to.outX, to.outY), i: updateEasingPoint(object.i, to.inX, to.inY) }).map(([key, child]) => [key, replaceEasing(child, from, to, targetPaths, `${path}.${key}`)]));
    }
    return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, replaceEasing(child, from, to, targetPaths, `${path}.${key}`)]));
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

function clearLegacyDraft() {
  if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(DRAFT_DB);
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

function inspectSequenceFrames(data: unknown) {
  if (!isLottie(data)) return { matched: false, frameRate: 0, frames: [] as SequenceFrameOption[] };
  const root = data as Record<string, unknown>;
  const layers = Array.isArray(root.layers) ? root.layers : [];
  const candidates = layers.map((layer) => {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) return null;
    const object = layer as Record<string, unknown>;
    const ip = typeof object.ip === "number" ? object.ip : NaN;
    const op = typeof object.op === "number" ? object.op : NaN;
    if (object.ty !== 2 || typeof object.refId !== "string" || !Number.isFinite(ip) || !Number.isFinite(op) || op <= ip || op - ip > 1.5) return null;
    return { ip, name: typeof object.nm === "string" ? object.nm : "", refId: object.refId };
  }).filter((item): item is { ip: number; name: string; refId: string } => item !== null).sort((a, b) => a.ip - b.ip);
  const meta = root.meta && typeof root.meta === "object" && !Array.isArray(root.meta) ? root.meta as Record<string, unknown> : {};
  const namedFrames = candidates.filter((item) => /^(frame|帧)\s*[-_ ]?\d+/i.test(item.name)).length;
  const matched = candidates.length >= 8 && layers.length > 0 && candidates.length / layers.length >= .7 && (typeof meta.sourceFrames === "number" || namedFrames >= Math.ceil(candidates.length * .5));
  if (!matched) return { matched: false, frameRate: 0, frames: [] as SequenceFrameOption[] };
  const frameRate = typeof root.fr === "number" && root.fr > 0 ? root.fr : 30;
  const assets = Array.isArray(root.assets) ? root.assets.filter((asset): asset is Record<string, unknown> => !!asset && typeof asset === "object" && !Array.isArray(asset)) : [];
  const assetMap = new Map(assets.filter((asset) => typeof asset.id === "string").map((asset) => [asset.id as string, asset]));
  const frames = candidates.map((item, index) => {
    const asset = assetMap.get(item.refId); const path = typeof asset?.p === "string" ? asset.p : ""; const folder = typeof asset?.u === "string" ? asset.u : "";
    return { index, label: item.name || `帧 ${String(index + 1).padStart(3, "0")}`, preview: /^data:|^https?:|^\//i.test(path) ? path : `${folder}${path}`, time: item.ip / frameRate };
  });
  return { matched: true, frameRate, frames };
}

function sampleSequenceFrames(data: unknown, method: FrameSamplingMethod, selectedFrames: number[] = []) {
  const sampled = clone(data);
  if (!isLottie(sampled)) return { data: sampled, matched: false, optimization: null as OptimizationItem | null };
  const root = sampled as Record<string, unknown>;
  const sourceRoot = data as Record<string, unknown>;
  const sourceTimeline = { fr: sourceRoot.fr, ip: sourceRoot.ip, op: sourceRoot.op };
  const layers = Array.isArray(root.layers) ? root.layers : [];
  const candidates = layers.map((layer, index) => {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) return null;
    const object = layer as Record<string, unknown>;
    const ip = typeof object.ip === "number" ? object.ip : NaN;
    const op = typeof object.op === "number" ? object.op : NaN;
    if (object.ty !== 2 || typeof object.refId !== "string" || !Number.isFinite(ip) || !Number.isFinite(op) || op <= ip || op - ip > 1.5) return null;
    return { index, layer: object, ip, op, refId: object.refId, name: typeof object.nm === "string" ? object.nm : "" };
  }).filter((item): item is { index: number; layer: Record<string, unknown>; ip: number; op: number; refId: string; name: string } => item !== null);
  const meta = root.meta && typeof root.meta === "object" && !Array.isArray(root.meta) ? root.meta as Record<string, unknown> : {};
  const namedFrames = candidates.filter((item) => /^(frame|帧)\s*[-_ ]?\d+/i.test(item.name)).length;
  const matched = candidates.length >= 8 && layers.length > 0 && candidates.length / layers.length >= .7 && (typeof meta.sourceFrames === "number" || namedFrames >= Math.ceil(candidates.length * .5));
  if (!matched) return { data: sampled, matched: false, optimization: null as OptimizationItem | null };
  const frameRate = typeof root.fr === "number" && root.fr > 0 ? root.fr : 30;
  const stride = method === "half" ? 2 : method === "third" ? 3 : method === "custom" ? 1 : Math.max(1, Math.ceil(frameRate / (method === "fps12" ? 12 : 8)));
  const methodLabel = method === "half" ? "均匀保留 1/2" : method === "third" ? "均匀保留 1/3" : method === "fps12" ? "每秒最多保留 12 张图片" : method === "fps8" ? "每秒最多保留 8 张图片" : "自定义选帧";
  if (stride <= 1 && method !== "custom") return {
    data: sampled,
    matched: true,
    optimization: { key: "sequence-frame-sampling", title: "序列图片无需抽取", description: "当前图片数量已不高于所选目标，时间轴帧率和时长保持原值。", count: 0, examples: [`原始 ${frameRate} FPS 保持不变 · ${methodLabel}`] },
  };
  const ordered = [...candidates].sort((a, b) => a.ip - b.ip);
  const customSelection = new Set(selectedFrames);
  const retained = method === "custom"
    ? ordered.filter((_, index) => customSelection.has(index))
    : ordered.filter((_, index) => index % stride === 0);
  if (!retained.length) retained.push(ordered[0]);
  const retainedIndexes = new Set(retained.map((item) => item.index));
  ordered.forEach((item) => {
    if (retainedIndexes.has(item.index)) return;
    const earlier = retained.filter((candidate) => candidate.ip <= item.ip);
    const replacement = earlier[earlier.length - 1] ?? retained[0];
    item.layer.refId = replacement.refId;
  });
  if (Array.isArray(root.assets)) {
    const assets = root.assets.filter((asset): asset is Record<string, unknown> => !!asset && typeof asset === "object" && !Array.isArray(asset));
    const assetMap = new Map(assets.filter((asset) => typeof asset.id === "string").map((asset) => [asset.id as string, asset]));
    const used = new Set<string>(); const queue: string[] = [];
    const scanRefs = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(scanRefs);
      else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
        if (key === "refId" && typeof child === "string" && !used.has(child)) { used.add(child); queue.push(child); }
        else scanRefs(child);
      });
    };
    scanRefs(Object.fromEntries(Object.entries(root).filter(([key]) => key !== "assets")));
    while (queue.length) { const asset = assetMap.get(queue.shift() || ""); if (asset) scanRefs(asset); }
    root.assets = assets.filter((asset) => typeof asset.id !== "string" || used.has(asset.id));
  }
  (["fr", "ip", "op"] as const).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(sourceRoot, key)) root[key] = sourceTimeline[key];
    else delete root[key];
  });
  const removed = candidates.length - retained.length;
  return {
    data: sampled,
    matched: true,
    optimization: { key: "sequence-frame-sampling", title: `序列图片抽取 · ${methodLabel}`, description: "保留全部时间轴帧层与原始 ip、op、fr，仅让被抽取帧复用最近的保留图片，并删除不再引用的图片资产。", count: removed, examples: [`时间轴仍为 ${candidates.length} 帧 · 独立图片 ${retained.length} 张`, method === "custom" ? `已选择 ${retained.length} 张独立图片` : `原始 ${frameRate} FPS 保持不变 · 每 ${stride} 帧保留 1 张图片`] },
  };
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
    if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value) && !["fr", "ip", "op", "st", "sr", "t"].includes(parentKey)) {
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

function lottieStaticValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  if (!("k" in object)) return value;
  const keyframes = object.k;
  if (Array.isArray(keyframes) && keyframes.length && keyframes[0] && typeof keyframes[0] === "object" && !Array.isArray(keyframes[0])) {
    const sample = (keyframes[0] as Record<string, unknown>).s ?? (keyframes[0] as Record<string, unknown>).e;
    if (Array.isArray(sample) && sample.length === 1 && sample[0] && typeof sample[0] === "object") return sample[0];
    if (sample !== undefined) return sample;
  }
  return keyframes;
}

function lottieVector(value: unknown) {
  const resolved = lottieStaticValue(value);
  return Array.isArray(resolved) && resolved.length >= 2 && resolved.slice(0, 2).every((item) => typeof item === "number")
    ? [resolved[0] as number, resolved[1] as number]
    : null;
}

function collectPathVertices(value: unknown, output: number[][] = []) {
  if (Array.isArray(value)) value.forEach((item) => collectPathVertices(item, output));
  else if (value && typeof value === "object") {
    const object = value as Record<string, unknown>; const shape = lottieStaticValue(object.ks) as Record<string, unknown> | undefined;
    if (object.ty === "sh" && Array.isArray(shape?.v)) (shape.v as unknown[]).forEach((point) => { if (Array.isArray(point) && point.length >= 2) output.push(point as number[]); });
    Object.values(object).forEach((item) => collectPathVertices(item, output));
  }
  return output;
}

function collectLottieGeometryPoints(value: unknown, output: number[][] = []) {
  if (Array.isArray(value)) value.forEach((item) => collectLottieGeometryPoints(item, output));
  else if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (object.hd === true) return output;
    if (object.ty === "sh") {
      const shape = lottieStaticValue(object.ks) as Record<string, unknown> | undefined;
      if (Array.isArray(shape?.v)) (shape.v as unknown[]).forEach((point) => {
        if (Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every((item) => typeof item === "number")) output.push([point[0] as number, point[1] as number]);
      });
    } else if (object.ty === "rc" || object.ty === "el") {
      const position = lottieVector(object.p) || [0, 0]; const size = lottieVector(object.s);
      if (size) {
        output.push([position[0] - Math.abs(size[0]) / 2, position[1] - Math.abs(size[1]) / 2]);
        output.push([position[0] + Math.abs(size[0]) / 2, position[1] + Math.abs(size[1]) / 2]);
      }
    } else if (object.ty === "sr") {
      const position = lottieVector(object.p) || [0, 0]; const radiusValue = lottieStaticValue(object.or ?? object.r);
      const radius = typeof radiusValue === "number" ? Math.abs(radiusValue) : 0;
      if (radius > 0) {
        output.push([position[0] - radius, position[1] - radius]);
        output.push([position[0] + radius, position[1] + radius]);
      }
    }
    Object.values(object).forEach((item) => collectLottieGeometryPoints(item, output));
  }
  return output;
}

function fitSvgPaths(template: Record<string, unknown>, current: Record<string, unknown>) {
  const source = collectPathVertices(template); const target = collectLottieGeometryPoints(current);
  if (!source.length || !target.length) return;
  const bounds = (points: number[][]) => ({ minX: Math.min(...points.map((p) => p[0])), maxX: Math.max(...points.map((p) => p[0])), minY: Math.min(...points.map((p) => p[1])), maxY: Math.max(...points.map((p) => p[1])) });
  const a = bounds(source); const b = bounds(target); const sourceW = a.maxX - a.minX || 1; const sourceH = a.maxY - a.minY || 1; const targetW = b.maxX - b.minX || 100; const targetH = b.maxY - b.minY || 100;
  const scaleX = targetW / sourceW; const scaleY = targetH / sourceH; const sourceCX = (a.minX + a.maxX) / 2; const sourceCY = (a.minY + a.maxY) / 2; const targetCX = (b.minX + b.maxX) / 2; const targetCY = (b.minY + b.maxY) / 2;
  source.forEach((point) => { point[0] = (point[0] - sourceCX) * scaleX + targetCX; point[1] = (point[1] - sourceCY) * scaleY + targetCY; });
}

function findShapeTemplate(data: unknown, target: string, targetMode?: ShapeInfo["mode"], parentKey = "root"): Record<string, unknown> | null {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const descriptor = composedDescriptor(data, parentKey);
    if (descriptor?.name === target && descriptor.mode !== "reference" && (!targetMode || descriptor.mode === targetMode)) return data as Record<string, unknown>;
    const entries = Object.entries(data as Record<string, unknown>).sort(([left], [right]) => left === "layers" ? -1 : right === "layers" ? 1 : 0);
    for (const [childKey, child] of entries) {
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
  const preserve = mode === "lottie-layer" || mode === "lottie-precomp" ? ["ind", "parent", "ks", "ip", "op", "st"] : ["id", "key", "x", "y", "position", "transform", "layout"];
  preserve.forEach((key) => { if (key in current) next[key] = clone(current[key]); });
  return next;
}

function renameComposed(object: Record<string, unknown>, from: ShapeInfo, target: string) {
  const next = { ...object };
  for (const key of ["nm", "name", "componentName", "iconName", "symbol", "icon", "shapeName"]) if (next[key] === from.name) next[key] = target;
  return next;
}

function replaceSingleShape(data: unknown, from: ShapeInfo, target: string, template: Record<string, unknown> | null, parentKey = "root", state = { replaced: false }): unknown {
  if (state.replaced) return data;
  if (Array.isArray(data)) return data.map((child) => state.replaced ? child : replaceSingleShape(child, from, target, template, parentKey, state));
  if (data && typeof data === "object") {
    const object = data as Record<string, unknown>; const descriptor = composedDescriptor(object, parentKey);
    if (descriptor?.name === from.name && descriptor.mode === from.mode) {
      state.replaced = true;
      if (template && from.mode !== "reference") return transplantShape(object, template, from.mode);
      return renameComposed(object, from, target);
    }
    return Object.fromEntries(Object.entries(object).map(([childKey, child]) => [childKey, state.replaced ? child : replaceSingleShape(child, from, target, template, childKey, state)]));
  }
  return data;
}

function isLottie(data: unknown): data is Record<string, unknown> {
  return !!data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).layers) && typeof (data as Record<string, unknown>).fr === "number";
}

function ComposedMark() { return <span className="composed-mark"><i /><i /><i /></span>; }

function shapePreviewData(data: unknown, shape: ShapeInfo) {
  const template = findShapeTemplate(data, shape.name, shape.mode);
  if (!template || (shape.mode !== "lottie-precomp" && shape.mode !== "lottie-group" && shape.mode !== "lottie-layer")) return null;
  const root = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const frameRate = typeof root.fr === "number" ? root.fr : 30;
  const duration = typeof root.op === "number" ? Math.max(root.op as number, 1) : 60;
  const layer = shape.mode === "lottie-layer" || shape.mode === "lottie-precomp"
    ? { ...clone(template), ip: 0, op: duration, st: 0 }
    : { ty: 4, nm: shape.name, shapes: [clone(template)], ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } }, ip: 0, op: duration, st: 0 };
  return { v: typeof root.v === "string" ? root.v : "5.10.0", fr: frameRate, ip: 0, op: duration, w: typeof root.w === "number" ? root.w : 512, h: typeof root.h === "number" ? root.h : 512, nm: `${shape.name} preview`, ddd: 0, assets: Array.isArray(root.assets) ? clone(root.assets) : [], layers: [layer] } as Record<string, unknown>;
}

function LottieShapeThumb({ animationData, label }: { animationData: Record<string, unknown>; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let animation: AnimationItem | undefined; let active = true; const timers: number[] = [];
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
      const visibleScore = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll<SVGGraphicsElement>("path,rect,ellipse,circle,polygon,polyline")).reduce((score, element) => {
        let opacity = 1; let current: Element | null = element;
        while (current && current !== svg) {
          const style = window.getComputedStyle(current);
          if (style.display === "none" || style.visibility === "hidden") return score;
          opacity *= Number.parseFloat(style.opacity || "1");
          current = current.parentElement;
        }
        if (opacity <= .01) return score;
        const style = window.getComputedStyle(element);
        const transparent = (paint: string) => !paint || paint === "none" || paint === "transparent" || /rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(paint);
        const fillOpacity = transparent(style.fill) ? 0 : Number.parseFloat(style.fillOpacity || "1");
        const strokeOpacity = transparent(style.stroke) ? 0 : Number.parseFloat(style.strokeOpacity || "1");
        const paintOpacity = Math.max(Number.isFinite(fillOpacity) ? fillOpacity : 1, Number.isFinite(strokeOpacity) ? strokeOpacity : 1);
        if (paintOpacity <= .01) return score;
        try {
          const box = element.getBBox();
          return score + Math.max(1, box.width * box.height) * opacity * paintOpacity;
        } catch { return score; }
      }, 0);
      animation.addEventListener?.("DOMLoaded", () => {
        if (!animation || !ref.current) return;
        const totalFrames = Math.max(1, animation.getDuration(true) || 1);
        const candidates = [...new Set([0, .03, .06, .1, .18, .33, .5, .72].map((ratio) => Math.min(totalFrames - 1, Math.max(0, Math.round(totalFrames * ratio)))))];
        let bestFrame = candidates[0] || 0; let bestScore = -1;
        candidates.forEach((frame) => {
          animation?.goToAndStop(frame, true);
          const svg = ref.current?.querySelector("svg");
          const score = svg ? visibleScore(svg) : 0;
          if (score > bestScore) { bestScore = score; bestFrame = frame; }
        });
        animation.goToAndStop(bestFrame, true);
        ref.current.dataset.empty = bestScore > 0 ? "false" : "true";
        [0, 40, 120].forEach((delay) => timers.push(window.setTimeout(fit, delay)));
      });
    });
    return () => { active = false; timers.forEach(window.clearTimeout); animation?.destroy(); };
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

function shapeModeLabel(mode: ShapeInfo["mode"]) {
  if (mode === "lottie-precomp") return "AE 预合成";
  if (mode === "lottie-layer") return "Lottie 图层";
  if (mode === "lottie-group") return "Lottie 组合";
  if (mode === "component") return "组合组件";
  return "外部引用";
}

function LottiePreview({ data, highlightElementIds = [], highlightLabel = "" }: { data: Record<string, unknown>; highlightElementIds?: string[]; highlightLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const animationRef = useRef<AnimationItem | null>(null);
  const totalFramesRef = useRef(1);
  const lastProgressUpdate = useRef(0);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const highlightedData = useMemo(() => lottieDataWithMotionHighlights(data, highlightElementIds), [data, highlightElementIds.join("|")]);
  useEffect(() => {
    let animation: AnimationItem | undefined; let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setFailed(false); setPlaying(true); setProgress(0); setCurrentTime(0); setDuration(0);
    });
    import("lottie-web/build/player/lottie_light").then(({ default: lottie }) => {
      if (!active || !ref.current) return;
      ref.current.innerHTML = "";
      animation = lottie.loadAnimation({ container: ref.current, renderer: "svg", loop: true, autoplay: true, animationData: highlightedData });
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
  }, [highlightedData]);
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
  return failed ? <div className="preview-message">动画结构无法直接渲染，已显示识别到的视觉元素。</div> : <div className={highlightElementIds.length ? "lottie-player has-motion-highlight" : "lottie-player"}><div ref={ref} className="lottie-stage" />{highlightLabel && <div className="motion-highlight-label"><span>当前曲线</span><strong>{highlightLabel}</strong><small>视觉中发光的素材为当前关联元素</small></div>}<div className="playback-controls"><button type="button" onClick={togglePlayback} aria-label={playing ? "暂停预览" : "播放预览"}><span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span></button><span className="playback-time">{timeLabel(currentTime)}</span><input type="range" min="0" max="1000" step="1" value={Math.round(progress * 1000)} onChange={(event) => seek(Number(event.target.value) / 1000)} aria-label="动画播放进度" style={{ "--playback-progress": `${progress * 100}%` } as CSSProperties} /><span className="playback-time">{timeLabel(duration)}</span></div></div>;
}

function ImageThumb({ source, label }: { source: string; label: string }) {
  return source ? <img src={source} alt={label} /> : <span className="image-placeholder">IMG</span>;
}

function EasingPreview({ curve, compact = false }: { curve: EasingCurve; compact?: boolean }) {
  const x1 = 8 + curve.outX * 80; const y1 = 88 - curve.outY * 80; const x2 = 8 + curve.inX * 80; const y2 = 88 - curve.inY * 80;
  return <svg className={compact ? "easing-preview compact" : "easing-preview"} viewBox="0 0 96 96" role="img" aria-label={`贝塞尔曲线 ${curve.outX.toFixed(2)}, ${curve.outY.toFixed(2)}, ${curve.inX.toFixed(2)}, ${curve.inY.toFixed(2)}`}>
    <path className="easing-grid" d="M8 8V88H88" />
    <path className="easing-handle" d={`M8 88L${x1} ${y1}M${x2} ${y2}L88 8`} />
    <path className="easing-path" d={`M8 88C${x1} ${y1} ${x2} ${y2} 88 8`} />
    <circle className="easing-point" cx={x1} cy={y1} r="3" /><circle className="easing-point" cx={x2} cy={y2} r="3" />
  </svg>;
}

function CubeLogo() {
  return <img className="brand-logo" src={`${PUBLIC_BASE_PATH}/jsonable-logo-v2.png`} alt="" aria-hidden="true" />;
}

function ActionIcon({ name }: { name: "upload" | "compress" | "download" }) {
  if (name === "upload") return <svg className="action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" /></svg>;
  if (name === "compress") return <svg className="action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 3v5H3m13-5v5h5M8 21v-5H3m13 5v-5h5M8 8 4 4m12 4 4-4M8 16l-4 4m12-4 4 4" /></svg>;
  return <svg className="action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M5 20h14" /></svg>;
}

function CompressionResultWindow({ mode, result, sampling, frames = [], onSamplingChange, onDownload, onDotLottie }: { mode: "normal" | "advanced"; result: CompressionResult; sampling?: FrameSamplingSetting; frames?: SequenceFrameOption[]; onSamplingChange?(next: FrameSamplingSetting): void; onDownload(): void; onDotLottie?(): void }) {
  const advanced = mode === "advanced";
  const [framePickerCollapsed, setFramePickerCollapsed] = useState(false);
  const activeSampling = sampling ?? { enabled: false, method: "half" as FrameSamplingMethod, selectedFrames: [] };
  const samplingAvailable = advanced && frames.length > 0;
  const sampledFrames = advanced && result.optimizations.some((item) => item.key === "sequence-frame-sampling" && item.count > 0);
  const selected = new Set(activeSampling.selectedFrames);
  const chooseFrames = (next: number[]) => onSamplingChange?.({ ...activeSampling, selectedFrames: [...new Set(next)].sort((a, b) => a - b) });
  const changeMethod = (method: FrameSamplingMethod) => {
    if (method === "custom") setFramePickerCollapsed(false);
    onSamplingChange?.({ ...activeSampling, method, selectedFrames: method === "custom" && !activeSampling.selectedFrames.length ? frames.map((frame) => frame.index) : activeSampling.selectedFrames });
  };
  const toggleFrame = (index: number) => {
    if (selected.has(index) && selected.size === 1) return;
    chooseFrames(selected.has(index) ? activeSampling.selectedFrames.filter((item) => item !== index) : [...activeSampling.selectedFrames, index]);
  };
  return <section className={advanced ? "compression-result-window advanced" : "compression-result-window"}>
    <div className="result-window-head"><div><span>{advanced ? "ADVANCED OPTIMIZATION" : "STANDARD MINIFY"}</span><h4>{advanced ? "高级压缩" : "普通压缩"}{advanced && <b>PRO</b>}{advanced && <b className="sampling-badge">支持抽帧</b>}{sampledFrames && <b className="lossy-badge">有损抽帧</b>}</h4></div><strong>-{result.percentage.toFixed(1)}%</strong></div>
    <div className="result-size-row"><span><small>压缩前</small>{formatBytes(result.originalSize)}</span><i>→</i><span><small>压缩后</small>{formatBytes(result.compressedSize)}</span></div>
    {advanced && <><div className="frame-sampling-title"><div><strong>高级压缩抽帧</strong><small>预设方法和具体帧选择均可设置</small></div><span>可选</span></div>
    <div className="frame-sampling-options"><label><input type="checkbox" checked={activeSampling.enabled} disabled={!samplingAvailable} onChange={(event) => onSamplingChange?.({ ...activeSampling, enabled: event.target.checked })} /><span>启用序列帧抽帧<small>{samplingAvailable ? "只减少图片帧，不改变原始帧率和时长" : "当前文件未识别到序列帧动画"}</small></span></label><select value={activeSampling.method} disabled={!samplingAvailable || !activeSampling.enabled} onChange={(event) => changeMethod(event.target.value as FrameSamplingMethod)} aria-label="高级压缩抽帧方法"><option value="half">均匀保留 1/2</option><option value="third">均匀保留 1/3</option><option value="fps12">每秒最多保留 12 张</option><option value="fps8">每秒最多保留 8 张</option><option value="custom">自定义选择具体帧</option></select></div>
    {activeSampling.enabled && activeSampling.method === "custom" && samplingAvailable && !framePickerCollapsed && <div className="frame-picker"><div className="frame-picker-toolbar"><span>已保留 {selected.size || frames.length} / {frames.length} 张图片</span><div><button onClick={() => chooseFrames(frames.map((frame) => frame.index))}>全选</button><button onClick={() => chooseFrames(frames.filter((_, index) => index % 2 === 0).map((frame) => frame.index))}>隔帧</button><button onClick={() => chooseFrames(frames.filter((frame) => !selected.has(frame.index)).map((frame) => frame.index).slice(0).length ? frames.filter((frame) => !selected.has(frame.index)).map((frame) => frame.index) : [frames[0].index])}>反选</button><button onClick={() => chooseFrames([frames[0].index])}>仅首帧</button><button className="frame-picker-done" onClick={() => setFramePickerCollapsed(true)}>完成选帧</button></div></div><div className="frame-picker-grid">{frames.map((frame) => <button key={frame.index} type="button" className={selected.has(frame.index) ? "selected" : ""} aria-pressed={selected.has(frame.index)} onClick={() => toggleFrame(frame.index)}>{frame.preview ? <img src={frame.preview} alt="" /> : <span className="frame-placeholder">{String(frame.index + 1).padStart(3, "0")}</span>}<span><b>F{String(frame.index + 1).padStart(3, "0")}</b><small>{frame.time.toFixed(2)}s</small></span></button>)}</div></div>}
    {activeSampling.enabled && activeSampling.method === "custom" && samplingAvailable && framePickerCollapsed && <div className="frame-picker-collapsed"><span>已完成选帧，保留 {selected.size || frames.length} 张独立图片</span><button onClick={() => setFramePickerCollapsed(false)}>继续选择</button></div>}</>}
    <div className="result-work-list"><div><span>完成的处理</span><b>{result.optimizations.reduce((sum, item) => sum + item.count, 0)} 处</b></div>{result.optimizations.map((item) => <article key={item.key}><span>{String(item.count).padStart(2, "0")}</span><div><strong>{item.title}</strong><p>{item.description}</p>{item.examples.length > 0 && <ul>{item.examples.map((example) => <li key={example}><code>{example}</code></li>)}</ul>}</div></article>)}</div>
    <div className="result-downloads" data-testid={`${mode}-download-actions`}><button className="result-download" onClick={onDownload} data-testid={`${mode}-download-json`}><ActionIcon name="download" /><span>{advanced && activeSampling.enabled && activeSampling.method === "custom" ? "确认并下载 JSON" : "下载 JSON"}</span></button>{advanced && onDotLottie && <button className="result-download dotlottie" onClick={onDotLottie}><span className="dotlottie-mark">.L</span><span>导出 dotLottie</span></button>}</div>
  </section>;
}

const CUBE_FACES = ["front", "back", "right", "left", "top", "bottom"];

function MagicCube({ compact = false, orthographic = false }: { compact?: boolean; orthographic?: boolean }) {
  const cubeRef = useRef<HTMLDivElement>(null);
  const motion = useRef({ x: -22, y: 28, targetX: -22, targetY: 28, interacted: false, lastTime: 0 });
  useEffect(() => {
    if (orthographic) {
      if (cubeRef.current) cubeRef.current.style.transform = "rotateX(-26deg) rotateY(45deg)";
      return;
    }
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
  }, [orthographic]);
  const followPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect(); const nx = ((event.clientX - rect.left) / rect.width - .5) * 2; const ny = ((event.clientY - rect.top) / rect.height - .5) * 2;
    motion.current.interacted = true; motion.current.targetX = -18 - ny * 24; motion.current.targetY = 28 + nx * 62;
  };
  return <div className={`${compact ? "cube-scene compact" : "cube-scene"}${orthographic ? " orthographic" : ""}`} onPointerMove={orthographic ? undefined : followPointer} aria-label={orthographic ? "正交视角的 Jsonable 魔方" : "跟随鼠标约一秒无回弹缓动旋转的 Jsonable 魔方视觉"} role="img">
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

const LANDING_CUBIES = Array.from({ length: 27 }, (_, index) => {
  const x = index % 3 - 1;
  const y = Math.floor(index / 3) % 3 - 1;
  const z = Math.floor(index / 9) - 1;
  return { x, y, z, key: `${x}:${y}:${z}`, tone: Math.abs(x * 7 + y * 5 + z * 3) % 4 };
});

const SCATTER_POSITIONS = [
  [-108, -64, 0], [-20, -88, 0], [97, -59, 0],
  [-126, -2, 0], [2, -7, 0], [123, 8, 0],
  [-92, 69, 0], [15, 85, 0], [105, 62, 0],
] as const;

const SCATTER_PALETTE = ["#54d2ae", "#82e6c7", "#dfe9e5", "#2b9a79", "#62a7d8", "#d887b5", "#e08b67"];
const initialScatterColors = () => SCATTER_POSITIONS.map((_, index) => SCATTER_PALETTE[index % 4]);

function LandingCubie({ x, y, z, tone }: Omit<(typeof LANDING_CUBIES)[number], "key">) {
  return <div className={`twist-cubie tone-${tone}`} style={{ "--tx": `${x * 38 - 17}px`, "--ty": `${y * 38 - 17}px`, "--tz": `${z * 38}px` } as CSSProperties}>
    <span className={z === 1 ? "cubie-face cubie-front painted" : "cubie-face cubie-front"} />
    <span className={z === -1 ? "cubie-face cubie-back painted" : "cubie-face cubie-back"} />
    <span className={x === 1 ? "cubie-face cubie-right painted" : "cubie-face cubie-right"} />
    <span className={x === -1 ? "cubie-face cubie-left painted" : "cubie-face cubie-left"} />
    <span className={y === -1 ? "cubie-face cubie-top painted" : "cubie-face cubie-top"} />
    <span className={y === 1 ? "cubie-face cubie-bottom painted" : "cubie-face cubie-bottom"} />
  </div>;
}

function SharedLandingCube({ step }: { step: number }) {
  // Opacity on a CSS 3D ancestor flattens the subtree in Chromium and can flash
  // one face. Both scenes stay mounted and exchange with preserve-3d transforms.
  const sequenceRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<HTMLDivElement>(null);
  const pointerMotion = useRef({ x: -22, y: 28, targetX: -22, targetY: 28, interacted: false, lastTime: 0 });
  const twistGesture = useRef<{ active: boolean; pointerId: number; startX: number; startY: number; axis: "horizontal" | "vertical" | null; angle: number }>({ active: false, pointerId: -1, startX: 0, startY: 0, axis: null, angle: 0 });
  const twistTimer = useRef<number | null>(null);
  const previousStep = useRef(step);
  const [scatterColors, setScatterColors] = useState(initialScatterColors);
  useEffect(() => {
    const lastStep = previousStep.current;
    previousStep.current = step;
    if (lastStep === 2 && step === 0) setScatterColors(initialScatterColors());
  }, [step]);
  useEffect(() => () => {
    if (twistTimer.current !== null) window.clearTimeout(twistTimer.current);
  }, []);
  useEffect(() => {
    pointerMotion.current.interacted = false;
    pointerMotion.current.targetX = -22;
    pointerMotion.current.targetY = 28;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const animate = (time: number) => {
      const motion = pointerMotion.current;
      if (step === 0 && !motion.interacted) {
        motion.targetX = -22 + Math.sin(time / 1900) * 5;
        motion.targetY = 28 + Math.sin(time / 2600) * 12;
      } else if (step !== 0) {
        motion.targetX = -22;
        motion.targetY = 28;
      }
      const delta = motion.lastTime ? Math.min(40, time - motion.lastTime) : 16.67;
      motion.lastTime = time;
      const ease = 1 - Math.exp(-delta / 650);
      motion.x += (motion.targetX - motion.x) * ease;
      motion.y += (motion.targetY - motion.y) * ease;
      rigRef.current?.style.setProperty("--sequence-rx", `${motion.x.toFixed(2)}deg`);
      rigRef.current?.style.setProperty("--sequence-ry", `${motion.y.toFixed(2)}deg`);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [step]);
  const followPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (step !== 0 || event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width - .5) * 2;
    const ny = ((event.clientY - rect.top) / rect.height - .5) * 2;
    pointerMotion.current.interacted = true;
    pointerMotion.current.targetX = -18 - ny * 24;
    pointerMotion.current.targetY = 28 + nx * 62;
  };
  const clearManualTwist = () => {
    const root = sequenceRef.current;
    if (!root) return;
    root.classList.remove("is-manual-twist", "is-settling-twist");
    root.querySelectorAll<HTMLElement>(".cube-model").forEach((model) => model.style.removeProperty("visibility"));
    root.querySelectorAll<HTMLElement>(".cube-turning-layer").forEach((layer) => layer.style.removeProperty("transform"));
  };
  useEffect(() => {
    if (step === 1) return;
    twistGesture.current.active = false;
    clearManualTwist();
  }, [step]);
  const beginManualTwist = (event: React.PointerEvent<HTMLDivElement>) => {
    if (step !== 1) return;
    if (twistTimer.current !== null) window.clearTimeout(twistTimer.current);
    clearManualTwist();
    twistGesture.current = { active: true, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, axis: null, angle: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveManualTwist = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = twistGesture.current;
    if (!gesture.active || gesture.pointerId !== event.pointerId || step !== 1) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.axis && Math.hypot(deltaX, deltaY) < 7) return;
    if (!gesture.axis) gesture.axis = Math.abs(deltaX) >= Math.abs(deltaY) ? "horizontal" : "vertical";
    const root = sequenceRef.current;
    if (!root) return;
    root.classList.add("is-manual-twist");
    const horizontalModel = root.querySelector<HTMLElement>(".cube-model-horizontal");
    const verticalModel = root.querySelector<HTMLElement>(".cube-model-vertical");
    const horizontalLayer = root.querySelector<HTMLElement>(".horizontal-layer");
    const verticalLayer = root.querySelector<HTMLElement>(".vertical-layer");
    if (gesture.axis === "horizontal") {
      gesture.angle = Math.max(-100, Math.min(100, deltaX * .72));
      if (horizontalModel) horizontalModel.style.visibility = "visible";
      if (verticalModel) verticalModel.style.visibility = "hidden";
      if (horizontalLayer) horizontalLayer.style.transform = `rotateY(${gesture.angle.toFixed(2)}deg)`;
    } else {
      gesture.angle = Math.max(-100, Math.min(100, -deltaY * .72));
      if (horizontalModel) horizontalModel.style.visibility = "hidden";
      if (verticalModel) verticalModel.style.visibility = "visible";
      if (verticalLayer) verticalLayer.style.transform = `rotateX(${gesture.angle.toFixed(2)}deg)`;
    }
  };
  const endManualTwist = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = twistGesture.current;
    if (!gesture.active || gesture.pointerId !== event.pointerId) return;
    gesture.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const root = sequenceRef.current;
    if (!root || !gesture.axis) {
      clearManualTwist();
      return;
    }
    root.classList.add("is-settling-twist");
    const target = Math.abs(gesture.angle) >= 22 ? Math.sign(gesture.angle) * 90 : 0;
    const layer = root.querySelector<HTMLElement>(gesture.axis === "horizontal" ? ".horizontal-layer" : ".vertical-layer");
    if (layer) layer.style.transform = `${gesture.axis === "horizontal" ? "rotateY" : "rotateX"}(${target}deg)`;
    twistTimer.current = window.setTimeout(clearManualTwist, 460);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    followPointer(event);
    moveManualTwist(event);
  };
  const randomizeScatterColor = (index: number) => {
    setScatterColors((current) => current.map((color, colorIndex) => {
      if (colorIndex !== index) return color;
      const choices = SCATTER_PALETTE.filter((candidate) => candidate !== color);
      return choices[Math.floor(Math.random() * choices.length)];
    }));
  };
  const activateScatterAtPoint = (clientX: number, clientY: number) => {
    if (step !== 2 || !sequenceRef.current) return;
    let selectedIndex = -1;
    let selectedDistance = Number.POSITIVE_INFINITY;
    sequenceRef.current.querySelectorAll<HTMLElement>(".scatter-cube").forEach((cube) => {
      const frontFace = cube.querySelector<HTMLElement>(".scatter-front");
      const rect = (frontFace ?? cube).getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = Math.hypot(clientX - centerX, clientY - centerY);
      if (distance < selectedDistance) {
        selectedDistance = distance;
        selectedIndex = Number(cube.dataset.scatterIndex);
      }
    });
    // 3D faces overlap in screen space, especially on the right column. The
    // nearest projected center gives every visible cube one stable hit area.
    if (selectedIndex >= 0 && selectedDistance <= 64) randomizeScatterColor(selectedIndex);
  };
  return <div
    className={`landing-cube-sequence sequence-step-${step}`}
    ref={sequenceRef}
    onPointerDown={beginManualTwist}
    onPointerMove={handlePointerMove}
    onPointerUp={endManualTwist}
    onPointerCancel={endManualTwist}
  >
    <div className="sequence-rig-fade" aria-hidden="true">
      <div className="sequence-rig" ref={rigRef}>
        <div className="sequence-model">
          <div className="cube-model cube-model-horizontal">
            <div className="cube-fixed-layers">{LANDING_CUBIES.filter((cubie) => cubie.y !== -1).map(({ key, ...cubie }) => <LandingCubie key={key} {...cubie} />)}</div>
            <div className="cube-turning-layer horizontal-layer">{LANDING_CUBIES.filter((cubie) => cubie.y === -1).map(({ key, ...cubie }) => <LandingCubie key={key} {...cubie} />)}</div>
          </div>
          <div className="cube-model cube-model-vertical">
            <div className="cube-fixed-layers">{LANDING_CUBIES.filter((cubie) => cubie.x !== 1).map(({ key, ...cubie }) => <LandingCubie key={key} {...cubie} />)}</div>
            <div className="cube-turning-layer vertical-layer">{LANDING_CUBIES.filter((cubie) => cubie.x === 1).map(({ key, ...cubie }) => <LandingCubie key={key} {...cubie} />)}</div>
          </div>
        </div>
      </div>
    </div>
    <div className="scatter-fade" aria-hidden={step !== 2}>
      <div className="scatter-field">
        {SCATTER_POSITIONS.map(([x, y, z], index) => <button
          key={index}
          type="button"
          className="scatter-cube"
          data-scatter-index={index}
          aria-label={`改变第 ${index + 1} 个立方体颜色`}
          tabIndex={step === 2 ? 0 : -1}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (step === 2) randomizeScatterColor(index);
          }}
          style={{ "--scatter-x": `${x}px`, "--scatter-y": `${y}px`, "--scatter-z": `${z}px`, "--scatter-color": scatterColors[index], "--scatter-delay": `${index * 55}ms` } as CSSProperties}
        >
          <span className="scatter-face scatter-front" />
          <span className="scatter-face scatter-back" />
          <span className="scatter-face scatter-right" />
          <span className="scatter-face scatter-left" />
          <span className="scatter-face scatter-top" />
          <span className="scatter-face scatter-bottom" />
        </button>)}
      </div>
    </div>
    <div
      className="scatter-interaction-layer"
      aria-hidden="true"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => {
        event.stopPropagation();
        activateScatterAtPoint(event.clientX, event.clientY);
      }}
    />
  </div>;
}

function LandingGuideVisual({ step }: { step: number }) {
  const labels = [
    "完整的 Jsonable 魔方等待上传",
    "同一个魔方依次横向和纵向拧动",
    "魔方自然散开为九个可点击改色的漂浮立方体",
  ];
  return <div className="landing-guide-visual sequence-visual" role="group" aria-label={labels[step]}>
    <SharedLandingCube step={step} />
    {step === 1 && <span className="twist-hint">按住魔方，横向或纵向拖动</span>}
    {step === 2 && <span className="twist-hint">点击可改变颜色</span>}
  </div>;
}

function VisualPreview({ data, colors, shapes, images, isDefault, highlightElementIds = [], highlightLabel = "" }: { data: unknown; colors: ColorInfo[]; shapes: ShapeInfo[]; images: ImageInfo[]; isDefault: boolean; highlightElementIds?: string[]; highlightLabel?: string }) {
  if (isDefault) return <div className="token-stage default-cube-stage"><MagicCube /></div>;
  const items = shapes.flatMap((shape) => Array.from({ length: Math.min(shape.count, 6) }, () => shape)).slice(0, 24);
  if (isLottie(data)) return <LottiePreview data={data} highlightElementIds={highlightElementIds} highlightLabel={highlightLabel} />;
  const object = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const canvas = object.canvas && typeof object.canvas === "object" ? object.canvas as Record<string, unknown> : {};
  const canvasBackground = typeof canvas.background === "string" ? parseCssColor(canvas.background) : null;
  return <div className="token-stage" style={{ background: canvasBackground || "#101513" }}>
    {images.slice(0, 8).map((item) => <div className="preview-image" key={item.id}><ImageThumb source={item.preview} label={item.name} /><small>{item.name}</small></div>)}
    {items.map((item, index) => <div className="preview-object" key={`${item.name}-${index}`} style={{ color: colors[index % Math.max(colors.length, 1)]?.hex || "#54D2AE" }}><ComposedMark /><small>{item.name}</small></div>)}
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
  const [hasUploadedFile, setHasUploadedFile] = useState(false);
  const [fileName, setFileName] = useState("summer-campaign.json");
  const [activeTab, setActiveTab] = useState<"colors" | "shapes" | "images" | "easing">("colors");
  const [selectedShape, setSelectedShape] = useState("");
  const [selectedImage, setSelectedImage] = useState("");
  const [selectedEasing, setSelectedEasing] = useState("");
  const [easingDraft, setEasingDraft] = useState<EasingCurve | null>(null);
  const [easingDetailOpen, setEasingDetailOpen] = useState(false);
  const [selectedEasingCategory, setSelectedEasingCategory] = useState<MotionCategory>("move");
  const [selectedMotionElement, setSelectedMotionElement] = useState("");
  const [uploadedSvg, setUploadedSvg] = useState<UploadedSvg | null>(null);
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);
  const [replacementError, setReplacementError] = useState("");
  const [imageError, setImageError] = useState("");
  const [colorEditor, setColorEditor] = useState<{ current: string; draft: string; count: number } | null>(null);
  const [shapeEditorOpen, setShapeEditorOpen] = useState(false);
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const [batchImageEditorOpen, setBatchImageEditorOpen] = useState(false);
  const [batchUploadedImages, setBatchUploadedImages] = useState<UploadedImage[]>([]);
  const [batchImageTargets, setBatchImageTargets] = useState<string[]>([]);
  const [batchImageMappings, setBatchImageMappings] = useState<Record<string, number>>({});
  const [compressionCountdown, setCompressionCountdown] = useState<number | null>(null);
  const [compressionResult, setCompressionResult] = useState<CompressionResults | null>(null);
  const [compressionReportOpen, setCompressionReportOpen] = useState(false);
  const [compressionSampling, setCompressionSampling] = useState<CompressionSamplingSettings>({ advanced: { enabled: false, method: "half", selectedFrames: [] } });
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
  const batchImageFileRef = useRef<HTMLInputElement>(null);
  const unifiedFileRef = useRef<HTMLInputElement>(null);
  const versionsRef = useRef<EditVersion[]>([]);
  const versionIndexRef = useRef(-1);
  const colors = useMemo(() => scanColors(data), [data]);
  const shapes = useMemo(() => scanShapes(data), [data]);
  const images = useMemo(() => scanImages(data), [data]);
  const easings = useMemo(() => scanEasings(data), [data]);
  const motionElements = useMemo(() => {
    const elements = new Map<string, MotionElement>();
    easings.forEach((profile) => profile.elements.forEach((element) => elements.set(element.id, element)));
    return [...elements.values()];
  }, [easings]);
  const easingCategoryCounts = useMemo(() => Object.fromEntries(EASING_CATEGORIES.map((category) => [category.id, easings.filter((profile) => profile.category === category.id).length])) as Record<MotionCategory, number>, [easings]);
  const filteredEasings = useMemo(() => easings.filter((profile) => profile.category === selectedEasingCategory && (!selectedMotionElement || profile.elements.some((element) => element.id === selectedMotionElement))), [easings, selectedEasingCategory, selectedMotionElement]);
  const jsonText = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const sequenceFrameInspection = useMemo(() => inspectSequenceFrames(data), [data]);
  const sequenceSamplingAvailable = sequenceFrameInspection.matched;
  const buildCompressionResults = useCallback((settings: CompressionSamplingSettings): CompressionResults => {
    const originalSize = new Blob([jsonText]).size;
    const normalText = JSON.stringify(data); const normalSize = new Blob([normalText]).size; const normalPercentage = originalSize ? Math.max(0, (1 - normalSize / originalSize) * 100) : 0;
    const normalOptimizations: OptimizationItem[] = [{ key: "whitespace", title: "移除格式空白", description: "仅删除缩进、换行与多余空格，不改变字段与数值。", count: 1, examples: [`整份文件 · 减少 ${formatBytes(Math.max(0, originalSize - new Blob([JSON.stringify(data)]).size))}`] }];
    const advancedSample = settings.advanced.enabled ? sampleSequenceFrames(data, settings.advanced.method, settings.advanced.selectedFrames) : { data: clone(data), matched: sequenceSamplingAvailable, optimization: null };
    const optimized = optimizeJson(advancedSample.data, JSON.stringify(advancedSample.data, null, 2));
    if (advancedSample.optimization) optimized.optimizations.unshift(advancedSample.optimization);
    let advancedText = optimized.text;
    if (settings.advanced.enabled && isLottie(data)) {
      const optimizedData = JSON.parse(advancedText) as Record<string, unknown>;
      const sourceRoot = data as Record<string, unknown>;
      (["fr", "ip", "op"] as const).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(sourceRoot, key)) optimizedData[key] = sourceRoot[key];
        else delete optimizedData[key];
      });
      advancedText = JSON.stringify(optimizedData);
    }
    const advancedSize = new Blob([advancedText]).size; const advancedPercentage = originalSize ? Math.max(0, (1 - advancedSize / originalSize) * 100) : 0;
    return {
      normal: { text: normalText, originalSize, compressedSize: normalSize, percentage: normalPercentage, optimizations: normalOptimizations },
      advanced: { text: advancedText, originalSize, compressedSize: advancedSize, percentage: advancedPercentage, optimizations: optimized.optimizations },
    };
  }, [data, jsonText, sequenceSamplingAvailable]);
  const updateCompressionSampling = (next: FrameSamplingSetting) => {
    const settings = { advanced: next };
    setCompressionSampling(settings);
    if (compressionResult) setCompressionResult(buildCompressionResults(settings));
  };
  const selectedVersionIndex = versions.findIndex((version) => version.id === selectedVersionId);
  const selectedVersion = selectedVersionIndex >= 0 ? versions[selectedVersionIndex] : versions[versionIndex];
  const selectedDiff = useMemo(() => {
    const index = versions.findIndex((version) => version.id === selectedVersion?.id); if (index <= 0) return [];
    return diffJson(versions[index - 1].data, versions[index].data);
  }, [versions, selectedVersion?.id]);
  useEffect(() => {
    clearLegacyDraft();
  }, []);
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
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setCompressionCountdown(null); setCompressionResult(null); setCompressionReportOpen(false);
    });
    return () => { active = false; };
  }, [data]);
  useEffect(() => {
    if (compressionCountdown === null) return;
    const timer = window.setTimeout(() => {
      if (compressionCountdown > 0) {
        setCompressionCountdown((current) => current === null ? null : current - 1);
        return;
      }
      setCompressionResult(buildCompressionResults(compressionSampling)); setCompressionCountdown(null); setCompressionReportOpen(true);
      setToast(`一键压缩完成：已生成普通版和高级版`);
    }, compressionCountdown > 0 ? 1000 : 0);
    return () => window.clearTimeout(timer);
  }, [compressionCountdown, compressionSampling, buildCompressionResults]);
  useEffect(() => {
    if (!colorEditor && !shapeEditorOpen && !imageEditorOpen && !batchImageEditorOpen && !historyOpen && !compressionReportOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setColorEditor(null); setShapeEditorOpen(false); setImageEditorOpen(false); setBatchImageEditorOpen(false); setHistoryOpen(false); setCompressionReportOpen(false);
    };
    document.body.style.overflow = "hidden"; window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [colorEditor, shapeEditorOpen, imageEditorOpen, batchImageEditorOpen, historyOpen, compressionReportOpen]);
  const activeShape = shapes.find((item) => `${item.mode}:${item.name}` === selectedShape) || shapes[0];
  const activeImage = images.find((item) => item.id === selectedImage) || images[0];
  const activeEasing = filteredEasings.find((item) => item.id === selectedEasing) || filteredEasings[0];
  const easingEditorCurve = easingDraft || activeEasing || EASING_PRESETS[1].curve;
  const activeEasingCount = activeEasing ? selectedMotionElement ? activeEasing.paths.filter((path) => path.startsWith(selectedMotionElement)).length : activeEasing.count : 0;
  const selectedMotionElementInfo = motionElements.find((element) => element.id === selectedMotionElement);
  const selectedEasingCategoryInfo = EASING_CATEGORIES.find((category) => category.id === selectedEasingCategory)!;
  const motionHighlightElementIds = activeTab !== "easing"
    ? []
    : selectedMotionElement
      ? [selectedMotionElement]
      : selectedEasing && activeEasing
        ? activeEasing.elements.map((element) => element.id)
        : [];
  const motionHighlightLabel = selectedMotionElementInfo?.name
    || (selectedEasing && activeEasing
      ? activeEasing.elements.length > 1
        ? `${activeEasing.elements[0]?.name || "关联素材"}等 ${activeEasing.elements.length} 个元素`
        : activeEasing.elements[0]?.name || "关联素材"
      : "");
  const batchMappedCount = batchImageTargets.filter((targetId) => batchUploadedImages[batchImageMappings[targetId]]).length;
  const tabMeta = activeTab === "colors"
    ? { title: "颜色", english: "COLORS", description: `识别到 ${colors.length} 种颜色，编辑窗口会保持开启。` }
    : activeTab === "shapes"
      ? { title: "预合成与形状", english: "PRECOMPS", description: "优先按 AE 预合成识别，预合成内部不再拆分；未被预合成包裹的命名组合仍可替换。" }
      : activeTab === "images"
        ? { title: "图片资源", english: "IMAGES", description: `识别到 ${images.length} 个图片资源，替换后保留原图层布局与动画。` }
        : easingDetailOpen
          ? { title: `编辑${selectedEasingCategoryInfo.label}曲线`, english: "CURVE DETAIL", description: selectedMotionElementInfo ? `当前只调整「${selectedMotionElementInfo.name}」中的${selectedEasingCategoryInfo.label}关键帧。` : `当前调整所有使用这组${selectedEasingCategoryInfo.label}曲线的关键帧。` }
          : { title: "动效曲线", english: "EASING", description: `识别到 ${easings.length} 组加速度曲线，可按动画属性和元素筛选。` };

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
    versionIndexRef.current = nextIndex; setVersionIndex(nextIndex); setSelectedVersionId(nextVersion.id); setData(clone(nextVersion.data)); setToast(`${action === "undo" ? "已撤销" : "已重做"}：${nextVersion.label}`);
  };
  const undoEdit = () => applyHistoryIndex(versionIndexRef.current - 1, "undo");
  const redoEdit = () => applyHistoryIndex(versionIndexRef.current + 1, "redo");
  const restoreOriginal = () => { if (commitEdit(clone(originalData), "恢复原始文件")) setToast("已恢复原始文件，可继续撤销"); };
  const openHistory = () => { setSelectedVersionId(versionsRef.current[versionIndexRef.current]?.id || ""); setHistoryOpen(true); };
  const restoreSelectedVersion = () => {
    if (!selectedVersion) return; const label = selectedVersion.label;
    if (commitEdit(clone(selectedVersion.data), `恢复版本：${label}`)) { setHistoryOpen(false); setToast(`已恢复到「${label}」`); }
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
      const parsed = JSON.parse(await file.text()); const easingProfiles = scanEasings(parsed); beginDocument(parsed); setHasUploadedFile(true); setFileName(file.name); setError(""); setMediaConversion(null); setMediaConversionError(""); setSelectedShape(""); setSelectedImage(""); setSelectedEasing(""); setEasingDraft(null); setEasingDetailOpen(false); setSelectedEasingCategory(easingProfiles[0]?.category || "move"); setSelectedMotionElement(""); setUploadedSvg(null); setUploadedImage(null); setBatchUploadedImages([]); setBatchImageTargets([]); setBatchImageMappings({}); setShapeEditorOpen(false); setImageEditorOpen(false); setBatchImageEditorOpen(false);
      const foundColors = scanColors(parsed).length; const foundShapes = scanShapes(parsed).length; const foundImages = scanImages(parsed).length; const foundEasings = easingProfiles.length;
      setToast(`识别完成：${foundColors} 种颜色，${foundShapes} 种形状，${foundImages} 个图片资源，${foundEasings} 组动效曲线`);
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
      beginDocument(lottie); setHasUploadedFile(true); setFileName(outputName); setSelectedEasingCategory(scanEasings(lottie)[0]?.category || "move"); setSelectedMotionElement(""); setSelectedEasing(""); setEasingDetailOpen(false); setError("");
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
    if (commitEdit(replaceColor(data, from, next), `替换颜色 ${from} → ${next}`)) { setColorEditor({ ...colorEditor, current: next, draft: next }); setToast(`已替换 ${from} 的全部引用`); }
  };
  const openEasingList = () => {
    const availableCategory = easingCategoryCounts[selectedEasingCategory] ? selectedEasingCategory : easings[0]?.category || "move";
    setActiveTab("easing"); setSelectedEasingCategory(availableCategory); setEasingDetailOpen(false); setSelectedEasing(""); setEasingDraft(null);
  };
  const selectEasingCategory = (category: MotionCategory) => {
    setSelectedEasingCategory(category); setSelectedEasing(""); setEasingDraft(null); setEasingDetailOpen(false);
  };
  const selectMotionElementFilter = (elementId: string) => {
    setSelectedMotionElement(elementId); setSelectedEasing(""); setEasingDraft(null); setEasingDetailOpen(false);
  };
  const selectEasingProfile = (profile: EasingInfo) => {
    setSelectedEasing(profile.id); setEasingDraft({ outX: profile.outX, outY: profile.outY, inX: profile.inX, inY: profile.inY }); setEasingDetailOpen(true);
  };
  const applyEasingCurve = (curve: EasingCurve, label = "自定义") => {
    if (!activeEasing) return;
    const normalized = Object.fromEntries(Object.entries(curve).map(([key, value]) => [key, Math.max(0, Math.min(1, Number(value.toFixed(2))))])) as EasingCurve;
    const scopeLabel = selectedMotionElementInfo ? `「${selectedMotionElementInfo.name}」` : "全部关联元素";
    const targetPaths = new Set(selectedMotionElement ? activeEasing.paths.filter((path) => path.startsWith(selectedMotionElement)) : activeEasing.paths);
    if (commitEdit(replaceEasing(data, activeEasing, normalized, targetPaths), `调整${scopeLabel}${selectedEasingCategoryInfo.label}曲线「${label}」`)) {
      setSelectedEasing(`${activeEasing.category}:${easingSignature(normalized)}`); setEasingDraft(normalized); setToast(`已更新 ${activeEasingCount} 个${selectedEasingCategoryInfo.label}关键帧，应用范围：${scopeLabel}`);
    }
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
    if (commitEdit(replaceImageResource(data, target, uploadedImage.dataUrl), `替换图片「${target.name}」`)) { setImageError(""); setToast(`已替换 ${target.count} 个「${target.name}」图片引用`); }
  };
  const openBatchImageEditor = () => {
    setBatchImageTargets(images.map((item) => item.id)); setBatchUploadedImages([]); setBatchImageMappings({}); setImageError(""); setBatchImageEditorOpen(true);
  };
  const loadBatchImageReplacements = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files || [])]; event.target.value = ""; if (!files.length) return;
    try {
      if (!files.every((file) => /^image\/(png|jpeg|webp|gif)$/i.test(file.type))) throw new Error("UNSUPPORTED_IMAGE");
      const loaded = await Promise.all(files.map(readImageFile));
      const normalizeName = (value: string) => value.split("/").pop()?.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "") || "";
      const mappings: Record<string, number> = {};
      images.forEach((target, targetIndex) => {
        const targetNames = [target.name, target.value].map(normalizeName).filter(Boolean);
        const matched = loaded.findIndex((item) => targetNames.includes(normalizeName(item.fileName)));
        mappings[target.id] = matched >= 0 ? matched : loaded.length === 1 ? 0 : targetIndex < loaded.length ? targetIndex : -1;
      });
      setBatchUploadedImages(loaded); setBatchImageMappings(mappings); setImageError(""); setToast(`已读取 ${loaded.length} 张图片，请核对替换关系`);
    } catch { setImageError("批量上传仅支持 PNG、JPG、WebP 或 GIF 文件。"); }
  };
  const toggleBatchImageTarget = (targetId: string) => {
    setBatchImageTargets((current) => current.includes(targetId) ? current.filter((id) => id !== targetId) : [...current, targetId]);
  };
  const applyBatchImageReplacement = () => {
    const replacements = batchImageTargets.flatMap((targetId) => {
      const target = images.find((item) => item.id === targetId); const replacement = batchUploadedImages[batchImageMappings[targetId]];
      return target && replacement ? [{ target, replacement }] : [];
    });
    if (!replacements.length) { setImageError("请至少选择一个图片资源并为它指定新图片。"); return; }
    const nextData = replacements.reduce<unknown>((current, item) => replaceImageResource(current, item.target, item.replacement.dataUrl), data);
    const referenceCount = replacements.reduce((sum, item) => sum + item.target.count, 0);
    if (commitEdit(nextData, `批量替换 ${replacements.length} 个图片资源`)) {
      setImageError(""); setBatchImageEditorOpen(false); setToast(`已批量替换 ${replacements.length} 个资源，共 ${referenceCount} 个引用`);
    }
  };
  const changeShapeFromUpload = (from: ShapeInfo) => {
    if (!uploadedSvg) return;
    if (from.mode === "reference") { setReplacementError("当前目标只是外部引用，无法写入 SVG 路径。请选择组合、组件或 Lottie 图层。"); return; }
    const group = clone(uploadedSvg.group); group.nm = from.name; group.__jsonableSvg = true;
    const template = from.mode === "lottie-group" ? group : from.mode === "lottie-layer" || from.mode === "lottie-precomp"
      ? { ty: 4, nm: from.name, shapes: [group], ks: {}, ip: 0, op: 1, st: 0, __jsonableSvg: true }
      : { name: from.name, componentName: from.name, type: "svg", svg: uploadedSvg.raw, items: [group], __jsonableSvg: true };
    if (commitEdit(replaceSingleShape(data, from, from.name, template), `替换当前形状「${from.name}」`)) { setReplacementError(""); setToast(`已使用 ${uploadedSvg.fileName} 替换当前「${from.name}」`); }
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
    setData(SAMPLE); setOriginalData(SAMPLE); setHasUploadedFile(false); setFileName("summer-campaign.json"); setActiveTab("colors"); setSelectedShape(""); setSelectedImage(""); setSelectedEasing(""); setEasingDraft(null); setEasingDetailOpen(false); setSelectedEasingCategory("move"); setSelectedMotionElement(""); setUploadedSvg(null); setUploadedImage(null); setBatchUploadedImages([]); setBatchImageTargets([]); setBatchImageMappings({}); setColorEditor(null); setShapeEditorOpen(false); setImageEditorOpen(false); setBatchImageEditorOpen(false); setHistoryOpen(false); setCompressionReportOpen(false); setCompressionCountdown(null); setCompressionResult(null); setCompressionSampling({ advanced: { enabled: false, method: "half", selectedFrames: [] } }); setMediaConversion(null); setMediaConversionError(""); setError(""); setLandingStep(0); setLandingCycle((current) => current + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return <main>
    <header className="topbar">
      <button className="brand" type="button" onClick={goHome} aria-label="返回 Jsonable 首页"><CubeLogo /><span>Jsonable</span></button>
      <div className="top-actions"><span className="privacy"><span className="privacy-dot" />文件仅在本地处理，不保存</span>
        {hasUploadedFile && <button className="button button-ghost action-button" onClick={() => unifiedFileRef.current?.click()} disabled={mediaConverting}><ActionIcon name="upload" /><span>{mediaConverting ? "正在转换" : "更换文件"}</span></button>}
        <button className="button button-ghost action-button" disabled={!hasUploadedFile || compressionCountdown !== null} title={!hasUploadedFile ? "上传 JSON 后可使用一键压缩" : undefined} onClick={() => { setCompressionResult(null); setCompressionReportOpen(false); setCompressionCountdown(3); }}><ActionIcon name="compress" /><span>{compressionCountdown !== null ? `压缩中 ${compressionCountdown}` : "一键压缩"}</span></button>
        <button className="button button-dark action-button" onClick={download} disabled={!hasUploadedFile} title={!hasUploadedFile ? "上传文件后可下载 JSON" : undefined}><span>{mediaConversion ? "下载转换 JSON" : "下载 JSON"}</span><ActionIcon name="download" /></button>
      </div>
    </header>
    <input ref={unifiedFileRef} type="file" accept="application/json,.json,video/mp4,image/gif,image/apng,image/png,image/jpeg,image/webp,.apng" multiple onChange={unifiedUpload} hidden />
    {!hasUploadedFile ? <section className={isDraggingLanding ? "landing-hero is-dragging" : "landing-hero"} onDragEnter={(event) => { event.preventDefault(); setIsDraggingLanding(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDraggingLanding(false); }} onDrop={dropUnified}>
      <div className="landing-copy">
        <span className="eyebrow">VISUAL JSON EDITOR</span>
        <h1>预览 JSON，<br /><em>编辑 Lottie。</em></h1>
        <p>JSON、MP4、GIF、APNG 与序列帧都可以。媒体文件会先转换成可播放、可编辑的 Lottie JSON。</p>
        <div className="landing-cta">
          <button onClick={() => unifiedFileRef.current?.click()} disabled={mediaConverting}>{mediaConverting ? "正在转换媒体..." : "选择文件"}<span>＋</span></button>
          <div><strong>或把文件拖到页面</strong><small>支持 JSON、视频、动图与多选序列帧</small></div>
          {mediaConversionError && <em>{mediaConversionError}</em>}
        </div>
        <div className="landing-steps" role="tablist" aria-label="Jsonable 使用流程">{LANDING_STEPS.map((item, index) => <button key={`${item.number}-${index === landingStep ? landingCycle : "idle"}`} type="button" role="tab" aria-selected={index === landingStep} className={index === landingStep ? "active" : ""} onClick={() => { setLandingStep(index); setLandingCycle((current) => current + 1); }}><span>{item.number}</span>{item.label}</button>)}</div>
      </div>
      <div className={`landing-visual guide-step-${landingStep}`}><LandingGuideVisual step={landingStep} />{isDraggingLanding && <div className="landing-drop-state">松开开始处理</div>}</div>
    </section> : <section className="editor-context"><div className="file-summary"><span className="eyebrow">NOW EDITING</span><strong>{fileName}</strong><small>{isLottie(data) ? "可播放 Lottie" : "JSON 视觉结构"} · {formatBytes(new Blob([jsonText]).size)} · 仅保留在当前会话</small></div><div className="history-actions"><button onClick={undoEdit} disabled={versionIndex <= 0} title="撤销（⌘/Ctrl + Z）">撤销</button><button onClick={redoEdit} disabled={versionIndex < 0 || versionIndex >= versions.length - 1} title="重做（⌘/Ctrl + Shift + Z）">重做</button><button onClick={restoreOriginal} disabled={versionIndex === 0}>恢复原始</button><button className="history-button" onClick={openHistory}>修改记录 <b>{Math.max(0, versions.length - 1)}</b></button>{compressionResult && <button className="history-button optimization-report-button" onClick={() => setCompressionReportOpen(true)}>压缩结果 <b>2</b></button>}</div></section>}
    {error && <div className="error" role="alert">{error}</div>}
    {hasUploadedFile && <section className="workspace">
      <aside className="rail"><div className="rail-title">已识别</div><button className={activeTab === "colors" ? "rail-item active" : "rail-item"} onClick={() => setActiveTab("colors")}><span className="rail-icon">◒</span><span>颜色<small>Colors</small></span><b>{colors.length}</b></button><button className={activeTab === "shapes" ? "rail-item active" : "rail-item"} onClick={() => setActiveTab("shapes")}><span className="rail-icon">◇</span><span>预合成<small>Precomps</small></span><b>{shapes.length}</b></button><button className={activeTab === "images" ? "rail-item active" : "rail-item"} onClick={() => setActiveTab("images")}><span className="rail-icon">▧</span><span>图片资源<small>Images</small></span><b>{images.length}</b></button><button className={activeTab === "easing" ? "rail-item active" : "rail-item"} onClick={openEasingList}><span className="rail-icon">⌁</span><span>动效曲线<small>Easing</small></span><b>{easings.length}</b></button><div className="rail-note"><span>↗</span><p>支持颜色、预合成、组合矢量、图片资源和关键帧加速度的本地编辑。</p></div></aside>
      <section className="editor-panel"><div className="resource-tabs" role="tablist" aria-label="可替换资源"><button role="tab" aria-selected={activeTab === "colors"} className={activeTab === "colors" ? "active" : ""} onClick={() => setActiveTab("colors")}><span>颜色</span><small>COLORS</small><b>{colors.length}</b></button><button role="tab" aria-selected={activeTab === "shapes"} className={activeTab === "shapes" ? "active" : ""} onClick={() => setActiveTab("shapes")}><span>预合成</span><small>PRECOMPS</small><b>{shapes.length}</b></button><button role="tab" aria-selected={activeTab === "images"} className={activeTab === "images" ? "active" : ""} onClick={() => setActiveTab("images")}><span>图片资源</span><small>IMAGES</small><b>{images.length}</b></button><button role="tab" aria-selected={activeTab === "easing"} className={activeTab === "easing" ? "active" : ""} onClick={openEasingList}><span>动效曲线</span><small>EASING</small><b>{easings.length}</b></button></div><div className="section-head"><div><h2>{tabMeta.title}</h2><span className="en">{tabMeta.english}</span></div><div className="section-head-side"><p>{tabMeta.description}</p>{activeTab === "images" && <button className="batch-replace-trigger" onClick={openBatchImageEditor} disabled={!images.length}>批量替换图片</button>}</div></div>
        {activeTab === "colors" ? <div className="color-grid">{colors.map((color, index) => <article className="color-card" key={color.hex}><div className="swatch" style={{ background: color.hex }}><span>{String(index + 1).padStart(2, "0")}</span></div><div className="color-meta"><label>识别结果</label><strong>{color.hex}</strong><small>{color.label} · {color.count} 个引用</small></div><button className="picker-button" onClick={() => setColorEditor({ current: color.hex, draft: color.hex, count: color.count })}><span className="picker-chip" style={{ background: color.hex }} />选择颜色</button></article>)}{!colors.length && <Empty text="暂未识别到颜色；可切到 JSON 查看原始字段" />}</div> : activeTab === "shapes" ?
        <div className="shape-workbench"><div className="shape-list">{shapes.map((shape) => { const id = `${shape.mode}:${shape.name}`; return <button key={id} className={activeShape && `${activeShape.mode}:${activeShape.name}` === id ? "shape-row selected" : "shape-row"} onClick={() => { setSelectedShape(id); setUploadedSvg(null); setReplacementError(""); setShapeEditorOpen(true); }}><ShapeThumb data={data} shape={shape} /><span><strong>{shape.name}</strong><small>{shapeModeLabel(shape.mode)}</small></span><b>× {shape.count}</b></button>; })}{!shapes.length && <Empty text="暂未识别到 AE 预合成或命名组合；基础形状已自动忽略" />}</div></div> : activeTab === "images" ?
        <div className="image-workbench"><div className="image-list">{images.map((item) => <button key={item.id} className={activeImage?.id === item.id ? "image-row selected" : "image-row"} onClick={() => { setSelectedImage(item.id); setUploadedImage(null); setImageError(""); setImageEditorOpen(true); }}><span className="image-thumb"><ImageThumb source={item.preview} label={item.name} /></span><span><strong>{item.name}</strong><small>{item.mode === "lottie-asset" ? "Lottie 图片资源" : item.key}</small></span><b>× {item.count}</b></button>)}{!images.length && <Empty text="暂未识别到图片资源；支持 Lottie assets 和常见图片地址字段" />}</div></div> :
        <div className={easingDetailOpen ? "easing-workbench detail" : "easing-workbench"}>{easings.length ? easingDetailOpen && activeEasing ? <div className="easing-detail"><div className="easing-detail-nav"><button className="easing-back" onClick={() => { setEasingDetailOpen(false); setSelectedEasing(""); setEasingDraft(null); }}>返回曲线列表</button><span>{selectedEasingCategoryInfo.label} / {selectedEasingCategoryInfo.english}</span></div><div className="easing-scope"><span>应用位置</span><strong>{selectedMotionElementInfo ? selectedMotionElementInfo.name : `${activeEasing.elements.length || 1} 个关联元素`}</strong><div>{(selectedMotionElementInfo ? [selectedMotionElementInfo] : activeEasing.elements).map((element) => <button key={element.id} onClick={() => selectMotionElementFilter(element.id)}>{element.name}</button>)}</div></div><div className="easing-editor"><div className="easing-editor-preview"><EasingPreview curve={easingEditorCurve} /><div><small>CUBIC BEZIER</small><strong>{easingEditorCurve.outX.toFixed(2)}, {easingEditorCurve.outY.toFixed(2)}, {easingEditorCurve.inX.toFixed(2)}, {easingEditorCurve.inY.toFixed(2)}</strong><span>本次将修改 {activeEasingCount} 个{selectedEasingCategoryInfo.label}关键帧</span><code className="easing-source-path">{selectedMotionElement ? activeEasing.paths.find((path) => path.startsWith(selectedMotionElement)) || activeEasing.paths[0] : activeEasing.paths[0]}</code></div></div><div className="easing-presets">{EASING_PRESETS.map((preset) => <button key={preset.name} onClick={() => setEasingDraft(preset.curve)}>{preset.name}</button>)}</div><div className="easing-controls">{(["outX", "outY", "inX", "inY"] as const).map((key) => <label key={key}><span>{key === "outX" ? "出点 X" : key === "outY" ? "出点 Y" : key === "inX" ? "入点 X" : "入点 Y"}<output>{easingEditorCurve[key].toFixed(2)}</output></span><input type="range" min="0" max="1" step=".01" value={easingEditorCurve[key]} onChange={(event) => setEasingDraft({ ...easingEditorCurve, [key]: Number(event.target.value) })} /></label>)}</div><button className="apply-easing" onClick={() => applyEasingCurve(easingEditorCurve)}>应用到{selectedMotionElementInfo ? `「${selectedMotionElementInfo.name}」` : "全部关联元素"}</button><p>预设只更新当前草稿，点击“应用到”按钮后才会写入 JSON。</p></div></div> : <><div className="easing-categories" role="tablist" aria-label="动效属性分类">{EASING_CATEGORIES.map((category) => <button key={category.id} type="button" role="tab" aria-selected={selectedEasingCategory === category.id} className={selectedEasingCategory === category.id ? "active" : ""} onClick={() => selectEasingCategory(category.id)}><span>{category.label}<small>{category.english}</small></span><b>{easingCategoryCounts[category.id]}</b></button>)}</div><div className="easing-filter"><label htmlFor="motion-element-filter">按元素筛选</label><select id="motion-element-filter" value={selectedMotionElement} onChange={(event) => selectMotionElementFilter(event.target.value)}><option value="">全部动画元素</option>{motionElements.map((element) => <option key={element.id} value={element.id}>{element.name}</option>)}</select><span>{filteredEasings.length} 组关联曲线</span></div>{filteredEasings.length ? <div className="easing-profile-list">{filteredEasings.map((profile, index) => { const profileCount = selectedMotionElement ? profile.paths.filter((path) => path.startsWith(selectedMotionElement)).length : profile.count; const elementNames = profile.elements.map((element) => element.name); return <button key={profile.id} className="easing-profile" onClick={() => selectEasingProfile(profile)}><EasingPreview curve={profile} compact /><span><strong>{selectedEasingCategoryInfo.label}曲线 {String(index + 1).padStart(2, "0")}</strong><small className="easing-element-name">{elementNames.slice(0, 2).join(" · ") || "未命名关联元素"}{elementNames.length > 2 ? ` 等 ${elementNames.length} 个` : ""}</small><small>{profileCount} 个关键帧 / {profile.elements.length || 1} 个元素</small></span><code>{profile.outX.toFixed(2)}, {profile.outY.toFixed(2)}, {profile.inX.toFixed(2)}, {profile.inY.toFixed(2)}</code></button>; })}</div> : <Empty text={`当前筛选中没有可编辑的${selectedEasingCategoryInfo.label}曲线`} />}</> : <Empty text="没有识别到可编辑的 Lottie 贝塞尔关键帧曲线" />}</div>}
      </section>
      <aside className="json-panel">
        <div className="preview-title"><span className="status-dot" />视觉预览</div>
        <div className={isDraggingJson ? "preview-panel is-dragging" : "preview-panel"} onDragEnter={(event) => { event.preventDefault(); setIsDraggingJson(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDraggingJson(false); }} onDrop={dropJson}>
          <div className="preview-head"><span>{!hasUploadedFile ? "JSONABLE CUBE" : isLottie(data) ? "LOTTIE LIVE" : "AUTO LAYOUT"}</span><b>{colors.length} COLORS / {shapes.length} SHAPES / {images.length} IMAGES / {easings.length} CURVES</b></div>
          <VisualPreview data={data} colors={colors} shapes={shapes} images={images} isDefault={!hasUploadedFile} highlightElementIds={motionHighlightElementIds} highlightLabel={motionHighlightLabel} />
          <div className="preview-foot">{hasUploadedFile ? "修改颜色、形状、图片或动效曲线后自动刷新" : "拖入 JSON 到预览框，或使用顶部上传按钮"}</div>
          {isDraggingJson && <div className="drop-overlay"><span>↓</span><strong>松开即可载入 JSON</strong><small>文件只在本地浏览器中处理</small></div>}
        </div>
      </aside>
    </section>}
    {compressionReportOpen && compressionResult && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label="一键压缩结果"><div className="color-dialog compression-dialog comparison"><header><div><span className="eyebrow">ONE-CLICK COMPRESSION</span><h3>两种压缩结果</h3></div><button onClick={() => setCompressionReportOpen(false)} aria-label="关闭压缩结果">×</button></header><div className="compression-sampling-shortcuts"><label><input type="checkbox" checked={compressionSampling.advanced.enabled} disabled={!sequenceSamplingAvailable} onChange={(event) => updateCompressionSampling({ ...compressionSampling.advanced, enabled: event.target.checked })} /><span><strong>高级压缩抽帧</strong><small>只减少序列图片，保留原始帧率与时长</small></span></label></div><div className="compression-result-windows"><CompressionResultWindow mode="normal" result={compressionResult.normal} onDownload={() => downloadCompressed("normal")} /><CompressionResultWindow mode="advanced" result={compressionResult.advanced} sampling={compressionSampling.advanced} frames={sequenceFrameInspection.frames} onSamplingChange={updateCompressionSampling} onDownload={() => downloadCompressed("advanced")} onDotLottie={isLottie(data) ? downloadDotLottie : undefined} /></div><footer className="compression-footer compression-footer-note"><span>普通压缩仅移除格式空白，不提供抽帧。高级压缩可选抽帧，且不会修改 JSON 原始 fr、ip、op 和总时长。</span></footer></div></div>}
    {historyOpen && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label="修改记录"><div className="color-dialog history-dialog"><header><div><span className="eyebrow">VERSION HISTORY</span><h3>修改记录</h3></div><button onClick={() => setHistoryOpen(false)} aria-label="关闭修改记录">×</button></header><div className="history-dialog-body"><aside className="version-list">{versions.map((version, index) => ({ version, index })).reverse().map(({ version, index }) => <button key={version.id} className={selectedVersion?.id === version.id ? "active" : ""} onClick={() => setSelectedVersionId(version.id)}><span><strong>{version.label}</strong><small>{new Date(version.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small></span><b>{index === versionIndex ? "当前" : String(index).padStart(2, "0")}</b></button>)}</aside><section className="history-diff"><div className="history-diff-head"><div><span>版本差异</span><strong>{selectedVersion?.label || "请选择一个版本"}</strong></div><button onClick={restoreSelectedVersion} disabled={!selectedVersion || selectedVersion.id === versions[versionIndex]?.id}>恢复到此版本</button></div>{selectedVersionIndex <= 0 ? <div className="history-empty"><strong>这是原始文件</strong><p>后续的颜色、形状与图片修改都会记录在这里。</p></div> : selectedDiff.length ? <div className="diff-list">{selectedDiff.map((item, index) => <article key={`${item.path}-${index}`}><code>{item.path}</code><div><span><small>修改前</small>{item.before}</span><span><small>修改后</small>{item.after}</span></div></article>)}{selectedDiff.length >= 80 && <p className="diff-limit">仅展示前 80 处变化</p>}</div> : <div className="history-empty"><strong>没有检测到字段变化</strong><p>这个版本与前一个版本内容一致。</p></div>}</section></div><footer><span>修改记录仅保留在当前页面会话，刷新或关闭后清空</span><button onClick={() => setHistoryOpen(false)}>关闭</button></footer></div></div>}
    {colorEditor && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label="颜色编辑器"><div className="color-dialog"><header><div><span className="eyebrow">COLOR EDITOR</span><h3>替换颜色</h3></div><button onClick={() => setColorEditor(null)} aria-label="关闭颜色编辑器">×</button></header><div className="color-dialog-main"><label className="large-picker" style={{ background: colorEditor.current }}><input type="color" value={colorEditor.current} onChange={(event) => changeColor(event.target.value)} /><span>点击选择色彩</span></label><div className="color-values"><label>HEX 色值</label><div><input value={colorEditor.draft} onChange={(event) => setColorEditor({ ...colorEditor, draft: event.target.value.toUpperCase() })} /><button onClick={() => changeColor(colorEditor.draft)}>应用</button></div><small>将同步修改 {colorEditor.count} 个引用，窗口不会自动关闭。</small></div></div><div className="quick-colors">{["#101513", "#E8F0ED", "#54D2AE", "#2A6F5C", "#E66E58", "#5E8DA0"].map((hex) => <button key={hex} style={{ background: hex }} onClick={() => changeColor(hex)} aria-label={`选择 ${hex}`} />)}</div><footer><span>修改已实时写入预览和 JSON</span><button onClick={() => setColorEditor(null)}>关闭</button></footer></div></div>}
    {shapeEditorOpen && activeShape && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label={`替换形状 ${activeShape.name}`}><div className="color-dialog asset-dialog"><header><div><span className="eyebrow">SVG REPLACEMENT</span><h3>替换「{activeShape.name}」</h3></div><button onClick={() => setShapeEditorOpen(false)} aria-label="关闭形状替换窗口">×</button></header><div className="asset-dialog-body"><div className="replace-card"><div className="composed-current"><ShapeThumb data={data} shape={activeShape} /><span><small>主文件中的当前目标</small><strong>{activeShape.name}</strong></span><b>{activeShape.count > 1 ? `同名 ${activeShape.count} 个 · 仅替换当前` : "当前实例"}</b></div><button className="replacement-upload" onClick={() => replacementFileRef.current?.click()}>{uploadedSvg ? <img className="replacement-svg-preview" src={uploadedSvg.preview} alt="上传的 SVG 预览" /> : <span className="replacement-upload-icon">＋</span>}<span><small>{uploadedSvg ? "已转换为矢量路径" : "上传替换形状"}</small><strong>{uploadedSvg?.fileName || "选择 SVG 文件"}</strong></span><b>{uploadedSvg ? "重新上传" : "选择文件"}</b></button><input ref={replacementFileRef} type="file" accept="image/svg+xml,.svg" onChange={loadReplacementFile} hidden />{replacementError && <div className="replacement-error" role="alert">{replacementError}</div>}{uploadedSvg && <><div className="replacement-summary"><span>已转换的矢量部分</span><b>{uploadedSvg.partCount}</b></div><button className="apply-replacement" onClick={() => changeShapeFromUpload(activeShape)} disabled={activeShape.mode === "reference"}>只替换当前这个形状</button>{activeShape.mode === "reference" && <div className="replacement-empty">当前目标是外部引用，不能直接写入 SVG 路径。</div>}</>}<p>SVG 会转换为 JSON 内的矢量路径，只替换当前实例，并保留它的位置、缩放和动画变换。</p></div></div><footer><span>文件仅在本地浏览器中处理</span><button onClick={() => setShapeEditorOpen(false)}>关闭</button></footer></div></div>}
    {batchImageEditorOpen && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label="批量替换图片素材"><div className="color-dialog batch-image-dialog"><header><div><span className="eyebrow">BATCH IMAGE REPLACEMENT</span><h3>批量替换图片素材</h3></div><button onClick={() => setBatchImageEditorOpen(false)} aria-label="关闭批量替换窗口">×</button></header><div className="batch-image-body"><div className="batch-image-toolbar"><div><strong>{batchImageTargets.length} 个目标</strong><small>已上传 {batchUploadedImages.length} 张新图片，完成 {batchMappedCount} 组映射</small></div><button onClick={() => batchImageFileRef.current?.click()}>{batchUploadedImages.length ? "重新上传图片" : "批量上传图片"}</button><input ref={batchImageFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={loadBatchImageReplacements} hidden /></div>{imageError && <div className="replacement-error" role="alert">{imageError}</div>}<div className="batch-mapping-list">{images.map((item) => { const checked = batchImageTargets.includes(item.id); const mappedIndex = batchImageMappings[item.id] ?? -1; return <article key={item.id} className={checked ? "batch-mapping-row selected" : "batch-mapping-row"}><label className="batch-target"><input type="checkbox" checked={checked} onChange={() => toggleBatchImageTarget(item.id)} /><span className="image-thumb"><ImageThumb source={item.preview} label={item.name} /></span><span><strong>{item.name}</strong><small>{item.count} 个引用</small></span></label><span className="batch-arrow" aria-hidden="true">→</span><select value={mappedIndex} onChange={(event) => setBatchImageMappings((current) => ({ ...current, [item.id]: Number(event.target.value) }))} disabled={!checked || !batchUploadedImages.length} aria-label={`为 ${item.name} 选择替换图片`}><option value={-1}>选择新图片</option>{batchUploadedImages.map((replacement, index) => <option key={`${replacement.fileName}-${index}`} value={index}>{replacement.fileName}</option>)}</select></article>; })}</div><p className="batch-image-note">同名文件会自动匹配，其余图片按上传顺序对应。确认前可以逐项调整，也可以取消不需要替换的资源。</p></div><footer><span>所有图片仅在本地读取并内嵌到 JSON</span><div><button className="batch-secondary" onClick={() => setBatchImageEditorOpen(false)}>取消</button><button className="batch-primary" onClick={applyBatchImageReplacement} disabled={!batchMappedCount}>替换 {batchMappedCount} 个资源</button></div></footer></div></div>}
    {imageEditorOpen && activeImage && <div className="color-dialog-layer" role="dialog" aria-modal="true" aria-label={`替换图片 ${activeImage.name}`}><div className="color-dialog asset-dialog"><header><div><span className="eyebrow">IMAGE REPLACEMENT</span><h3>替换「{activeImage.name}」</h3></div><button onClick={() => setImageEditorOpen(false)} aria-label="关闭图片替换窗口">×</button></header><div className="asset-dialog-body"><div className="replace-card image-replace-card"><div className="current-image"><span className="current-image-preview"><ImageThumb source={activeImage.preview} label={activeImage.name} /></span><span><small>当前资源</small><strong>{activeImage.name}</strong><em>{activeImage.count} 个引用</em></span></div><button className="replacement-upload image-upload" onClick={() => imageFileRef.current?.click()}>{uploadedImage ? <img className="replacement-svg-preview" src={uploadedImage.dataUrl} alt="新图片预览" /> : <span className="replacement-upload-icon">＋</span>}<span><small>{uploadedImage ? `${uploadedImage.width} × ${uploadedImage.height}` : "上传新图片"}</small><strong>{uploadedImage?.fileName || "选择 PNG、JPG、WebP 或 GIF"}</strong></span><b>{uploadedImage ? "重新上传" : "选择文件"}</b></button><input ref={imageFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={loadImageReplacement} hidden />{imageError && <div className="replacement-error" role="alert">{imageError}</div>}{uploadedImage && <button className="apply-replacement" onClick={() => changeImage(activeImage)}>使用这张图片替换全部引用</button>}<p>新图片会内嵌写入 JSON，原图层的位置、尺寸、透明度和动画保持不变。</p></div></div><footer><span>文件不会上传到服务器</span><button onClick={() => setImageEditorOpen(false)}>关闭</button></footer></div></div>}
    {toast && <div className="toast" aria-live="polite"><span>✓</span>{toast}</div>}
  </main>;
}

function Empty({ text }: { text: string }) { return <div className="empty"><span>◎</span><p>{text}</p></div>; }
