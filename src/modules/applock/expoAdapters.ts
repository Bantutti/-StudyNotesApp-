import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import { Platform } from 'react-native';

import type { DeviceAuthPort, ScreenPrivacyPort } from './ports';

export const expoDeviceAuth: DeviceAuthPort = {
  async canLock() {
    try {
      return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
    } catch {
      return false;
    }
  },
  async authenticate(prompt) {
    try {
      // Biometrics with the device passcode as fallback (Face ID isn't available in Expo Go on iOS: the passcode is used).
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, disableDeviceFallback: false, cancelLabel: 'Cancel' });
      return r.success;
    } catch {
      return false;
    }
  },
};

const KEY = 'app-lock';

export const expoScreenPrivacy: ScreenPrivacyPort = {
  async protect(on) {
    try {
      if (Platform.OS === 'ios') {
        if (on) await ScreenCapture.enableAppSwitcherProtectionAsync(0.9);
        else await ScreenCapture.disableAppSwitcherProtectionAsync();
      } else if (on) await ScreenCapture.preventScreenCaptureAsync(KEY);
      else await ScreenCapture.allowScreenCaptureAsync(KEY);
    } catch {
      // Not available (e.g. some Expo Go builds): the lock gate still works.
    }
  },
};
