import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Until Task #7 (Supabase project setup) is done these are blank, and the
// dashboard itself is still worth being able to run and look at — so this
// warns instead of throwing. `createClient` itself throws synchronously on
// an empty URL/key, so a placeholder is substituted to keep module import
// from crashing; anything that actually calls `supabase.auth` before real
// credentials exist will fail at the network layer, not here.
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set — auth will not work yet.',
  );
}

// AsyncStorage rather than expo-secure-store: a Supabase session (access +
// refresh token + user object) can exceed SecureStore's 2048-byte-per-key
// limit, and this is a single-user personal app on the user's own device, so
// unencrypted local storage is an acceptable trade for not having to chunk
// the session across multiple SecureStore keys.
export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder-anon-key', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
