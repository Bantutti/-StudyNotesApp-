# ai

**Purpose:** bring-your-own-key (BYOK) handling for free AI providers. Provider adapters live in
the feature that uses them (for example Groq transcription in `voice`).

**Public interface**
- `PROVIDERS` (`groq`), `PROVIDER_INFO` (label, key page, key pattern)
- `normalizeKey(provider, raw)` (trims, validates format), `maskKey(key)`
- `createKeyVault(store) -> { get, set, remove, has }` over `SecretStorePort`
- `expoSecretStore` (expo-secure-store, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`)

**Rules:** keys live only in secure storage, are read per request, sent only to the provider's
fixed HTTPS host, shown masked, and never logged or sent to our backend.

**How to extend (P3)**
- New provider: add it to `PROVIDERS` and `PROVIDER_INFO` with its key pattern, then write the
  adapter in the feature module behind an interface. Add a "Test key" call that is cheap and
  read-only.
