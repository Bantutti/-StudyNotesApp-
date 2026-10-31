/**
 * Recording presets. SPEECH is tuned for long lectures: mono AAC at 32 kbps
 * is about 14.4 MB per hour, so a 90-minute lecture (~21.6 MB) still fits
 * Groq's 25 MB upload limit in one file.
 */
import { AudioQuality, IOSOutputFormat, RecordingPresets, type RecordingOptions } from 'expo-audio';

export const SPEECH_PRESET: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 32000,
  isMeteringEnabled: false,
  directory: 'document',
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

export const HIGH_QUALITY_PRESET: RecordingOptions = { ...RecordingPresets.HIGH_QUALITY, directory: 'document' };

export const PRESETS = {
  speech: { label: 'Speech (32 kbps mono)', options: SPEECH_PRESET, expectedBytesPerMin: 240_000 },
  high: { label: 'High quality (128 kbps stereo)', options: HIGH_QUALITY_PRESET, expectedBytesPerMin: 960_000 },
} as const;
export type PresetId = keyof typeof PRESETS;
