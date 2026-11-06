import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useLive } from '@/lib/live';
import { useSession } from '@/lib/auth';

export function LiveSummary() {
  const { status, online, lastSynced, error } = useLive();
  const { session } = useSession();
  const title = { connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', disconnected: 'Disconnected · retrying' }[status];
  return (
    <View style={styles.summary}>
      <ThemedText type="smallBold" accessibilityLiveRegion="polite"
        themeColor={status === 'live' ? 'success' : status === 'disconnected' ? 'danger' : 'warning'}>
        {title}{lastSynced && status !== 'live' ? ` · last synced ${new Date(lastSynced).toLocaleTimeString()}` : ''}
      </ThemedText>
      {error && <ThemedText type="small" themeColor="danger">{error}</ThemedText>}
      <ThemedText type="small" themeColor="textSecondary">
        {status === 'live' ? `Online · ${online.map((user) => user.id === session?.user.id ? `${user.name} (you)` : user.name).join(', ') || 'No crew online'}` : 'Online crew unavailable until connected.'}
      </ThemedText>
    </View>
  );
}
const styles = StyleSheet.create({ summary: { gap: Spacing.one, paddingVertical: Spacing.two } });
