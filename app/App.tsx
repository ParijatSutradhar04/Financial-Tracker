import './global.css';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { DMMono_400Regular, DMMono_500Medium } from '@expo-google-fonts/dm-mono';
import { supabase } from './src/supabase';
import { LoginScreen } from './src/screens/LoginScreen';
import { Dashboard } from './src/screens/Dashboard';

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    DMMono_400Regular,
    DMMono_500Medium,
  });

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  if (!fontsLoaded || !sessionLoaded) return null;

  return (
    <SafeAreaProvider>
      {session ? <Dashboard /> : <LoginScreen />}
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
