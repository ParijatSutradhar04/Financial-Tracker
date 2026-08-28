import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../supabase';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  async function submit() {
    if (!email.trim() || !password) {
      setError('Enter your email and password');
      return;
    }
    setSigningIn(true);
    setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) setError(signInError.message);
    setSigningIn(false);
  }

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <KeyboardAvoidingView
        className="flex-1 items-center justify-center px-6"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="w-full max-w-sm gap-5">
          <View className="mb-2">
            <Text className="text-xl font-semibold tracking-tight text-ink">Finance</Text>
            <Text className="text-xs text-muted">Sign in to your dashboard</Text>
          </View>

          <View className="gap-1">
            <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Email</Text>
            <TextInput
              className="rounded-xl border border-border bg-white px-3 py-3 text-sm text-ink"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
            />
          </View>

          <View className="gap-1">
            <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Password</Text>
            <TextInput
              className="rounded-xl border border-border bg-white px-3 py-3 text-sm text-ink"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          {error && <Text className="text-xs text-red">{error}</Text>}

          <Pressable onPress={submit} disabled={signingIn} className="rounded-xl bg-accent py-3" style={{ opacity: signingIn ? 0.5 : 1 }}>
            <Text className="text-center text-sm font-semibold text-white">{signingIn ? 'Signing in…' : 'Sign In'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
