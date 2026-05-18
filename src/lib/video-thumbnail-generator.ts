export async function generateVideoThumbnailFile(
  file: File,
  captureAt = 0.1
): Promise<File | null> {
  if (!file.type.startsWith("video/")) return null;

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

    function draw() {
      try {
        if (!video.videoWidth || !video.videoHeight) {
          finish(null);
          return;
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
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);
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
      } catch {
        finish(null);
      }
    }

    function seek() {
      try {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const target = duration > 0 ? Math.min(captureAt, Math.max(0, duration - 0.05)) : 0;
        if (Math.abs(video.currentTime - target) < 0.01) draw();
        else video.currentTime = target;
      } catch {
        draw();
      }
    }

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.addEventListener("loadedmetadata", seek, { once: true });
    video.addEventListener("loadeddata", seek, { once: true });
    video.addEventListener("seeked", draw, { once: true });
    video.addEventListener("error", () => finish(null), { once: true });
    timeout = setTimeout(() => finish(null), 8000);
    video.src = objectUrl;
    video.load();
  });
}
