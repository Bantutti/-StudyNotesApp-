/**
 * Bottom tabs (decision Q2): Home, Subjects, (+), Me. Review joins in P4c.
 * The centre + is not a screen: it opens the New sheet.
 */
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, View } from 'react-native';

import { t } from '@/core';
import { Icon, useTheme, type IconName } from '@/core/ui';

const icon = (name: IconName) =>
  function TabIcon({ color }: { color: unknown }) {
    return <Icon name={name} color={typeof color === 'string' ? color : undefined} />;
  };

export default function TabsLayout() {
  const th = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: th.accentText,
        tabBarInactiveTintColor: th.muted,
        tabBarStyle: { backgroundColor: th.surface, borderTopColor: th.line },
        headerStyle: { backgroundColor: th.bg },
        headerTitleStyle: { color: th.text },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: th.bg },
      }}
    >
      <Tabs.Screen name="home" options={{ title: t('tab.home'), tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="subjects" options={{ title: t('tab.subjects'), tabBarIcon: icon('albums-outline') }} />
      <Tabs.Screen
        name="plus"
        options={{
          title: t('tab.new'),
          tabBarButton: () => (
            <View style={styles.plusWrap}>
              <Pressable
                testID="tab-new"
                accessibilityRole="button"
                accessibilityLabel={t('notes.new')}
                onPress={() => router.push('/new')}
                style={[styles.plus, { backgroundColor: th.primary.fill }]}
              >
                <Icon name="add" size={30} color={th.primary.text} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Tabs.Screen name="me" options={{ title: t('tab.me'), tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  plusWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  plus: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginTop: -8 },
});
