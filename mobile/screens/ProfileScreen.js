import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { api, clearAuth } from '../api/client';
import { t } from '../i18n';

export default function ProfileScreen({ user, lang, onUpdate, onSignOut }) {
  const [msg, setMsg] = useState('');

  async function signOut() {
    await clearAuth();
    onSignOut();
  }

  async function toggleOptIn() {
    try {
      const { data } = await api.patch('/users/me', { alertOptIn: !user.alertOptIn });
      onUpdate(data.user);
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Update failed');
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t(lang, 'profile')}</Text>
      <Text>{user?.fullName}</Text>
      <Text>{user?.email}</Text>
      <Text>
        {user?.role}
        {user?.role === 'VOLUNTEER' ? ' (volunteer ✓)' : ''}
      </Text>
      <Text>District: {user?.district}</Text>
      <Text>
        {t(lang, 'language')}: English
      </Text>
      <Button
        title={`${t(lang, 'optIn')}: ${user?.alertOptIn === false ? 'OFF' : 'ON'}`}
        onPress={toggleOptIn}
      />
      {!!msg && <Text style={styles.error}>{msg}</Text>}
      <Button title={t(lang, 'signOut')} onPress={signOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 8 },
  title: { fontSize: 20, fontWeight: 'bold' },
  error: { color: 'red' }
});
