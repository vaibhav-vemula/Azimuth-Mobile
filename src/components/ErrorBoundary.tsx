import { Component, ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography } from '../theme';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Minimal, generic error boundary: catches any unexpected render-time error
// in its subtree and shows a simple fallback instead of taking down the
// whole app. No retry logic - navigating away and back (or reopening the
// screen) is the recovery path.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.message}>Something went wrong.</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  message: { ...typography.body, color: colors.textSecondary },
});
