import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import type { AssetReader } from './fonts';

/** Expo adapter: bundled asset -> local file -> base64. */
export const expoAssetReader: AssetReader = async (assetId) => {
  const asset = Asset.fromModule(assetId);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('font_asset_unavailable');
  return new File(asset.localUri).base64();
};
