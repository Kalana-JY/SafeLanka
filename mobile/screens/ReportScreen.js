import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, TouchableOpacity, View, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import OsmMap from '../components/OsmMap';
import { api } from '../api/client';
import { enqueueReport, newClientUUID } from '../store/sync';

const TYPES = ['FLOOD', 'LANDSLIDE', 'CYCLONE', 'TSUNAMI', 'OTHER'];

function isNetworkError(err) {
  return !err?.response;
}

export default function ReportScreen({ onSubmitted }) {
  const [step, setStep] = useState(0);
  const [hazardType, setHazardType] = useState('FLOOD');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState(null);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [accuracy, setAccuracy] = useState(null);
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  const hasPin = lat !== '' && lng !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

  async function pickPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5 });
    if (!res.canceled) setPhoto(res.assets[0].base64);
  }

  async function useGps() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setResult('Location permission denied — enter coordinates manually');
      return;
    }
    const pos = await Location.getCurrentPositionAsync({});
    setLat(String(pos.coords.latitude));
    setLng(String(pos.coords.longitude));
    setAccuracy(pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null);
  }

  function onPickOnMap(d) {
    setLat(String(d.lat));
    setLng(String(d.lng));
  }

  async function submit() {
    setBusy(true);
    setResult('');
    const draft = {
      hazardType,
      description,
      lat: Number(lat),
      lng: Number(lng),
      mediaType: 'PHOTO',
      ...(photo ? { evidenceBase64: photo } : {}),
      clientUUID: newClientUUID()
    };
    try {
      const { data } = await api.post('/reports', draft);
      setResult(`Submitted: ${data.report.ref} (${data.report.status})`);
      setStep(0);
      setDescription('');
      setPhoto(null);
      onSubmitted?.();
    } catch (err) {
      if (isNetworkError(err)) {
        const n = await enqueueReport(draft);
        setResult(`Offline — queued (${n} pending). Will sync on reconnect.`);
      } else {
        setResult(err?.response?.data?.error || 'Submit failed');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Report hazard ({step + 1}/3)</Text>
      {step === 0 && (
        <View style={styles.group}>
          <View style={styles.chips}>
            {TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.chip, hazardType === t && styles.chipOn]}
                onPress={() => setHazardType(t)}
              >
                <Text style={hazardType === t ? styles.chipTextOn : styles.chipText}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Button title="Next" onPress={() => setStep(1)} />
        </View>
      )}
      {step === 1 && (
        <View style={styles.group}>
          <TextInput style={styles.input} placeholder="What do you see?" multiline value={description} onChangeText={setDescription} />
          <View style={styles.dropbox}>
            <Button title={photo ? 'Photo attached ✓ (tap to change)' : 'Attach photo (optional)'} onPress={pickPhoto} />
          </View>
          {photo && <Text>Low-trust flag off — evidence attached</Text>}
          {!photo && <Text style={styles.lowtrust}>No photo — submits as low-trust, officer reviews first</Text>}
          <Button title="Back" onPress={() => setStep(0)} />
          <Button title="Next" disabled={!description.trim()} onPress={() => setStep(2)} />
        </View>
      )}
      {step === 2 && (
        <View style={styles.group}>
          <Button title="Use GPS location" onPress={useGps} />
          {accuracy != null && <Text>GPS accurate to ~{accuracy} metres — drag pin to correct if needed</Text>}
          {!hasPin && <Text style={styles.mapHint}>Map below — tap Use GPS or tap anywhere on the map to drop a pin (Sri Lanka view).</Text>}
          <OsmMap
            key={hasPin ? `${lat},${lng}` : 'default'}
            lat={lat}
            lng={lng}
            accuracy={accuracy}
            onPick={onPickOnMap}
          />
          <Text style={styles.osm}>Map © OpenStreetMap contributors (free, no Google) — tap map or drag pin to adjust</Text>
          <TextInput style={styles.input} placeholder="Latitude" keyboardType="numeric" value={lat} onChangeText={setLat} />
          <TextInput style={styles.input} placeholder="Longitude" keyboardType="numeric" value={lng} onChangeText={setLng} />
          <Button title="Back" onPress={() => setStep(1)} />
          <Button title={busy ? 'Sending…' : 'Submit report'} disabled={busy || !lat || !lng} onPress={submit} />
        </View>
      )}
      {!!result && <Text style={styles.result}>{result}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 10, flexGrow: 1 },
  title: { fontSize: 20, fontWeight: 'bold' },
  group: { gap: 10 },
  row: { marginVertical: 2 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10 },
  mapWrap: { height: 280, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#ccc' },
  map: { width: '100%', height: '100%' },
  mapHint: { backgroundColor: '#e3f2fd', padding: 6, borderRadius: 4 },
  osm: { fontSize: 12, color: '#666' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 16, paddingVertical: 8, paddingHorizontal: 14 },
  chipOn: { borderColor: '#f9a825', backgroundColor: '#fff3cd' },
  chipText: { color: '#333' },
  chipTextOn: { color: '#7a5c00', fontWeight: 'bold' },
  dropbox: { borderWidth: 2, borderStyle: 'dashed', borderColor: '#999', borderRadius: 8, padding: 6 },
  lowtrust: { backgroundColor: '#fff3cd', padding: 6, borderRadius: 4 },
  result: { marginTop: 10, fontWeight: 'bold' }
});
