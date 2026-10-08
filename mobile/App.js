import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, Platform } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold
} from '@expo-google-fonts/montserrat';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, loadToken } from './api/client';
import { flushPending, pendingCount } from './store/sync';
import AuthScreen from './screens/AuthScreen';
import HomeScreen from './screens/HomeScreen';
import ReportScreen from './screens/ReportScreen';
import MyReportsScreen from './screens/MyReportsScreen';
import CommunityScreen from './screens/CommunityScreen';
import AlertsScreen from './screens/AlertsScreen';
import SheltersScreen from './screens/SheltersScreen';
import ProfileScreen from './screens/ProfileScreen';
import BottomNavBar from './components/BottomNavBar';
import NotificationsModal from './components/NotificationsModal';
import { getLang, t } from './i18n';

export default function App() {
  const [fontsLoaded] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold
  });

  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('Home');
  const [lang, setLang] = useState('en');
  const [pending, setPending] = useState(0);
  const [reportTick, setReportTick] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const [hasNewAlerts, setHasNewAlerts] = useState(false);

  const refreshPending = useCallback(async () => setPending(await pendingCount()), []);

  const checkUnreadNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await api.get('/reports/notifications');
      const list = data.notifications || [];
      if (list.length === 0) {
        setHasUnreadNotifications(false);
        return;
      }
      const lastSeen = await AsyncStorage.getItem('last_seen_notif_time');
      const lastSeenTime = lastSeen ? parseInt(lastSeen, 10) : 0;
      const hasNew = list.some((n) => {
        const time = new Date(n.timestamp).getTime();
        return time > lastSeenTime;
      });
      setHasUnreadNotifications(hasNew);
    } catch {
      // ignore
    }
  }, [user]);

  const checkNewAlerts = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await api.get('/alerts/active');
      const list = data.alerts || [];
      if (list.length === 0) {
        setHasNewAlerts(false);
        return;
      }
      const lastSeen = await AsyncStorage.getItem('last_seen_alert_time');
      const lastSeenTime = lastSeen ? parseInt(lastSeen, 10) : 0;
      const now = Date.now();
      const activeAlerts = list.filter((a) => {
        const isExpired = a.expiresAt && new Date(a.expiresAt).getTime() <= now;
        return !isExpired && a.level !== 'ALL_CLEAR';
      });
      if (activeAlerts.length === 0) {
        setHasNewAlerts(false);
        return;
      }
      const hasNew = activeAlerts.some((a) => {
        const alertTime = new Date(a.publishedAt || a.updatedAt || a.createdAt).getTime();
        return alertTime > lastSeenTime;
      });
      setHasNewAlerts(hasNew);
    } catch {
      // ignore
    }
  }, [user]);

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

  // Periodic polling for notifications and alerts badges
  useEffect(() => {
    if (!user) return;
    checkUnreadNotifications();
    checkNewAlerts();

    const interval = setInterval(() => {
      checkUnreadNotifications();
      checkNewAlerts();
    }, 15000);

    return () => clearInterval(interval);
  }, [user, reportTick, checkUnreadNotifications, checkNewAlerts]);

  if (!fontsLoaded || booting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
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

  const navigateTo = async (tabName) => {
    setTab(tabName);
    refreshPending();
    if (tabName === 'Alerts') {
      setHasNewAlerts(false);
      await AsyncStorage.setItem('last_seen_alert_time', Date.now().toString());
    }
  };

  const openNotifications = async () => {
    setNotificationsOpen(true);
    setHasUnreadNotifications(false);
    await AsyncStorage.setItem('last_seen_notif_time', Date.now().toString());
  };

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        {tab === 'Home' && (
          <HomeScreen
            user={user}
            onNavigate={navigateTo}
            onOpenNotifications={openNotifications}
            hasUnreadNotifications={hasUnreadNotifications}
          />
        )}
        {tab === 'Alerts' && (
          <AlertsScreen
            user={user}
            onNavigate={navigateTo}
            onOpenNotifications={openNotifications}
            hasUnreadNotifications={hasUnreadNotifications}
          />
        )}
        {tab === 'Report' && (
          <ReportScreen
            onSubmitted={() => {
              setReportTick((t) => t + 1);
              checkUnreadNotifications();
              setTab('My Reports');
            }}
            onNavigate={navigateTo}
            onOpenNotifications={openNotifications}
            hasUnreadNotifications={hasUnreadNotifications}
          />
        )}
        {tab === 'Shelters' && (
          <SheltersScreen
            user={user}
            onNavigate={navigateTo}
            onOpenNotifications={openNotifications}
            hasUnreadNotifications={hasUnreadNotifications}
          />
        )}
        {(tab === 'Reports' || tab === 'Community') && (
          <CommunityScreen
            user={user}
            onNavigate={navigateTo}
            onOpenNotifications={openNotifications}
            hasUnreadNotifications={hasUnreadNotifications}
          />
        )}
        {tab === 'My Reports' && (
          <MyReportsScreen
            key={reportTick}
            onNavigate={navigateTo}
            onOpenNotifications={openNotifications}
            hasUnreadNotifications={hasUnreadNotifications}
          />
        )}
        {tab === 'Profile' && (
          <ProfileScreen
            user={user}
            lang={lang}
            setLang={setLang}
            onUpdate={setUser}
            onSignOut={() => setUser(null)}
            onNavigate={navigateTo}
            onOpenNotifications={openNotifications}
            hasUnreadNotifications={hasUnreadNotifications}
          />
        )}
      </View>

      {pending > 0 && <Text style={styles.sync}>{pending} report(s) waiting to sync</Text>}

      {/* Reusable Bottom Tab Navigation Bar */}
      <BottomNavBar
        activeTab={tab}
        onNavigate={navigateTo}
        pending={pending}
        lang={lang}
        hasNewAlerts={hasNewAlerts}
      />

      {/* Report Status Updates Modal */}
      <NotificationsModal
        visible={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        onNavigate={navigateTo}
      />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? 36 : 44,
    backgroundColor: '#ffffff'
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff'
  },
  body: {
    flex: 1
  },
  sync: {
    fontFamily: 'Montserrat_500Medium',
    textAlign: 'center',
    color: '#d97706',
    backgroundColor: '#fef3c7',
    paddingVertical: 4,
    fontSize: 12
  }
});
