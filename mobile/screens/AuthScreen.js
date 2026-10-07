import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, saveAuth } from '../api/client';

export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobileNo, setMobileNo] = useState('');
  const [password, setPassword] = useState('');
  const [district, setDistrict] = useState('Ratnapura');
  const [lang, setLang] = useState('en');
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    try {
      const path = mode === 'signin' ? '/auth/signin' : '/auth/signup';
      const body =
        mode === 'signin'
          ? { email, password }
          : { fullName, email, mobileNo, password, district, preferredLanguage: lang };
      const { data } = await api.post(path, body);
      await saveAuth(data);
      onAuth(data.user);
    } catch (err) {
      setError(err?.response?.data?.error || 'Network error — try again');
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SafeLanka</Text>
      {mode === 'signup' && (
        <TextInput style={styles.input} placeholder="Full name" value={fullName} onChangeText={setFullName} />
      )}
      <TextInput style={styles.input} placeholder="Email" autoCapitalize="none" value={email} onChangeText={setEmail} />
      {mode === 'signup' && (
        <TextInput style={styles.input} placeholder="Mobile" value={mobileNo} onChangeText={setMobileNo} />
      )}
      <TextInput style={styles.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      {mode === 'signup' && (
        <TextInput style={styles.input} placeholder="District" value={district} onChangeText={setDistrict} />
      )}
      {mode === 'signup' && (
        <View style={styles.langRow}>
          {['en', 'si', 'ta'].map((l) => (
            <View key={l} style={[styles.chip, lang === l && styles.chipOn]}>
              <Button title={l.toUpperCase()} onPress={() => setLang(l)} />
            </View>
          ))}
        </View>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button title={mode === 'signin' ? 'Sign in' : 'Sign up'} onPress={submit} />
      <Button
        title={mode === 'signin' ? 'No account? Sign up' : 'Have an account? Sign in'}
        onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 10 },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10 },
  langRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 16, overflow: 'hidden' },
  chipOn: { borderColor: '#f9a825', backgroundColor: '#fff3cd' },
  error: { color: 'red', textAlign: 'center' }
});
