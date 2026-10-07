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
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    try {
      const path = mode === 'signin' ? '/auth/signin' : '/auth/signup';
      const body =
        mode === 'signin'
          ? { email, password }
          : { fullName, email, mobileNo, password, district, preferredLanguage: 'en' };
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
        <TextInput
          id="fullName"
          name="fullName"
          autoComplete="name"
          textContentType="name"
          style={styles.input}
          placeholder="Full name"
          value={fullName}
          onChangeText={setFullName}
        />
      )}
      <TextInput
        id="email"
        name="email"
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />
      {mode === 'signup' && (
        <TextInput
          id="mobileNo"
          name="tel"
          autoComplete="tel"
          textContentType="telephoneNumber"
          keyboardType="phone-pad"
          style={styles.input}
          placeholder="Mobile"
          value={mobileNo}
          onChangeText={setMobileNo}
        />
      )}
      <TextInput
        id="password"
        name="password"
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        textContentType="password"
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {mode === 'signup' && (
        <TextInput
          id="district"
          name="district"
          autoComplete="address-level2"
          style={styles.input}
          placeholder="District"
          value={district}
          onChangeText={setDistrict}
        />
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
  error: { color: 'red', textAlign: 'center' }
});
