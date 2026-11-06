import { formatValue, type Group, type NewMeasurement, type SyncStatus } from '@kerf/shared';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Chips } from '@/components/chips';
import { MeasurementRow } from '@/components/measurement-row';
import { StatusMessage } from '@/components/status-message';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { layout } from '@/constants/layout';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { tape } from '@/lib/tape';
import { useSettings } from '@/lib/settings';
import { useLoad } from '@/lib/use-load';

type Reading = NewMeasurement & { key: string; groupId: number; status: SyncStatus; error?: string };

export default function CaptureScreen() {
  const theme = useTheme();
  const projects = useLoad(useCallback(() => api.projects(), []));
  const [projectId, setProjectId] = useState<number>();
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<number>();
  const [groupError, setGroupError] = useState<string>();
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupAttempt, setGroupAttempt] = useState(0);
  const [label, setLabel] = useState('');
  const [lastValue, setLastValue] = useState<number>();
  const [readings, setReadings] = useState<Reading[]>([]);
  const { unit } = useSettings();

  useEffect(() => {
    if (projectId === undefined) return;
    let active = true;
    api.measurements(projectId).then((result) => {
      if (!active) return;
      setGroups(result);
      setGroupId(result[0]?.id);
    }).catch((error) => {
      if (active) setGroupError(error instanceof Error ? error.message : 'Could not load groups.');
    }).finally(() => { if (active) setGroupLoading(false); });
    return () => { active = false; };
  }, [projectId, groupAttempt]);

  const save = useCallback(async (reading: Reading) => {
    const update = (status: SyncStatus, error?: string) => setReadings((previous) =>
      previous.map((item) => item.key === reading.key ? { ...item, status, error } : item));
    update('pending');
    try {
      await api.addMeasurement(reading.groupId, { value: reading.value, label: reading.label,
        deviceId: reading.deviceId, clientId: reading.clientId });
      update('synced');
    } catch (error) {
      update('failed', error instanceof Error ? error.message : 'Could not confirm this reading.');
    }
  }, []);

  useEffect(() => tape.subscribe((notification) => {
    const value = Math.round(notification.value / 1000);
    setLastValue(value);
    if (groupId === undefined || !label.trim()) return;
    const key = randomUUID();
    const reading: Reading = { key, clientId: key, groupId, label: label.trim(), value,
      deviceId: notification.deviceId, status: 'pending' };
    setReadings((previous) => [reading, ...previous]);
    void save(reading);
  }), [groupId, label, save]);

  const ready = groupId !== undefined && !!label.trim() && !groupLoading;
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={layout.content} keyboardShouldPersistTaps="handled">
      <ThemedText type="smallBold">Project</ThemedText>
      {!projects.data && <StatusMessage loading={projects.loading} error={projects.error} />}
      {projects.error && <Button title="Retry projects" onPress={projects.refresh} />}
      <Chips options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
        selected={projectId} onSelect={(id) => {
          if (id === projectId) return;
          setGroupId(undefined); setGroups([]); setGroupLoading(true); setGroupError(undefined); setProjectId(id);
        }} />
      {groupLoading && <StatusMessage loading />}
      {groupError && <><ThemedText themeColor="danger">{groupError}</ThemedText>
        <Button title="Retry groups" onPress={() => {
          setGroupLoading(true); setGroupError(undefined); setGroupAttempt((attempt) => attempt + 1);
        }} /></>}
      {groups.length > 0 && <>
        <ThemedText type="smallBold">Group</ThemedText>
        <Chips options={groups.map((g) => ({ value: g.id, label: g.name }))} selected={groupId} onSelect={setGroupId} />
      </>}
      <ThemedText type="smallBold">Label</ThemedText>
      <TextInput accessibilityLabel="Measurement label" value={label} onChangeText={setLabel} maxLength={200}
        placeholder="e.g. Sink wall run" placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
      <ThemedView type="backgroundElement" style={styles.panel}>
        <ThemedText type="small" themeColor="textSecondary">{tape.deviceId} · simulated tape</ThemedText>
        <ThemedText type="title">{lastValue === undefined ? '—' : formatValue(lastValue, unit)}</ThemedText>
      </ThemedView>
      <Button title="Measure" variant="primary" size="large" disabled={!ready} onPress={() => tape.measure()} />
      {!ready && <ThemedText type="small" themeColor="textSecondary">Pick a project and group, then enter a label to save readings.</ThemedText>}
      {readings.some((reading) => reading.status !== 'synced') && <ThemedText type="small" themeColor="warning">
        Keep this screen open until readings sync. Failed readings need a retry; they are not stored offline.
      </ThemedText>}
      {readings.map((reading) => <View key={reading.key}>
        <MeasurementRow label={reading.label} value={formatValue(reading.value, unit)} status={reading.status} />
        {reading.status === 'failed' && <>
          <ThemedText type="small" themeColor="danger">{reading.error} Retry safely to confirm it was saved.</ThemedText>
          <Button title={`Retry ${reading.label}`} onPress={() => { void save(reading); }} />
        </>}
      </View>)}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  input: { borderRadius: 10, padding: Spacing.three, fontSize: 18, minHeight: 52 },
  panel: { borderRadius: 16, padding: Spacing.four, alignItems: 'center', gap: Spacing.two, marginTop: Spacing.three },
});
