/** Jest stand-in for expo-audio's native module (unit tests never touch audio hardware). */
export const AudioQuality = { MIN: 0, LOW: 32, MEDIUM: 64, HIGH: 96, MAX: 127 };
export const IOSOutputFormat = { MPEG4AAC: 'aac ' };
export const RecordingPresets = {
  HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, numberOfChannels: 2, bitRate: 128000, android: { outputFormat: 'mpeg4', audioEncoder: 'aac' }, ios: { outputFormat: 'aac ', audioQuality: 127 }, web: {} },
  LOW_QUALITY: { extension: '.m4a', sampleRate: 44100, numberOfChannels: 2, bitRate: 64000, android: {}, ios: {}, web: {} },
};
export const useAudioRecorder = jest.fn();
export const useAudioRecorderState = jest.fn();
export const useAudioPlayer = jest.fn();
export const useAudioPlayerStatus = jest.fn();
export const setAudioModeAsync = jest.fn(async () => undefined);
export const requestRecordingPermissionsAsync = jest.fn(async () => ({ granted: true }));
