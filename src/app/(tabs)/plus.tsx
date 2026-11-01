/** Placeholder route behind the centre + tab (the button opens /new instead). */
import { Redirect } from 'expo-router';

export default function NewTab() {
  return <Redirect href="/home" />;
}
