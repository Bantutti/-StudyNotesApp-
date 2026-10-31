/** Welcome: three swipeable cards (Capture, Shape, Review) with Skip (plan Flow 1). */
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';

import { skipOnboarding, useStore } from '@/composition';
import { t, type StringKey } from '@/core';
import { AppButton, AppScreen, BodyText, Icon, Title, useTheme, type IconName } from '@/core/ui';

const CARDS: { icon: IconName; title: StringKey; body: StringKey }[] = [
  { icon: 'create-outline', title: 'welcome.capture.title', body: 'welcome.capture.body' },
  { icon: 'color-wand-outline', title: 'welcome.shape.title', body: 'welcome.shape.body' },
  { icon: 'albums-outline', title: 'welcome.review.title', body: 'welcome.review.body' },
];

export default function Welcome() {
  const th = useTheme();
  const store = useStore();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollViewInstance>(null);
  const last = page === CARDS.length - 1;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  const next = () => {
    if (last) router.push('/onboarding/look');
    else scroller.current?.scrollTo({ x: (page + 1) * width, animated: true });
  };
  const skip = async () => {
    await skipOnboarding(store);
    router.replace('/home');
  };

  return (
    <AppScreen scroll={false} padded={false} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.top}>
        <AppButton kind="plain" label={t('common.skip')} onPress={skip} testID="welcome-skip" />
      </View>
      <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll}>
        {CARDS.map((c) => (
          <View key={c.title} style={[styles.card, { width }]} accessible accessibilityLabel={`${t(c.title)}. ${t(c.body)}`}>
            <View style={[styles.badge, { backgroundColor: th.surface, borderColor: th.line }]}>
              <Icon name={c.icon} size={56} color={th.accent} />
            </View>
            <Title size="largeTitle">{t(c.title)}</Title>
            <BodyText muted center>
              {t(c.body)}
            </BodyText>
          </View>
        ))}
      </ScrollView>
      <View style={styles.bottom}>
        <View style={styles.dots} accessibilityLabel={`Card ${page + 1} of ${CARDS.length}`}>
          {CARDS.map((c, i) => (
            <View key={c.title} style={[styles.dot, { backgroundColor: i === page ? th.accent : th.line }]} />
          ))}
        </View>
        <AppButton label={last ? t('welcome.start') : t('common.next')} onPress={next} testID="welcome-next" />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: 'flex-end', paddingHorizontal: 8 },
  card: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 },
  badge: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  bottom: { padding: 24, gap: 20 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
