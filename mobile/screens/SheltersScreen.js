import { useCallback, useEffect, useState } from 'react';
import { Button, FlatList, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';

const STATUS_COLOR = { OPEN: '#2e7d32', NEARLY_FULL: '#b7791f', FULL: '#c62828' };

export default function SheltersScreen({ user }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const district = user?.district ? `?district=${encodeURIComponent(user.district)}` : '';
      const { data } = await api.get(`/shelters/open${district}`);
      setItems(data.shelters || []);
      setError('');
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load shelters');
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Open shelters</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button title="Refresh" onPress={load} />
      <FlatList
        data={items}
        keyExtractor={(s) => s.shelter._id}
        renderItem={({ item }) => {
          const full = item.shelter.status === 'FULL';
          return (
            <View style={[styles.card, full && styles.full]}>
              <Text style={styles.name}>{item.shelter.buildingName}</Text>
              <Text style={{ color: STATUS_COLOR[item.shelter.status] || '#000', fontWeight: 'bold' }}>
                {item.shelter.status} · {item.occupancy}/{item.capacity}
              </Text>
              <View style={styles.bar}>
                <View
                  style={{
                    height: '100%',
                    width: `${item.capacity ? Math.round((100 * item.occupancy) / item.capacity) : 0}%`,
                    backgroundColor: STATUS_COLOR[item.shelter.status] || '#999'
                  }}
                />
              </View>
              {!!item.shelter.address && <Text>{item.shelter.address}</Text>}
              {full && <Text>Full — see alternate shelters</Text>}
            </View>
          );
        }}
        ListEmptyComponent={<Text>No open shelters</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  error: { color: 'red' },
  card: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginVertical: 6 },
  full: { backgroundColor: '#f5f5f5' },
  bar: { height: 8, backgroundColor: '#eee', borderRadius: 4, overflow: 'hidden', marginTop: 4 },
  name: { fontSize: 16, fontWeight: 'bold' }
});
