import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { api } from '../api/client';

const STATUS_THEME = {
  OPEN: {
    badgeBg: '#ecfdf5',
    badgeText: '#047857',
    barColor: '#10b981',
    label: 'OPEN'
  },
  NEARLY_FULL: {
    badgeBg: '#fffbeb',
    badgeText: '#b45309',
    barColor: '#f59e0b',
    label: 'NEARLY FULL'
  },
  FULL: {
    badgeBg: '#fef2f2',
    badgeText: '#b91c1c',
    barColor: '#ef4444',
    label: 'FULL'
  },
  CLOSED: {
    badgeBg: '#f1f5f9',
    badgeText: '#475569',
    barColor: '#94a3b8',
    label: 'CLOSED'
  }
};

const FILTER_OPTIONS = ['ALL', 'OPEN', 'NEARLY_FULL', 'FULL'];

export default function SheltersScreen({ user, onNavigate, onOpenNotifications, hasUnreadNotifications = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [filterByDistrict, setFilterByDistrict] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const districtParam = filterByDistrict && user?.district ? `?district=${encodeURIComponent(user.district)}` : '';
      const { data } = await api.get(`/shelters/open${districtParam}`);
      setItems(data.shelters || []);
      setError('');
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load shelters');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, filterByDistrict]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const filteredShelters = items.filter((item) => {
    const status = item.shelter?.status;
    if (activeFilter === 'ALL') return true;
    return status === activeFilter;
  });

  const totalCapacity = items.reduce((acc, curr) => acc + (curr.capacity || 0), 0);
  const totalOccupancy = items.reduce((acc, curr) => acc + (curr.occupancy || 0), 0);
  const availableBeds = Math.max(0, totalCapacity - totalOccupancy);

  return (
    <View style={styles.container}>
      {/* Top Header with Centered Emergency Shelters Title & Bell on Right */}
      <View style={styles.header}>
        <View style={styles.headerLeftSpacer} />
        <Text style={styles.headerTitle}>Emergency Shelters</Text>
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
          <Text style={styles.loadingText}>Locating open shelters...</Text>
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
              <Text style={styles.statLabel}>Open Shelters</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={[styles.statNumber, { color: '#10b981' }]}>{availableBeds}</Text>
              <Text style={styles.statLabel}>Available Beds</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={[styles.statNumber, { color: '#2563eb' }]}>
                {totalCapacity > 0 ? `${Math.round((totalOccupancy / totalCapacity) * 100)}%` : '0%'}
              </Text>
              <Text style={styles.statLabel}>Occupancy</Text>
            </View>
          </View>

          {/* District Scope Filter Bar */}
          {!!user?.district && (
            <View style={styles.districtBar}>
              <View style={styles.districtLeft}>
                <FontAwesome5 name="map-marker-alt" size={13} color="#2563eb" />
                <Text style={styles.districtText}>
                  {filterByDistrict ? `District: ${user.district}` : 'All Districts (National)'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.toggleDistrictBtn}
                activeOpacity={0.7}
                onPress={() => setFilterByDistrict(!filterByDistrict)}
              >
                <Text style={styles.toggleDistrictBtnText}>
                  {filterByDistrict ? 'Show All' : 'My District'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Status Filter Chips */}
          <View style={styles.filterContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {FILTER_OPTIONS.map((opt) => {
                const active = activeFilter === opt;
                const count =
                  opt === 'ALL'
                    ? items.length
                    : items.filter((i) => (i.shelter?.status || 'OPEN') === opt).length;
                const theme = STATUS_THEME[opt];

                return (
                  <TouchableOpacity
                    key={opt}
                    style={[
                      styles.filterChip,
                      opt === 'ALL'
                        ? active
                          ? styles.chipAllActive
                          : styles.chipAllInactive
                        : active
                        ? { backgroundColor: theme?.barColor, borderColor: theme?.barColor }
                        : { backgroundColor: theme?.badgeBg, borderColor: theme?.badgeBg }
                    ]}
                    activeOpacity={0.75}
                    onPress={() => setActiveFilter(opt)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        active
                          ? styles.filterChipTextActive
                          : { color: opt === 'ALL' ? '#334155' : theme?.badgeText || '#475569' }
                      ]}
                    >
                      {opt === 'ALL' ? 'All' : opt.replace('_', ' ')}
                    </Text>

                    {count > 0 && (
                      <View
                        style={[
                          styles.chipCountBadge,
                          active
                            ? styles.chipCountBadgeActive
                            : { backgroundColor: opt === 'ALL' ? '#e2e8f0' : '#ffffff' }
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipCountText,
                            active
                              ? styles.chipCountTextActive
                              : { color: opt === 'ALL' ? '#1e293b' : theme?.badgeText || '#334155' }
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

          {/* Shelters List */}
          {filteredShelters.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconCircle}>
                <FontAwesome5 name="building" size={30} color="#64748b" />
              </View>
              <Text style={styles.emptyTitle}>No Open Shelters Found</Text>
              <Text style={styles.emptySubtitle}>
                There are no open shelters matching your filter criteria right now. Check back or refresh.
              </Text>
            </View>
          ) : (
            filteredShelters.map((item) => {
              const shelter = item.shelter || {};
              const status = shelter.status || 'OPEN';
              const theme = STATUS_THEME[status] || STATUS_THEME.OPEN;
              const cap = item.capacity || shelter.capacity || 0;
              const occ = item.occupancy || shelter.occupancy || 0;
              const pct = cap > 0 ? Math.min(100, Math.round((occ / cap) * 100)) : 0;
              const isFull = status === 'FULL' || (cap > 0 && occ >= cap);

              return (
                <View key={shelter._id} style={[styles.shelterCard, isFull && styles.shelterCardFull]}>
                  {/* Card Header: Building Name & Status Pill */}
                  <View style={styles.cardHeader}>
                    <Text style={styles.buildingName} numberOfLines={2}>
                      {shelter.buildingName || 'Emergency Shelter'}
                    </Text>

                    <View style={[styles.statusBadge, { backgroundColor: theme.badgeBg }]}>
                      <Text style={[styles.statusBadgeText, { color: theme.badgeText }]}>
                        {theme.label}
                      </Text>
                    </View>
                  </View>

                  {/* Address / Location */}
                  {!!shelter.address && (
                    <View style={styles.addressRow}>
                      <FontAwesome5 name="map-pin" size={12} color="#64748b" style={{ marginTop: 2 }} />
                      <Text style={styles.addressText}>{shelter.address}</Text>
                    </View>
                  )}

                  {/* District / Contact info */}
                  <View style={styles.metaRow}>
                    {!!shelter.district && (
                      <View style={styles.metaBadge}>
                        <Text style={styles.metaBadgeText}>{shelter.district}</Text>
                      </View>
                    )}
                    {!!shelter.contactNo && (
                      <View style={styles.contactRow}>
                        <FontAwesome5 name="phone-alt" size={11} color="#64748b" />
                        <Text style={styles.contactText}>{shelter.contactNo}</Text>
                      </View>
                    )}
                  </View>

                  {/* Occupancy & Progress Bar */}
                  <View style={styles.capacitySection}>
                    <View style={styles.capacityHeader}>
                      <Text style={styles.capacityLabel}>Occupancy Status</Text>
                      <Text style={[styles.capacityValue, { color: theme.badgeText }]}>
                        {occ} / {cap} ({pct}%)
                      </Text>
                    </View>

                    <View style={styles.progressBarTrack}>
                      <View
                        style={[
                          styles.progressBarFill,
                          {
                            width: `${pct}%`,
                            backgroundColor: theme.barColor
                          }
                        ]}
                      />
                    </View>
                  </View>

                  {/* Action Buttons */}
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={styles.directionsBtn}
                      activeOpacity={0.7}
                      onPress={() => {
                        const coords = shelter.lat && shelter.lng ? ` (${shelter.lat.toFixed(4)}, ${shelter.lng.toFixed(4)})` : '';
                        Alert.alert(
                          shelter.buildingName,
                          `Address: ${shelter.address || shelter.district || 'Main Shelter Site'}${coords}\nStatus: ${status}\nOccupancy: ${occ}/${cap}`
                        );
                      }}
                    >
                      <FontAwesome5 name="directions" size={12} color="#2563eb" style={{ marginRight: 6 }} />
                      <Text style={styles.directionsBtnText}>View Details</Text>
                    </TouchableOpacity>

                    {!!shelter.contactNo && (
                      <TouchableOpacity
                        style={styles.callBtn}
                        activeOpacity={0.7}
                        onPress={() => {
                          Alert.alert('Contact Shelter', `Call ${shelter.buildingName} at ${shelter.contactNo}?`);
                        }}
                      >
                        <FontAwesome5 name="phone" size={12} color="#ffffff" style={{ marginRight: 6 }} />
                        <Text style={styles.callBtnText}>Call</Text>
                      </TouchableOpacity>
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
  districtBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#dbeafe'
  },
  districtLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  districtText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 13,
    color: '#1e40af',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  toggleDistrictBtn: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: '#ffffff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#bfdbfe'
  },
  toggleDistrictBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 11.5,
    color: '#2563eb',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
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
    borderWidth: 1.2,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2 },
      android: { elevation: 1 },
      web: { cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }
    })
  },
  chipAllActive: {
    backgroundColor: '#1e293b',
    borderColor: '#1e293b'
  },
  chipAllInactive: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1'
  },
  filterChipText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 12.5,
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
  chipCountText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 11,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  chipCountTextActive: {
    color: '#ffffff'
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
  shelterCard: {
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
  shelterCardFull: {
    borderColor: '#fecaca',
    backgroundColor: '#fffdfd'
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8
  },
  buildingName: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 16,
    color: '#0f172a',
    flex: 1,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  statusBadgeText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 11,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 10
  },
  addressText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13,
    color: '#475569',
    flex: 1,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12
  },
  metaBadge: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4
  },
  metaBadgeText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 11.5,
    color: '#475569',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5
  },
  contactText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 12,
    color: '#64748b',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  capacitySection: {
    marginBottom: 14,
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 8
  },
  capacityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  capacityLabel: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 12,
    color: '#64748b',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  capacityValue: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 12.5,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  progressBarTrack: {
    height: 7,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden'
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10
  },
  directionsBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 7,
    paddingVertical: 8
  },
  directionsBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 12.5,
    color: '#2563eb',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 7,
    paddingVertical: 8,
    paddingHorizontal: 16
  },
  callBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 12.5,
    color: '#ffffff',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
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
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  }
});
