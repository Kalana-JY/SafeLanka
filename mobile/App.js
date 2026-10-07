import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

const TABS = [
  { name: 'Alerts', key: 'alerts', icon: 'notifications-outline', activeIcon: 'notifications' },
  { name: 'Report', key: 'report', icon: 'add-circle-outline', activeIcon: 'add-circle' },
  { name: 'Shelters', key: 'shelters', icon: 'home-outline', activeIcon: 'home' },
  { name: 'My Reports', key: 'myReports', icon: 'list-outline', activeIcon: 'list' },
  { name: 'Profile', key: 'profile', icon: 'person-outline', activeIcon: 'person' }
];

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
        {TABS.map((tb) => {
          const active = tab === tb.name;
          return (
            <TouchableOpacity
              key={tb.name}
              style={[styles.tabBtn, active && styles.tabBtnActive]}
              activeOpacity={0.7}
              onPress={() => { setTab(tb.name); refreshPending(); }}
            >
              <View style={styles.iconWrap}>
                <Ionicons name={active ? tb.activeIcon : tb.icon} size={24} color={active ? '#7a5c00' : '#666'} />
                {tb.name === 'My Reports' && pending > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{pending > 9 ? '9+' : pending}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t(lang, tb.key)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 4,
    paddingBottom: 12
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderRadius: 12
  },
  tabBtnActive: { backgroundColor: '#fff3cd' },
  iconWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -6,
    right: -14,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#c62828',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  tabLabel: { fontSize: 11, color: '#666', marginTop: 2, textAlign: 'center' },
  tabLabelActive: { color: '#7a5c00', fontWeight: 'bold' },
  sync: { textAlign: 'center', color: '#b7791f', paddingVertical: 4 }
});
