# voice

**Purpose:** long lecture recording, transcription with word timestamps, and the maths to judge
accuracy.

**Public interface**
- Recording: `PRESETS` (`speech` 32 kbps mono AAC, `high` 128 kbps stereo), `SPEECH_PRESET`,
  `keepRecording(uri)`, `listRecordings()`, `deleteRecording(name)`, `fileSizeOf(uri)`, `recordingName()`.
- Session monitor: `summarize(samples)` (coverage, longest gap, background time, size, battery per
  hour), `judgeRecording(summary)`.
- Transcription port: `TranscriptionProvider { transcribe(req), testKey(), maxUploadBytes }` and
  `createGroqTranscriber({ getKey, fetchFn, fileSize, logger })` (`whisper-large-v3-turbo`,
  `verbose_json`, word + segment timestamps, temperature 0, optional glossary prompt).
- Accuracy: `wordErrorRate(ref, hyp)`, `normalizeWords`, `checkStructure(words, duration)`,
  `pickTargets(words)`, `driftStats(offsets)`, `wordAt(words, t)`.
- Samples: `READING_SCRIPTS` (English, Taglish, Cebuano-mixed), `SAMPLE_GLOSSARY`.

**How to extend**
- New provider (for example a local Whisper model or another API): implement
  `TranscriptionProvider` in `transcription/<name>.ts`, validate its response with zod, read the key
  from the vault per call, never log bodies; then choose it in `services.ts`.
- Files over 25 MB (very long lectures or high quality): add chunking in the provider, keeping
  timestamps offset per chunk.
