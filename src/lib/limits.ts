/** Shared upload size ceilings for the extract and extract-stream routes. */

export const MAX_PDF_BYTES = 25 * 1024 * 1024;

// Anthropic vision's per-image limit is 5 MB after base64 encoding. Base64
// inflates raw bytes by ~1.33x, so the equivalent raw cap is ~3.75 MB. Use
// 3.5 MB to leave a small buffer for JSON payload overhead and avoid
// model-API-failure responses on legitimate uploads near the limit.
export const MAX_IMAGE_BYTES = Math.floor(3.5 * 1024 * 1024);
