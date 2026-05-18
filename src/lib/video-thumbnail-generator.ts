export async function generateVideoThumbnailFile(
  file: File,
  captureAt = 1
): Promise<File | null> {
  const isVideo = file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(file.name);
  if (!isVideo) return null;

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    function finish(result: File | null) {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
      resolve(result);
    }

    function scoreFrame(ctx: CanvasRenderingContext2D, width: number, height: number): number {
      const sampleWidth = Math.max(1, Math.min(64, width));
      const sampleHeight = Math.max(1, Math.min(64, height));
      const sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = sampleWidth;
      sampleCanvas.height = sampleHeight;
      const sampleCtx = sampleCanvas.getContext("2d");
      if (!sampleCtx) return 0;
      sampleCtx.drawImage(ctx.canvas, 0, 0, sampleWidth, sampleHeight);
      const { data } = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight);
      let luminanceSum = 0;
      let luminanceSquaredSum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        luminanceSum += luminance;
        luminanceSquaredSum += luminance * luminance;
      }
      const count = data.length / 4;
      const average = luminanceSum / count;
      const variance = luminanceSquaredSum / count - average * average;
      return average + Math.sqrt(Math.max(0, variance)) * 1.5;
    }

    function candidateTimes(duration: number): number[] {
      const raw = duration > 0
        ? [captureAt, 0.5, 1, 2, 3, duration * 0.25, duration * 0.5, Math.max(0, duration - 0.2)]
        : [captureAt, 0.5, 1, 2, 3];
      return Array.from(new Set(
        raw
          .filter((t) => Number.isFinite(t) && t >= 0)
          .map((t) => duration > 0 ? Math.min(t, Math.max(0, duration - 0.05)) : t)
          .map((t) => Math.round(t * 10) / 10)
      ));
    }

    function drawBlobFromCanvas(canvas: HTMLCanvasElement) {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            finish(null);
            return;
          }
          finish(new File([blob], "video-thumbnail.jpg", { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.82
      );
    }

    function drawCurrentFrame(): { canvas: HTMLCanvasElement; score: number } | null {
      try {
        if (!video.videoWidth || !video.videoHeight) {
          return null;
        }
        const maxWidth = 960;
        const ratio = Math.min(1, maxWidth / video.videoWidth);
        const width = Math.round(video.videoWidth * ratio);
        const height = Math.round(video.videoHeight * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return null;
        }
        ctx.drawImage(video, 0, 0, width, height);
        return { canvas, score: scoreFrame(ctx, width, height) };
      } catch {
        return null;
      }
    }

    function seekTo(time: number): Promise<void> {
      return new Promise((resolve) => {
        const done = () => {
          video.removeEventListener("seeked", done);
          resolve();
        };
        video.addEventListener("seeked", done, { once: true });
        try {
          video.currentTime = time;
        } catch {
          video.removeEventListener("seeked", done);
          resolve();
        }
      });
    }

    async function captureBestFrame() {
      try {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        let best: { canvas: HTMLCanvasElement; score: number } | null = null;
        for (const target of candidateTimes(duration)) {
          if (settled) return;
          if (Math.abs(video.currentTime - target) >= 0.01) {
            await seekTo(target);
          }
          const frame = drawCurrentFrame();
          if (!frame) continue;
          if (!best || frame.score > best.score) best = frame;
          if (frame.score > 45) break;
        }
        if (!best) {
          finish(null);
          return;
        }
        drawBlobFromCanvas(best.canvas);
      } catch {
        finish(null);
      }
    }

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.addEventListener("loadedmetadata", captureBestFrame, { once: true });
    video.addEventListener("loadeddata", captureBestFrame, { once: true });
    video.addEventListener("error", () => finish(null), { once: true });
    timeout = setTimeout(() => finish(null), 8000);
    video.src = objectUrl;
    video.load();
  });
}

export function dataUrlToFile(dataUrl: string, fileName = "video-thumbnail.jpg"): File | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  try {
    const mime = match[1] || "image/jpeg";
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], fileName, { type: mime });
  } catch {
    return null;
  }
}

export async function generateNativeVideoThumbnailDataUrl(videoUrl: string): Promise<string | null> {
  const webkit = (window as unknown as {
    webkit?: {
      messageHandlers?: {
        generateVideoThumbnail?: {
          postMessage: (body: { requestId: string; url: string }) => void;
        };
      };
    };
  }).webkit;

  const handler = webkit?.messageHandlers?.generateVideoThumbnail;
  if (!handler) return null;

  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("huddle:nativeVideoThumbnail", onResult);
      resolve(null);
    }, 10000);

    function onResult(event: Event) {
      const detail = (event as CustomEvent<{
        requestId?: string;
        dataUrl?: string;
        error?: string;
      }>).detail;
      if (detail?.requestId !== requestId) return;
      clearTimeout(timeout);
      window.removeEventListener("huddle:nativeVideoThumbnail", onResult);
      resolve(detail.dataUrl || null);
    }

    window.addEventListener("huddle:nativeVideoThumbnail", onResult);
    try {
      handler.postMessage({ requestId, url: videoUrl });
    } catch {
      clearTimeout(timeout);
      window.removeEventListener("huddle:nativeVideoThumbnail", onResult);
      resolve(null);
    }
  });
}
