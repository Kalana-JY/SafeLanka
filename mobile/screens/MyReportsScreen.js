import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { api } from '../api/client';

const STATUS_CONFIG = {
  VERIFIED: {
    label: 'Accepted',
    bg: '#ecfdf5',
    text: '#047857',
    border: '#a7f3d0',
    icon: 'check-circle'
  },
  SUBMITTED: {
    label: 'Under Review',
    bg: '#fffbeb',
    text: '#b45309',
    border: '#fde68a',
    icon: 'clock'
  },
  UNDER_REVIEW: {
    label: 'Under Review',
    bg: '#fffbeb',
    text: '#b45309',
    border: '#fde68a',
    icon: 'clock'
  },
  REJECTED: {
    label: 'Rejected',
    bg: '#fef2f2',
    text: '#b91c1c',
    border: '#fecaca',
    icon: 'times-circle'
  }
};

const FILTER_OPTIONS = ['ALL', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED'];

export default function MyReportsScreen({ onNavigate, onOpenNotifications, hasUnreadNotifications = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/reports/mine');
      setItems(data.reports || []);
      setError('');
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load your reports');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const filteredReports = items.filter((item) => {
    const rawStatus = item.report?.status;
    if (activeFilter === 'ALL') return true;
    if (activeFilter === 'ACCEPTED') return rawStatus === 'VERIFIED';
    if (activeFilter === 'UNDER_REVIEW') return rawStatus === 'SUBMITTED' || rawStatus === 'UNDER_REVIEW';
    if (activeFilter === 'REJECTED') return rawStatus === 'REJECTED';
    return true;
  });

  const acceptedCount = items.filter((i) => i.report?.status === 'VERIFIED').length;
  const underReviewCount = items.filter((i) => i.report?.status === 'SUBMITTED' || i.report?.status === 'UNDER_REVIEW').length;

  return (
    <View style={styles.container}>
      {/* Top Header with Centered My Reports Title & Bell on Right */}
      <View style={styles.header}>
        <View style={styles.headerLeftSpacer} />
        <Text style={styles.headerTitle}>My Reports</Text>
        <TouchableOpacity
          style={styles.bellBtn}
          activeOpacity={0.7}
          onPress={() => onOpenNotifications?.()}
        >
          <FontAwesome5 name="bell" size={19} color="#1e293b" solid />
          {hasUnreadNotifications && <View style={styles.bellBadge} />}
        </TouchableOpacity>
      </View>

      {/* Main Content Area */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingText}>Fetching your reports...</Text>
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
          {/* Top Quick Stats Summary Card */}
          <View style={styles.statsCard}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{items.length}</Text>
              <Text style={styles.statLabel}>Total Filed</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={[styles.statNumber, { color: '#b45309' }]}>{underReviewCount}</Text>
              <Text style={styles.statLabel}>Under Review</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={[styles.statNumber, { color: '#047857' }]}>{acceptedCount}</Text>
              <Text style={styles.statLabel}>Accepted</Text>
            </View>
          </View>

          {/* Filter Chips Container */}
          <View style={styles.filterContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {FILTER_OPTIONS.map((opt) => {
                const active = activeFilter === opt;
                let count = items.length;
                if (opt === 'ACCEPTED') count = acceptedCount;
                if (opt === 'UNDER_REVIEW') count = underReviewCount;
                if (opt === 'REJECTED') count = items.filter((i) => i.report?.status === 'REJECTED').length;

                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    activeOpacity={0.75}
                    onPress={() => setActiveFilter(opt)}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                      {opt === 'ALL' ? 'All' : opt === 'UNDER_REVIEW' ? 'Under Review' : opt === 'ACCEPTED' ? 'Accepted' : 'Rejected'}
                    </Text>

                    {count > 0 && (
                      <View
                        style={[
                          styles.chipCountBadge,
                          active ? styles.chipCountBadgeActive : styles.chipCountBadgeInactive
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipCountText,
                            active ? styles.chipCountTextActive : styles.chipCountTextInactive
                          ]}
                        >
                          {count}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Error Banner */}
          {!!error && (
            <View style={styles.errorBanner}>
              <FontAwesome5 name="exclamation-circle" size={14} color="#ef4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Reports List */}
          {filteredReports.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconCircle}>
                <FontAwesome5 name="clipboard-list" size={30} color="#64748b" />
              </View>
              <Text style={styles.emptyTitle}>No Reports Found</Text>
              <Text style={styles.emptySubtitle}>
                {items.length === 0
                  ? "You haven't filed any hazard reports yet. Stay alert and report hazards to help keep the community safe."
                  : 'No reports match the selected status filter.'}
              </Text>

              {items.length === 0 && (
                <TouchableOpacity
                  style={styles.newReportBtn}
                  activeOpacity={0.8}
                  onPress={() => onNavigate?.('Report')}
                >
                  <FontAwesome5 name="plus" size={13} color="#ffffff" style={{ marginRight: 6 }} />
                  <Text style={styles.newReportBtnText}>Report a Hazard</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            filteredReports.map((item) => {
              const r = item.report || {};
              const evidenceCount = item.evidence?.length || 0;
              const rawStatus = r.status || 'SUBMITTED';
              const cfg = STATUS_CONFIG[rawStatus] || STATUS_CONFIG.SUBMITTED;

              const created = r.createdAt ? new Date(r.createdAt) : new Date();
              const pad = (n) => String(n).padStart(2, '0');
              const dateStr = `${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())}`;
              const timeStr = `${pad(created.getHours())}:${pad(created.getMinutes())}`;

              return (
                <View key={r._id || r.ref} style={styles.reportCard}>
                  {/* Header: Ref Number & Status Badge */}
                  <View style={styles.cardHeader}>
                    <View style={styles.refContainer}>
                      <Text style={styles.refLabel}>Ref: </Text>
                      <Text style={styles.refCode}>#{r.ref || 'RPT-PENDING'}</Text>
                    </View>

                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: cfg.bg, borderColor: cfg.border }
                      ]}
                    >
                      <FontAwesome5
                        name={cfg.icon}
                        size={11}
                        color={cfg.text}
                        style={{ marginRight: 5 }}
                      />
                      <Text style={[styles.statusBadgeText, { color: cfg.text }]}>
                        {cfg.label}
                      </Text>
                    </View>
                  </View>

                  {/* Hazard Type & Timestamp */}
                  <View style={styles.hazardRow}>
                    <Text style={styles.hazardTypeTitle}>
                      {r.hazardType}
                    </Text>
                    <Text style={styles.dateTimeText}>
                      {dateStr} • {timeStr}
                    </Text>
                  </View>

                  {/* Description */}
                  <Text style={styles.descriptionText}>{r.description}</Text>

                  {/* Location Pin */}
                  {r.lat != null && r.lng != null && (
                    <View style={styles.locationRow}>
                      <FontAwesome5 name="map-marker-alt" size={12} color="#64748b" style={{ marginRight: 6 }} />
                      <Text style={styles.locationText}>
                        Location: {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                      </Text>
                    </View>
                  )}

                  {/* Metadata Chips / Indicators */}
                  <View style={styles.badgeRow}>
                    {evidenceCount > 0 ? (
                      <View style={styles.photoBadge}>
                        <FontAwesome5 name="camera" size={10} color="#2563eb" style={{ marginRight: 4 }} />
                        <Text style={styles.photoBadgeText}>{evidenceCount} Photo Attached</Text>
                      </View>
                    ) : (
                      <View style={styles.noPhotoBadge}>
                        <Text style={styles.noPhotoBadgeText}>No Photo Evidence</Text>
                      </View>
                    )}

                    {r.sensorCorroborated && (
                      <View style={styles.sensorBadge}>
                        <FontAwesome5 name="check" size={10} color="#047857" style={{ marginRight: 4 }} />
                        <Text style={styles.sensorBadgeText}>Sensor Corroborated</Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
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
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20
  },
  loadingText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 14,
    color: '#64748b',
    marginTop: 12,
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  scrollArea: {
    flex: 1
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
    alignItems: 'center'
  },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 14,
    marginBottom: 14
  },
  statBox: {
    alignItems: 'center',
    flex: 1
  },
  statNumber: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 18,
    color: '#0f172a',
    marginBottom: 2,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  statLabel: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 11.5,
    color: '#64748b',
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#cbd5e1'
  },
  filterContainer: {
    width: '100%',
    maxWidth: 440,
    marginBottom: 16
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
    paddingHorizontal: 2
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1.2,
    borderColor: '#cbd5e1',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2 },
      android: { elevation: 1 },
      web: { cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }
    })
  },
  filterChipActive: {
    backgroundColor: '#1e293b',
    borderColor: '#1e293b'
  },
  filterChipText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 12.5,
    color: '#475569',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  filterChipTextActive: {
    color: '#ffffff'
  },
  chipCountBadge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  chipCountBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.28)'
  },
  chipCountBadgeInactive: {
    backgroundColor: '#f1f5f9'
  },
  chipCountText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 11,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  chipCountTextActive: {
    color: '#ffffff'
  },
  chipCountTextInactive: {
    color: '#475569'
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    padding: 12,
    width: '100%',
    maxWidth: 440,
    marginBottom: 14
  },
  errorText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 13,
    color: '#b91c1c',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  reportCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    marginBottom: 14,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3 },
      android: { elevation: 1.5 },
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }
    })
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8
  },
  refContainer: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  refLabel: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 13,
    color: '#64748b',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  refCode: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 14,
    color: '#2563eb',
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1
  },
  statusBadgeText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 11.5,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  hazardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6
  },
  hazardTypeTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 15,
    color: '#0f172a',
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  dateTimeText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 12,
    color: '#64748b',
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  descriptionText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13.5,
    color: '#334155',
    lineHeight: 20,
    marginBottom: 10,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10
  },
  locationText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 12.5,
    color: '#64748b',
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9'
  },
  photoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4
  },
  photoBadgeText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 11.5,
    color: '#2563eb',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  noPhotoBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4
  },
  noPhotoBadgeText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 11.5,
    color: '#b45309',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  sensorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4
  },
  sensorBadgeText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 11.5,
    color: '#047857',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  emptyCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 28,
    alignItems: 'center',
    marginTop: 20
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14
  },
  emptyTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 17,
    color: '#0f172a',
    marginBottom: 6,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  emptySubtitle: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13.5,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 18,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  newReportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 18
  },
  newReportBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 13.5,
    color: '#ffffff',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  }
});
