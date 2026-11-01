/**
 * The ONE place the app imports P2a's cloud schemas (firebase/src/schemas,
 * SDK-free). Everything in the sync module goes through this file, so a
 * future move to a package only changes one import (decision Q14).
 */
export {
  COLLECTION_NAMES,
  COLLECTION_SCHEMAS,
  REVIEW_FUTURE_SKEW_MS,
  QUERY_LIMIT_MAX,
  userSchema,
  type CollectionName,
  type TimestampLike,
} from '../../../firebase/src/schemas';
