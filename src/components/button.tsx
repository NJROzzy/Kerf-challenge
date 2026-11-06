import { Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  title: string;
  variant?: 'primary' | 'secondary';
  size?: 'normal' | 'large';
};

export function Button({
  title,
  variant = 'secondary',
  size = 'normal',
  disabled,
  ...props
}: ButtonProps) {
  const theme = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        size === 'large' && styles.large,
        { backgroundColor: primary ? theme.tint : theme.backgroundElement },
        (pressed || disabled) && styles.dimmed,
      ]}>
      <ThemedText
        type={size === 'large' ? 'subtitle' : 'smallBold'}
        style={primary ? { color: theme.tintText } : undefined}>
        {title}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
  large: {
    paddingVertical: Spacing.four,
    borderRadius: 16,
  },
  dimmed: {
    opacity: 0.6,
  },
});
