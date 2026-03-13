import { POSE_CONNECTIONS, getVisibility } from "./landmarks.js";

export function resizeCanvasToVideo(canvasEl, ctx, videoEl) {
  const width = videoEl.videoWidth || 0;
  const height = videoEl.videoHeight || 0;

  if (!width || !height) {
    return { width: 0, height: 0 };
  }

  const dpr = window.devicePixelRatio || 1;
  const displayWidth = Math.round(width * dpr);
  const displayHeight = Math.round(height * dpr);

  if (canvasEl.width !== displayWidth || canvasEl.height !== displayHeight) {
    canvasEl.width = displayWidth;
    canvasEl.height = displayHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  return { width, height };
}

export function clearCanvas(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
}

export function drawSkeleton(ctx, landmarks, width, height, options = {}) {
  if (!ctx || !landmarks?.length) return;

  const lineWidth = options.lineWidth ?? 2;
  const dotRadius = options.dotRadius ?? 3;
  const drawVis = options.drawVis ?? 0.18;
  const lineColor = options.lineColor ?? "rgba(0, 140, 255, 1)";
  const dotColor = options.dotColor ?? "rgba(255,255,255,1)";

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = lineWidth;

  ctx.beginPath();
  for (const [start, end] of POSE_CONNECTIONS) {
    const p1 = landmarks[start];
    const p2 = landmarks[end];

    if (!p1 || !p2) continue;
    if (getVisibility(p1) < drawVis || getVisibility(p2) < drawVis) continue;

    ctx.moveTo(p1.x * width, p1.y * height);
    ctx.lineTo(p2.x * width, p2.y * height);
  }
  ctx.stroke();

  ctx.fillStyle = dotColor;
  for (const point of landmarks) {
    if (!point || getVisibility(point) < drawVis) continue;

    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawTextLabel(ctx, text, x, y, options = {}) {
  if (!ctx || !text) return;

  ctx.save();
  ctx.font = options.font ?? "14px Segoe UI";
  ctx.fillStyle = options.fillStyle ?? "#ffffff";
  ctx.strokeStyle = options.strokeStyle ?? "rgba(0,0,0,0.7)";
  ctx.lineWidth = options.lineWidth ?? 3;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function drawMarker(ctx, x, y, options = {}) {
  if (!ctx) return;

  const radius = options.radius ?? 6;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = options.fillStyle ?? "rgba(255, 80, 80, 0.9)";
  ctx.fill();
  ctx.restore();
}

export function applyMirrorStyles(videoEl, canvasEl, isMirrored = true) {
  const transform = isMirrored ? "scaleX(-1)" : "none";

  if (videoEl) {
    videoEl.style.transform = transform;
    videoEl.style.transformOrigin = "center";
  }

  if (canvasEl) {
    canvasEl.style.transform = transform;
    canvasEl.style.transformOrigin = "center";
  }
}

export function ensureOverlayStack(videoEl, canvasEl) {
  const shell = videoEl?.parentElement;
  if (!shell || !videoEl || !canvasEl) return;

  shell.style.position = "relative";
  shell.style.overflow = "hidden";

  videoEl.style.display = "block";
  videoEl.style.width = "100%";
  videoEl.style.height = "auto";

  canvasEl.style.position = "absolute";
  canvasEl.style.left = "0";
  canvasEl.style.top = "0";
  canvasEl.style.width = "100%";
  canvasEl.style.height = "100%";
  canvasEl.style.pointerEvents = "none";
  canvasEl.style.zIndex = "5";
}