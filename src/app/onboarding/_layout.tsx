import { Stack } from 'expo-router';

import { useTheme } from '@/core/ui';

export default function OnboardingLayout() {
  const th = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: th.bg } }} />;
}
