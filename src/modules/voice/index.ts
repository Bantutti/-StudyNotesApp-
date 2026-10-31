/** voice: long recording, transcription adapters, timestamp/accuracy maths. */
export { summarize, judgeRecording, GAP_TOLERANCE_MS, type Sample, type SessionSummary, type AppStateName } from './session';
export { wordErrorRate, normalizeWords, type WerResult } from './wer';
export { checkStructure, pickTargets, driftStats, wordAt, type TimedWord, type DriftReport } from './drift';
export { READING_SCRIPTS, SAMPLE_GLOSSARY, type ReadingScript } from './scripts';
export { PRESETS, SPEECH_PRESET, type PresetId } from './presets';
export { keepRecording, listRecordings, deleteRecording, fileSizeOf, recordingName, type RecordingFile } from './recordings';
export type { TranscriptionProvider, TranscriptionRequest, Transcript, TranscriptWord } from './transcription/types';
export { createGroqTranscriber, GROQ_MAX_UPLOAD_BYTES, GROQ_BASE, GROQ_MODEL } from './transcription/groq';
