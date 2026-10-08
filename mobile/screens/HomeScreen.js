import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Platform
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { api } from '../api/client';

const DEFAULT_ALERTS = [
  {
    id: 'def-1',
    title: 'Emergency Alert: Flash Flood Warning',
    body: 'Issued for downtown area. Seek higher ground immediately.',
    level: 'EVACUATE',
    time: 'Just now'
  },
  {
    id: 'def-2',
    title: 'Advisory: Road Closure',
    body: 'Main Street closed due to fallen tree. Use alternate routes.',
    level: 'WARNING',
    time: '25m ago'
  }
];

export default function HomeScreen({ user, onNavigate, onOpenNotifications, hasUnreadNotifications = false }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const district = user?.district ? `?district=${encodeURIComponent(user.district)}` : '';
      const { data } = await api.get(`/alerts/active${district}`);
      if (data?.alerts && data.alerts.length > 0) {
        setAlerts(data.alerts);
      } else {
        setAlerts(DEFAULT_ALERTS);
      }
    } catch {
      // Offline / fallback to sample alerts shown in wireframe
      setAlerts(DEFAULT_ALERTS);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAlerts();
  };

  const getAlertHeadline = (item) => {
    if (item.title) return item.title;
    if (typeof item.headline === 'string') return item.headline;
    return item.headline?.en || 'Urgent Safety Alert';
  };

  const getAlertBody = (item) => {
    if (item.body) {
      return typeof item.body === 'string' ? item.body : item.body?.en || '';
    }
    return '';
  };

  return (
    <View style={styles.container}>
      {/* Top Header with Centered Title & Bell on Right */}
      <View style={styles.header}>
        <View style={styles.headerLeftSpacer} />
        <Text style={styles.headerTitle}>SafeLanka</Text>
        <TouchableOpacity
          style={styles.bellBtn}
          activeOpacity={0.7}
          onPress={() => onOpenNotifications?.()}
        >
          <FontAwesome5 name="bell" size={19} color="#1e293b" solid />
          {hasUnreadNotifications && <View style={styles.bellBadge} />}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563eb" />}
      >
        {/* Real-time Alerts / Notifications Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Real-time Alerts/Notifications</Text>
        </View>

        {loading ? (
          <View style={styles.loaderBox}>
            <ActivityIndicator size="small" color="#2563eb" />
          </View>
        ) : (
          <View style={styles.alertsList}>
            {alerts.slice(0, 3).map((item, idx) => {
              const headline = getAlertHeadline(item);
              const body = getAlertBody(item);
              const itemId = item._id || item.id || `alert-${idx}`;
              const isExpanded = expandedId === itemId;

              return (
                <TouchableOpacity
                  key={itemId}
                  style={styles.alertCard}
                  activeOpacity={0.85}
                  onPress={() => setExpandedId(isExpanded ? null : itemId)}
                >
                  <Text style={styles.alertTitle}>{headline}</Text>
                  {!!body && <Text style={styles.alertBody}>{body}</Text>}
                  {isExpanded && item.expiresAt && (
                    <Text style={styles.alertMeta}>
                      Valid until: {new Date(item.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* 2x2 Grid of Quick Actions with FontAwesome Chisel Icons */}
        <View style={styles.gridContainer}>
          {/* Row 1 */}
          <View style={styles.gridRow}>
            {/* Button 1: Report Hazard (Primary Blue) */}
            <TouchableOpacity
              style={[styles.gridCard, styles.primaryCard]}
              activeOpacity={0.8}
              onPress={() => onNavigate?.('Report')}
            >
              <FontAwesome5 name="exclamation-triangle" size={24} color="#ffffff" solid style={styles.cardIcon} />
              <Text style={styles.primaryCardText}>Report Hazard</Text>
            </TouchableOpacity>

            {/* Button 2: My Reports (Slate Dark) */}
            <TouchableOpacity
              style={[styles.gridCard, styles.secondaryCard]}
              activeOpacity={0.8}
              onPress={() => onNavigate?.('My Reports')}
            >
              <FontAwesome5 name="tasks" size={24} color="#ffffff" solid style={styles.cardIcon} />
              <Text style={styles.secondaryCardText}>My Reports</Text>
            </TouchableOpacity>
          </View>

          {/* Row 2 */}
          <View style={styles.gridRow}>
            {/* Button 3: Community Reports (Slate Dark) */}
            <TouchableOpacity
              style={[styles.gridCard, styles.secondaryCard]}
              activeOpacity={0.8}
              onPress={() => onNavigate?.('Alerts')}
            >
              <FontAwesome5 name="users" size={24} color="#ffffff" solid style={styles.cardIcon} />
              <Text style={styles.secondaryCardText}>Community Reports</Text>
            </TouchableOpacity>

            {/* Button 4: Resources (Slate Dark) */}
            <TouchableOpacity
              style={[styles.gridCard, styles.secondaryCard]}
              activeOpacity={0.8}
              onPress={() => onNavigate?.('Shelters')}
            >
              <FontAwesome5 name="book" size={24} color="#ffffff" solid style={styles.cardIcon} />
              <Text style={styles.secondaryCardText}>Resources</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff'
  },
  header: {
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9'
  },
  headerLeftSpacer: {
    width: 32
  },
  headerTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 18,
    color: '#0f172a',
    textAlign: 'center',
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  bellBtn: {
    width: 32,
    alignItems: 'flex-end',
    justifyContent: 'center',
    padding: 2,
    position: 'relative'
  },
  bellBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444'
  },
  scrollArea: {
    flex: 1
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 36
  },
  sectionHeader: {
    marginBottom: 14
  },
  sectionTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 16,
    color: '#0f172a',
    letterSpacing: -0.2,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  loaderBox: {
    paddingVertical: 24,
    alignItems: 'center'
  },
  alertsList: {
    gap: 14,
    marginBottom: 28
  },
  alertCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    paddingVertical: 16,
    paddingHorizontal: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3
      },
      android: {
        elevation: 1
      },
      web: {
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
      }
    })
  },
  alertTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 14.5,
    color: '#0f172a',
    marginBottom: 6,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  alertBody: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  alertMeta: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 8,
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  gridContainer: {
    gap: 14,
    marginTop: 4
  },
  gridRow: {
    flexDirection: 'row',
    gap: 14
  },
  gridCard: {
    flex: 1,
    height: 100,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 4
      },
      android: {
        elevation: 3
      },
      web: {
        boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
        cursor: 'pointer'
      }
    })
  },
  primaryCard: {
    backgroundColor: '#2563eb'
  },
  secondaryCard: {
    backgroundColor: '#3b4856'
  },
  cardIcon: {
    marginRight: 10
  },
  primaryCardText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14.5,
    color: '#ffffff',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  secondaryCardText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14.5,
    color: '#ffffff',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  }
});
