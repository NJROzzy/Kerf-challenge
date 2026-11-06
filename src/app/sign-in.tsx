import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { layout } from '@/constants/layout';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/auth';

export default function SignInScreen() {
  const theme = useTheme();
  const { signIn, message } = useSession();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit() {
    if (busy || !name.trim() || !password) return;
    setBusy(true);
    setError(undefined);
    try { await signIn(name.trim(), password); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to sign in. Check your connection.'); }
    finally { setBusy(false); }
  }
  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];
  return (
    <ThemedView style={styles.page}>
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[layout.content, styles.content]} keyboardShouldPersistTaps="handled">
          <ThemedText type="title">Kerf</ThemedText>
          <ThemedText type="subtitle">Every measurement. Together.</ThemedText>
          <ThemedText themeColor="textSecondary">Sign in to capture on site or follow your crew from the office.</ThemedText>
          <ThemedText type="smallBold">Name</ThemedText>
          <TextInput accessibilityLabel="Name" placeholder="Alex, Priya or Sam" placeholderTextColor={theme.textSecondary}
            value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} autoComplete="username"
            textContentType="username" style={inputStyle} editable={!busy} returnKeyType="next" />
          <ThemedText type="smallBold">Password</ThemedText>
          <TextInput accessibilityLabel="Password" placeholder="Password" placeholderTextColor={theme.textSecondary}
            value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}
            autoComplete="current-password" textContentType="password" style={inputStyle} editable={!busy}
            returnKeyType="go" onSubmitEditing={() => { void submit(); }} />
          {(error || message) && <ThemedText accessibilityLiveRegion="polite" themeColor="danger">{error ?? message}</ThemedText>}
          <Button title={busy ? 'Signing in…' : 'Sign in'} variant="primary" size="large"
            disabled={busy || !name.trim() || !password} onPress={() => { void submit(); }} />
          <Card>
            <ThemedText type="smallBold">Demo accounts</ThemedText>
            <ThemedText type="small">Alex / kerf-alex-demo · three projects</ThemedText>
            <ThemedText type="small">Priya / kerf-priya-demo · shared kitchen</ThemedText>
            <ThemedText type="small">Sam / kerf-sam-demo · separate deck</ThemedText>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { paddingTop: Spacing.six, paddingBottom: Spacing.five, maxWidth: 520, gap: Spacing.three },
  input: { minHeight: 52, padding: Spacing.three, borderRadius: 10, fontSize: 18 },
});
