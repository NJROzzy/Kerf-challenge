import { Link } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { FeedRow } from '@/components/feed-row';
import { LiveSummary } from '@/components/live-summary';
import { StatusMessage } from '@/components/status-message';
import { ThemedText } from '@/components/themed-text';
import { layout } from '@/constants/layout';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth';
import { exportMeasurements } from '@/lib/export';
import { useLive } from '@/lib/live';
import { useSettings } from '@/lib/settings';

export default function DashboardScreen() {
  const { unit } = useSettings();
  const { session } = useSession();
  const { items, status, retry } = useLive();
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string>();
  async function download() {
    setExporting(true);
    setExportStatus(undefined);
    try {
      await exportMeasurements(unit);
      setExportStatus('CSV prepared. Choose where to save it on your device.');
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : 'Export failed. Check your connection and try again.');
    } finally { setExporting(false); }
  }
  return (
    <FlatList contentInsetAdjustmentBehavior="automatic" contentContainerStyle={layout.content}
      data={items} keyExtractor={(item) => String(item.id)}
      refreshControl={<RefreshControl refreshing={status === 'connecting'} onRefresh={retry} />}
      renderItem={({ item }) => <FeedRow item={item} unit={unit} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <ThemedText type="smallBold">{session?.user.name} · Office dashboard</ThemedText>
          <Link href="/settings" asChild><Button title="Account & units" /></Link>
          <LiveSummary />
          <Button title={exporting ? 'Preparing CSV…' : 'Export all my projects (CSV)'} onPress={() => { void download(); }} disabled={exporting} />
          <ThemedText type="small" themeColor="textSecondary">Exact numeric millimeters and inches, plus your display units.</ThemedText>
          {exportStatus && <ThemedText type="small" accessibilityLiveRegion="polite">{exportStatus}</ThemedText>}
          {status !== 'live' && <Button title="Reconnect now" onPress={retry} />}
          <ThemedText type="smallBold">Recent measurements · newest first</ThemedText>
        </View>
      }
      ListEmptyComponent={<StatusMessage loading={status === 'connecting'} />}
    />
  );
}
const styles = StyleSheet.create({ header: { marginBottom: Spacing.two, gap: Spacing.two } });
