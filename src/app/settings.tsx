import { UNIT_LABELS, type Unit } from '@kerf/shared';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chips } from '@/components/chips';
import { ThemedText } from '@/components/themed-text';
import { layout } from '@/constants/layout';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { updateSettings, useSettings } from '@/lib/settings';

const UNITS = Object.keys(UNIT_LABELS) as Unit[];

export default function SettingsScreen() {
  const settings = useSettings();
  const { session, signOut } = useSession();
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    setStatus(undefined);
    try { await signOut(); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not sign out.'); }
    finally { setBusy(false); }
  }
  async function reset() {
    setBusy(true);
    setStatus('Resetting…');
    try { await api.reset(); await signOut(); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Reset failed.'); }
    finally { setBusy(false); }
  }
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={layout.content}>
      <Card>
        <ThemedText type="smallBold">Signed in as {session?.user.name}</ThemedText>
        <Button title={busy ? 'Please wait…' : 'Sign out'} onPress={() => { void logout(); }} disabled={busy} />
        {status && <ThemedText type="small" themeColor="danger" accessibilityLiveRegion="polite">{status}</ThemedText>}
      </Card>
      <Card>
        <ThemedText type="smallBold">Units</ThemedText>
        <Chips options={UNITS.map((unit) => ({ value: unit, label: UNIT_LABELS[unit] }))}
          selected={settings.unit} onSelect={(unit) => updateSettings({ unit })} />
      </Card>
      {__DEV__ && <>
        <ThemedText type="small" themeColor="textSecondary" style={styles.heading}>DEVELOPER</ThemedText>
        <Card>
          <ThemedText type="smallBold">Seed data</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Deletes all captured measurements, restores demo data and signs everyone out. Available only on development/test APIs.</ThemedText>
          <Button title="Reset demo data & sign everyone out" onPress={() => { void reset(); }} disabled={busy} />
        </Card>
      </>}
    </ScrollView>
  );
}
const styles = StyleSheet.create({ heading: { marginTop: Spacing.three } });
