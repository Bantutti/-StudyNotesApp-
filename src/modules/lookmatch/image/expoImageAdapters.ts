/**
 * Expo adapters for reference images (picker, re-encode, decode, delete).
 * Everything here runs in Expo Go: expo-image-picker, expo-image-manipulator,
 * expo-file-system and React Native Skia are all bundled in it.
 * UNVERIFIED until Rey's device test: EXIF absence on real phone photos
 * (backed up by stripJpegMetadata), Skia readPixels in Expo Go.
 */
import type * as SkiaModule from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { RgbaImage } from '../analysis/pixels';

import type { EncodedCopy, ImageIntakePorts, PickedImage } from './intake';
import { MAX_IMAGES } from './limits';

/**
 * React Native Skia, loaded on first decode. Importing it at the top would
 * initialise its native module when the app (or a test) merely imports the
 * lookmatch index; only Match a look needs it.
 */
function skia(): typeof SkiaModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load (see above)
  return require('@shopify/react-native-skia') as typeof SkiaModule;
}

export type PickOutcome = { kind: 'picked'; images: PickedImage[] } | { kind: 'cancelled' } | { kind: 'denied' };

const toPicked = (a: ImagePicker.ImagePickerAsset): PickedImage => ({
  uri: a.uri,
  width: a.width,
  height: a.height,
  fileSize: typeof a.fileSize === 'number' ? a.fileSize : null,
  mimeType: a.mimeType ?? null,
  type: a.type ?? null,
});

/** Options shared by both sources: photos only, no EXIF, no base64 of the original, no editing. */
const BASE_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  exif: false,
  base64: false,
  allowsEditing: false,
  quality: 1, // no extra lossy pass here; we re-encode a small copy ourselves
};

/**
 * Photo library through the SYSTEM picker (Android Photo Picker, iOS
 * PHPicker): the app gets only the chosen photos and needs no photo
 * permission (P5 decision Q8 = A, Play's photo and video permissions policy).
 */
export async function pickFromLibrary(max = MAX_IMAGES): Promise<PickOutcome> {
  const r = await ImagePicker.launchImageLibraryAsync({ ...BASE_OPTIONS, allowsMultipleSelection: max > 1, selectionLimit: max, orderedSelection: true });
  if (r.canceled) return { kind: 'cancelled' };
  return { kind: 'picked', images: r.assets.slice(0, max).map(toPicked) };
}

/** Camera: permission asked only now, when the student taps "Take a photo". */
export async function takePhoto(): Promise<PickOutcome> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { kind: 'denied' };
  const r = await ImagePicker.launchCameraAsync(BASE_OPTIONS);
  if (r.canceled) return { kind: 'cancelled' };
  return { kind: 'picked', images: r.assets.slice(0, 1).map(toPicked) };
}

/** Only files inside the app's cache folder are ever deleted (the picker and manipulator write there). */
function isAppCacheUri(uri: string): boolean {
  const cache = Paths.cache.uri;
  return typeof uri === 'string' && uri.startsWith(cache) && !uri.includes('..');
}

export const expoImagePorts: ImageIntakePorts = {
  async encodeCopy(uri, source, longSide, quality): Promise<EncodedCopy> {
    // Decode already downsampled (maxWidth/maxHeight), then resize exactly.
    const ctx = ImageManipulator.manipulate(uri, { maxWidth: longSide * 2, maxHeight: longSide * 2 });
    if (Math.max(source.width, source.height) > longSide) {
      ctx.resize(source.width >= source.height ? { width: longSide } : { height: longSide });
    }
    const ref = await ctx.renderAsync();
    try {
      const res = await ref.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
      if (!res.base64) throw new Error('no_base64');
      return { uri: res.uri, width: res.width, height: res.height, base64: res.base64 };
    } finally {
      ref.release();
      ctx.release();
    }
  },
  decodeJpeg(base64): RgbaImage {
    const { AlphaType, ColorType, Skia } = skia();
    const data = Skia.Data.fromBase64(base64);
    const img = Skia.Image.MakeImageFromEncoded(data);
    if (!img) throw new Error('decode_failed');
    const width = img.width();
    const height = img.height();
    const px = img.readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    img.dispose();
    data.dispose();
    if (!(px instanceof Uint8Array)) throw new Error('decode_failed');
    return { width, height, data: px };
  },
  async removeTemp(uri) {
    try {
      if (!isAppCacheUri(uri)) return;
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      // Best effort: a leftover cache file is removed by the OS; never crash the flow.
    }
  },
};
