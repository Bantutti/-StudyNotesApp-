import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import type { DeviceInfo } from '../results/types';

/**
 * Non-identifying device description for results. Uses the hardware model
 * ("Pixel 7"), never the user-chosen device name ("Rey's phone").
 */
export function getDeviceInfo(): DeviceInfo {
  const env = Constants.executionEnvironment;
  const runtime =
    env === ExecutionEnvironment.StoreClient
      ? 'expo-go'
      : env === ExecutionEnvironment.Bare && Constants.appOwnership !== 'expo'
        ? __DEV__
          ? 'dev-build'
          : 'standalone'
        : env === ExecutionEnvironment.Standalone
          ? 'standalone'
          : 'unknown';
  const os = Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web' ? Platform.OS : 'other';
  return {
    os,
    osVersion: String(Device.osVersion ?? Platform.Version ?? 'unknown').slice(0, 40),
    model: String(Device.modelName ?? 'unknown').slice(0, 80),
    runtime,
    isTablet: Device.deviceType === Device.DeviceType.TABLET,
  };
}

export const isExpoGo = (): boolean => Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
