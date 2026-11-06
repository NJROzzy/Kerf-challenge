import { formatValue, type FeedItem, type Unit } from '@kerf/shared';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function FeedRow({ item, unit }: { item: FeedItem; unit: Unit }) {
  return (
    <Link
      href={{ pathname: '/projects/[id]', params: { id: item.projectId, name: item.projectName } }}
      asChild>
      <Pressable style={styles.row}>
        <View style={styles.main}>
          <ThemedText numberOfLines={1}>{item.label}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {item.projectName} · {item.groupName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {item.capturedBy} · {item.deviceId}
          </ThemedText>
        </View>
        <View style={styles.side}>
          <ThemedText type="smallBold">{formatValue(item.value, unit)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatTime(item.createdAt)}
          </ThemedText>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  main: {
    flex: 1,
  },
  side: {
    alignItems: 'flex-end',
  },
});
