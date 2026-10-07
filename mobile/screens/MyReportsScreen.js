import { useCallback, useEffect, useState } from 'react';
import { Button, FlatList, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';

const PILL = { SUBMITTED: '#b7791f', UNDER_REVIEW: '#666', VERIFIED: '#2e7d32', REJECTED: '#c62828' };

export default function MyReportsScreen() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/reports/mine');
      setItems(data.reports || []);
      setError('');
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load reports');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My reports</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button title="Refresh" onPress={load} />
      <FlatList
        data={items}
        keyExtractor={(it) => it.report._id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.ref}>
              {item.report.ref} · {item.report.hazardType}
            </Text>
            <Text style={[styles.pill, { color: PILL[item.report.status] || '#000' }]}>{item.report.status}</Text>
            <Text>{item.report.description}</Text>
            {item.report.sensorCorroborated && <Text>✓ corroborated by nearby sensor</Text>}
            {item.report.status === 'UNDER_REVIEW' && (!item.evidence || item.evidence.length === 0) && (
              <Text style={styles.hint}>Low-trust (no photo) — officer reviews first</Text>
            )}
          </View>
        )}
        ListEmptyComponent={<Text>No reports yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  error: { color: 'red' },
  card: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginVertical: 6 },
  ref: { fontWeight: 'bold' },
  pill: { fontWeight: 'bold' },
  hint: { backgroundColor: '#fff3cd', padding: 6, borderRadius: 4, marginTop: 4 }
});
