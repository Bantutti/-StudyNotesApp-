/**
 * Hard limits for reference images (P5 security: images are untrusted input).
 *
 * Every number here is checked BEFORE the expensive step it protects:
 * file size and pixel count before decoding (a "decompression bomb" is a
 * small file that expands to gigabytes of pixels), output size before
 * anything is kept in memory or sent anywhere.
 */

/** Up to 3 photos per look (P5 decision Q4 = A; Groq's vision model also takes at most 3). */
export const MAX_IMAGES = 3;

/** Largest picked file, in bytes (25 MiB: a 50 MP phone JPEG is about 15-20 MB). */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** Largest picked image in pixels (width x height), checked from the picker's metadata before decoding. */
export const MAX_INPUT_PIXELS = 50_000_000;

/** Smallest useful image side: below this the paper pattern can't be measured. */
export const MIN_INPUT_SIDE = 64;

/**
 * Long side of the copy the on-device analysis reads (MATCH_MATH.md §2).
 * 384 px keeps ruled lines at about 8-12 px apart on a whole-page photo,
 * enough for the period search (§5.2), and decodes to only ~590 KB of RGBA.
 */
export const ANALYSIS_LONG_SIDE = 384;
/** JPEG quality of the analysis copy (high: compression smears thin lines). */
export const ANALYSIS_QUALITY = 0.92;

/** Long side of the copy the optional vision pass sends (M6). */
export const VISION_LONG_SIDE = 1024;
export const VISION_QUALITY = 0.8;
/** Largest vision upload as base64 characters (~1.1 MB of JPEG; Groq's cap is 20 MB per request). */
export const MAX_VISION_BASE64 = 1_500_000;

/** Image types the picker may hand us. Anything else (video, GIF, SVG, PDF) is refused. */
export const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
