import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Platform
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';

const NOTIF_ICONS = {
  ACCEPTED: {
    icon: 'check-circle',
    color: '#10b981',
    bg: '#ecfdf5',
    border: '#a7f3d0'
  },
  UNDER_REVIEW: {
    icon: 'clock',
    color: '#f59e0b',
    bg: '#fffbeb',
    border: '#fde68a'
  },
  REJECTED: {
    icon: 'times-circle',
    color: '#ef4444',
    bg: '#fef2f2',
    border: '#fecaca'
  }
};

function formatTimeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function NotificationsModal({ visible, onClose, onNavigate }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const { data } = await api.get('/reports/notifications');
      setNotifications(data.notifications || []);
      await AsyncStorage.setItem('last_seen_notif_time', Date.now().toString());
    } catch {
      // Fallback
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setLoading(true);
      fetchNotifications();
    }
  }, [visible, fetchNotifications]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchNotifications();
  }, [fetchNotifications]);

  const handleOpenReport = () => {
    onClose?.();
    onNavigate?.('My Reports');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={styles.bellIconWrap}>
                <FontAwesome5 name="bell" size={16} color="#2563eb" solid />
              </View>
              <View>
                <Text style={styles.headerTitle}>Notifications</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.closeBtn}
              activeOpacity={0.7}
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <FontAwesome5 name="times" size={16} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* List Content */}
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="small" color="#2563eb" />
              <Text style={styles.loadingText}>Checking for notifications...</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563eb" />
              }
            >
              {notifications.length === 0 ? (
                <View style={styles.emptyWrap}>
                  <View style={styles.emptyIconCircle}>
                    <FontAwesome5 name="clipboard-check" size={28} color="#94a3b8" />
                  </View>
                  <Text style={styles.emptyTitle}>No notifications yet</Text>
                  <Text style={styles.emptySubtitle}>
                    Notifications will appear here.
                  </Text>
                </View>
              ) : (
                notifications.map((item) => {
                  const cfg = NOTIF_ICONS[item.type] || NOTIF_ICONS.UNDER_REVIEW;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.notifCard, { borderLeftColor: cfg.color }]}
                      activeOpacity={0.8}
                      onPress={handleOpenReport}
                    >
                      <View style={styles.cardTop}>
                        <View style={[styles.typeBadge, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
                          <FontAwesome5 name={cfg.icon} size={11} color={cfg.color} style={{ marginRight: 4 }} />
                          <Text style={[styles.typeBadgeText, { color: cfg.color }]}>{item.title}</Text>
                        </View>
                        <Text style={styles.timeText}>{formatTimeAgo(item.timestamp)}</Text>
                      </View>

                      <Text style={styles.messageText}>{item.message}</Text>

                      <View style={styles.cardFooter}>
                        <Text style={styles.refText}>#{item.ref || 'REPORT'}</Text>
                        <View style={styles.viewRow}>
                          <Text style={styles.viewText}>View in My Reports</Text>
                          <FontAwesome5 name="chevron-right" size={10} color="#2563eb" style={{ marginLeft: 4 }} />
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          )}

          {/* Footer Close */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.doneBtn}
              activeOpacity={0.8}
              onPress={onClose}
            >
              <Text style={styles.doneBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end'
  },
  container: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    minHeight: 380,
    paddingTop: 16,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 10 },
      android: { elevation: 10 },
      web: { boxShadow: '0 -4px 20px rgba(0,0,0,0.15)', maxWidth: 500, alignSelf: 'center', width: '100%' }
    })
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9'
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  bellIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center'
  },
  headerTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 16,
    color: '#0f172a',
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  headerSubtitle: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  closeBtn: {
    padding: 6
  },
  center: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center'
  },
  loadingText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 13,
    color: '#64748b',
    marginTop: 10,
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  scrollArea: {
    flex: 1
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 20
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12
  },
  emptyTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 4,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  emptySubtitle: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 18,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  notifCard: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 12,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3 },
      android: { elevation: 1 },
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.04)', cursor: 'pointer' }
    })
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1
  },
  typeBadgeText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 11,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  timeText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 11.5,
    color: '#94a3b8',
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  messageText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13,
    color: '#334155',
    lineHeight: 19,
    marginBottom: 10,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9'
  },
  refText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 12,
    color: '#2563eb',
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  viewRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  viewText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 11.5,
    color: '#2563eb',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9'
  },
  doneBtn: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center'
  },
  doneBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14,
    color: '#475569',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  }
});
