import { useCallback, useEffect, useState } from 'react';
import { Button, FlatList, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';

const LEVEL_STYLE = {
  WATCH: { border: '#1976d2', tint: '#e3f2fd' },
  WARNING: { border: '#f9a825', tint: '#fff8e1' },
  EVACUATE: { border: '#c62828', tint: '#fdecea' },
  ALL_CLEAR: { border: '#2e7d32', tint: '#e8f5e9' }
};

function expiresIn(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3600000);
  return h > 0 ? `expires in ~${h}h` : `expires in ~${Math.max(1, Math.floor(ms / 60000))}m`;
}

export default function AlertsScreen({ user }) {
  const [items, setItems] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const district = user?.district ? `?district=${encodeURIComponent(user.district)}` : '';
      const { data } = await api.get(`/alerts/active${district}`);
      setItems(data.alerts || []);
      setError('');
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load alerts');
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const lang = user?.preferredLanguage || 'en';
  const text = (rec) => rec?.[lang] || rec?.en || '';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Active alerts</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button title="Refresh" onPress={load} />
      <FlatList
        data={items}
        keyExtractor={(a) => a._id}
        renderItem={({ item }) => {
          const st = LEVEL_STYLE[item.level] || { border: '#999', tint: '#fff' };
          return (
            <View style={[styles.card, { borderLeftColor: st.border, backgroundColor: st.tint }]}>
              <Text style={[styles.level, { color: st.border }]}>
                {item.level}
                {item.version > 1 ? ` · update v${item.version}` : ''}
              </Text>
              <Text style={styles.head}>{text(item.headline)}</Text>
              <Text style={styles.expiry}>{expiresIn(item.expiresAt)}</Text>
              <Button title={openId === item._id ? 'Hide' : 'Details'} onPress={() => setOpenId(openId === item._id ? null : item._id)} />
              {openId === item._id && (
                <View>
                  <Text>{text(item.body)}</Text>
                  <Text>Expires: {new Date(item.expiresAt).toLocaleString()}</Text>
                </View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={<Text>No active alerts</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  error: { color: 'red' },
  card: { borderWidth: 1, borderColor: '#ddd', borderLeftWidth: 6, borderRadius: 8, padding: 10, marginVertical: 6 },
  level: { fontWeight: 'bold' },
  expiry: { fontSize: 12, color: '#666' },
  head: { fontSize: 16, marginVertical: 4 }
});
