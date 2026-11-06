import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { StatusMessage } from '@/components/status-message';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { SessionProvider, useSession } from '@/lib/auth';
import { LiveProvider } from '@/lib/live';

function RootNavigator() {
  const { ready, session } = useSession();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {!ready ? <ThemedView style={{ flex: 1 }}><StatusMessage loading /></ThemedView> : (
        <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Protected guard={!!session}>
            <Stack.Screen name="index" options={{ title: 'Projects' }} />
            <Stack.Screen name="capture" options={{ title: 'Capture' }} />
            <Stack.Screen name="dashboard" options={{ title: 'Office dashboard' }} />
            <Stack.Screen name="settings" options={{ title: 'Settings' }} />
            <Stack.Screen name="projects/[id]" options={{ title: 'Project' }} />
          </Stack.Protected>
          <Stack.Protected guard={!session}>
            <Stack.Screen name="sign-in" options={{ title: 'Sign in', headerShown: false }} />
          </Stack.Protected>
        </Stack>
      )}
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return <SessionProvider><LiveProvider><RootNavigator /></LiveProvider></SessionProvider>;
}
