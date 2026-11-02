/**
 * BlobStorePort on firebase/storage. Uploads set only the content type (the
 * Storage rules refuse custom metadata). Errors become RemoteError codes.
 */
import { deleteObject, getBytes, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';

import { RemoteError, type BlobStorePort } from '@/modules/sync';

function toRemote(e: unknown): RemoteError {
  const code = typeof e === 'object' && e !== null ? String((e as { code?: unknown }).code ?? '') : '';
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') return new RemoteError('permission-denied');
  if (code === 'storage/retry-limit-exceeded' || code === 'storage/canceled') return new RemoteError('unavailable');
  if (code === 'storage/quota-exceeded') return new RemoteError('resource-exhausted');
  return new RemoteError('unknown');
}

const isNotFound = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'storage/object-not-found';

export function createStorageBlobs(storage: FirebaseStorage, opts: { maxDownloadBytes?: number } = {}): BlobStorePort {
  const maxDownload = opts.maxDownloadBytes ?? 64 * 1024 * 1024;
  return {
    async upload(cloudPath, bytes, contentType) {
      try {
        await uploadBytes(ref(storage, cloudPath), bytes, { contentType });
      } catch (e) {
        throw toRemote(e);
      }
    },
    async download(cloudPath) {
      try {
        return new Uint8Array(await getBytes(ref(storage, cloudPath), maxDownload));
      } catch (e) {
        if (isNotFound(e)) return null;
        throw toRemote(e);
      }
    },
    async remove(cloudPath) {
      try {
        await deleteObject(ref(storage, cloudPath));
      } catch (e) {
        if (isNotFound(e)) return;
        throw toRemote(e);
      }
    },
  };
}
