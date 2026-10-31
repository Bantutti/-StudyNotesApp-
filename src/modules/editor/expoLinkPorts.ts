import { Alert, Linking } from 'react-native';

import type { LinkPorts } from './links';

/**
 * Expo/React Native adapter: a native Alert to confirm, then Linking.openURL,
 * which leaves the app (system browser or mail app). No in-app browser.
 */
export const expoLinkPorts: LinkPorts = {
  openExternal: (url) => Linking.openURL(url).then(() => undefined),
  confirm: ({ host, url }) =>
    new Promise((resolve) => {
      Alert.alert(
        'Open link?',
        `This opens ${host || 'the link'} in your browser, outside Study Notes.\n\n${url.slice(0, 300)}`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Open', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    }),
};
