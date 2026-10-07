import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { api, loadToken } from './api/client';
import { flushPending, pendingCount } from './store/sync';
import AuthScreen from './screens/AuthScreen';
import ReportScreen from './screens/ReportScreen';
import MyReportsScreen from './screens/MyReportsScreen';
import AlertsScreen from './screens/AlertsScreen';
import SheltersScreen from './screens/SheltersScreen';
import ProfileScreen from './screens/ProfileScreen';
import { getLang, t } from './i18n';

const TABS = ['Alerts', 'Report', 'Shelters', 'My Reports', 'Profile'];
const TAB_KEYS = { Alerts: 'alerts', Report: 'report', Shelters: 'shelters', 'My Reports': 'myReports', Profile: 'profile' };

export default function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('Alerts');
  const [lang, setLang] = useState('en');
  const [pending, setPending] = useState(0);
  const [reportTick, setReportTick] = useState(0);

  const refreshPending = useCallback(async () => setPending(await pendingCount()), []);

  useEffect(() => {
    (async () => {
      try {
        setLang(await getLang());
        const token = await loadToken();
        if (token) {
          const { data } = await api.get('/auth/me');
          setUser(data.user);
        }
      } catch {
        // expired token — fall through to auth screen
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // Flush offline outbox whenever the app regains a signed-in session.
  useEffect(() => {
    if (!user) return;
    (async () => {
      await flushPending((draft) => api.post('/reports', draft));
      await refreshPending();
    })();
  }, [user, reportTick, refreshPending]);

  if (booting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.root}>
        <AuthScreen onAuth={setUser} />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        {tab === 'Alerts' && <AlertsScreen user={user} />}
        {tab === 'Report' && (
          <ReportScreen
            onSubmitted={() => {
              setReportTick((t) => t + 1);
              setTab('My Reports');
            }}
          />
        )}
        {tab === 'Shelters' && <SheltersScreen user={user} />}
        {tab === 'My Reports' && <MyReportsScreen key={reportTick} />}
        {tab === 'Profile' && <ProfileScreen user={user} lang={lang} setLang={setLang} onUpdate={setUser} onSignOut={() => setUser(null)} />}
      </View>
      {pending > 0 && <Text style={styles.sync}>{pending} report(s) waiting to sync</Text>}
      <View style={styles.tabs}>
        {TABS.map((name) => (
          <Button key={name} title={t(lang, TAB_KEYS[name])} onPress={() => { setTab(name); refreshPending(); }} />
        ))}
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  tabs: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderColor: '#ddd', paddingVertical: 6 },
  sync: { textAlign: 'center', color: '#b7791f', paddingVertical: 4 }
});
