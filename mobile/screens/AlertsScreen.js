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

const LEVEL_THEME = {
  EVACUATE: {
    border: '#ef4444',
    bg: '#fef2f2',
    badgeBg: '#fee2e2',
    badgeText: '#b91c1c',
    icon: 'exclamation-triangle',
    label: 'EVACUATE'
  },
  WARNING: {
    border: '#f59e0b',
    bg: '#fffbeb',
    badgeBg: '#fef3c7',
    badgeText: '#b45309',
    icon: 'exclamation-circle',
    label: 'WARNING'
  },
  WATCH: {
    border: '#3b82f6',
    bg: '#eff6ff',
    badgeBg: '#dbeafe',
    badgeText: '#1d4ed8',
    icon: 'eye',
    label: 'WATCH'
  },
  ALL_CLEAR: {
    border: '#10b981',
    bg: '#ecfdf5',
    badgeBg: '#d1fae5',
    badgeText: '#047857',
    icon: 'check-circle',
    label: 'ALL CLEAR'
  }
};

const FILTER_LEVELS = ['ALL', 'EVACUATE', 'WARNING', 'WATCH', 'ALL_CLEAR'];

function expiresIn(iso) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3600000);
  if (h > 0) return `Expires in ~${h}h`;
  const m = Math.max(1, Math.floor(ms / 60000));
  return `Expires in ~${m}m`;
}

export default function AlertsScreen({ user, onNavigate, onOpenNotifications, hasUnreadNotifications = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [filterByDistrict, setFilterByDistrict] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const districtParam = filterByDistrict && user?.district ? `?district=${encodeURIComponent(user.district)}` : '';
      const { data } = await api.get(`/alerts/active${districtParam}`);
      setItems(data.alerts || []);
      setError('');
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load alerts');
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

  const getText = (rec) => (typeof rec === 'string' ? rec : rec?.en || '');

  const filteredAlerts = items.filter((item) => {
    if (activeFilter === 'ALL') return true;
    return item.level === activeFilter;
  });

  return (
    <View style={styles.container}>
      {/* Top Header with Centered Emergency Alerts Title & Bell on Right */}
      <View style={styles.header}>
        {onNavigate ? (
          <TouchableOpacity
            style={styles.backBtn}
            activeOpacity={0.7}
            onPress={() => onNavigate('Home')}
          >
            <FontAwesome5 name="chevron-left" size={18} color="#1e293b" />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerLeftSpacer} />
        )}
        <Text style={styles.headerTitle}>Emergency Alerts</Text>
        <TouchableOpacity
          style={styles.bellBtn}
          activeOpacity={0.7}
          onPress={() => (onOpenNotifications ? onOpenNotifications() : onRefresh())}
        >
          <FontAwesome5 name="bell" size={19} color="#1e293b" solid />
          {hasUnreadNotifications && <View style={styles.bellBadge} />}
        </TouchableOpacity>
      </View>

      {/* Main Content Area */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingText}>Fetching active alerts...</Text>
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

          {/* Level Filter Chips */}
          <View style={styles.filterContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {FILTER_LEVELS.map((lvl) => {
                const active = activeFilter === lvl;
                const count =
                  lvl === 'ALL'
                    ? items.length
                    : items.filter((i) => i.level === lvl).length;
                const theme = LEVEL_THEME[lvl];

                return (
                  <TouchableOpacity
                    key={lvl}
                    style={[
                      styles.filterChip,
                      lvl === 'ALL'
                        ? active
                          ? styles.chipAllActive
                          : styles.chipAllInactive
                        : active
                        ? { backgroundColor: theme?.border, borderColor: theme?.border }
                        : { backgroundColor: theme?.bg, borderColor: theme?.badgeBg }
                    ]}
                    activeOpacity={0.75}
                    onPress={() => setActiveFilter(lvl)}
                  >
                    {lvl !== 'ALL' && theme?.icon && (
                      <FontAwesome5
                        name={theme.icon}
                        size={11}
                        color={active ? '#ffffff' : theme.badgeText}
                        style={{ marginRight: 5 }}
                      />
                    )}
                    <Text
                      style={[
                        styles.filterChipText,
                        active
                          ? styles.filterChipTextActive
                          : { color: lvl === 'ALL' ? '#334155' : theme?.badgeText || '#475569' }
                      ]}
                    >
                      {lvl === 'ALL' ? 'All' : lvl.replace('_', ' ')}
                    </Text>

                    {count > 0 && (
                      <View
                        style={[
                          styles.chipCountBadge,
                          active
                            ? styles.chipCountBadgeActive
                            : { backgroundColor: lvl === 'ALL' ? '#e2e8f0' : theme?.badgeBg || '#e2e8f0' }
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipCountText,
                            active
                              ? styles.chipCountTextActive
                              : { color: lvl === 'ALL' ? '#1e293b' : theme?.badgeText || '#334155' }
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

          {/* Error Message */}
          {!!error && (
            <View style={styles.errorBanner}>
              <FontAwesome5 name="exclamation-circle" size={14} color="#ef4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Alerts List */}
          {filteredAlerts.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconCircle}>
                <FontAwesome5 name="shield-alt" size={32} color="#10b981" />
              </View>
              <Text style={styles.emptyTitle}>All Clear</Text>
              <Text style={styles.emptySubtitle}>
                There are currently no active emergency alerts matching your filter. Stay safe!
              </Text>
            </View>
          ) : (
            filteredAlerts.map((item) => {
              const theme = LEVEL_THEME[item.level] || LEVEL_THEME.WATCH;
              const isOpen = openId === item._id;

              return (
                <View
                  key={item._id}
                  style={[
                    styles.alertCard,
                    { borderLeftColor: theme.border, backgroundColor: '#ffffff' }
                  ]}
                >
                  {/* Card Header: Level Badge, Hazard & Expiry */}
                  <View style={styles.cardHeader}>
                    <View style={[styles.levelBadge, { backgroundColor: theme.badgeBg }]}>
                      <FontAwesome5 name={theme.icon} size={11} color={theme.badgeText} style={{ marginRight: 5 }} />
                      <Text style={[styles.levelBadgeText, { color: theme.badgeText }]}>
                        {theme.label}
                      </Text>
                    </View>

                    <View style={styles.expiryBadge}>
                      <FontAwesome5 name="clock" size={11} color="#64748b" style={{ marginRight: 4 }} />
                      <Text style={styles.expiryText}>{expiresIn(item.expiresAt)}</Text>
                    </View>
                  </View>

                  {/* Headline */}
                  <Text style={styles.headlineText}>{getText(item.headline)}</Text>

                  {/* District / Version Info */}
                  <View style={styles.metaRow}>
                    {!!item.district && (
                      <View style={styles.metaItem}>
                        <FontAwesome5 name="map-pin" size={11} color="#64748b" />
                        <Text style={styles.metaText}>{item.district}</Text>
                      </View>
                    )}
                    {item.version > 1 && (
                      <View style={styles.versionBadge}>
                        <Text style={styles.versionText}>Update v{item.version}</Text>
                      </View>
                    )}
                  </View>

                  {/* Expandable Details Body */}
                  {isOpen && (
                    <View style={styles.expandedContent}>
                      <View style={styles.divider} />
                      <Text style={styles.bodyText}>{getText(item.body)}</Text>
                      
                      {!!item.expiresAt && (
                        <Text style={styles.timestampText}>
                          Valid Until: {new Date(item.expiresAt).toLocaleString()}
                        </Text>
                      )}

                      {/* Quick Action Navigation */}
                      <View style={styles.actionRow}>
                        <TouchableOpacity
                          style={styles.actionBtnSecondary}
                          activeOpacity={0.7}
                          onPress={() => onNavigate?.('Shelters')}
                        >
                          <FontAwesome5 name="home" size={12} color="#2563eb" style={{ marginRight: 6 }} />
                          <Text style={styles.actionBtnSecondaryText}>Find Shelters</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.actionBtnPrimary}
                          activeOpacity={0.7}
                          onPress={() => onNavigate?.('Report')}
                        >
                          <FontAwesome5 name="plus-circle" size={12} color="#ffffff" style={{ marginRight: 6 }} />
                          <Text style={styles.actionBtnPrimaryText}>Report Hazard</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {/* Toggle Details Button */}
                  <TouchableOpacity
                    style={styles.detailsToggleBtn}
                    activeOpacity={0.7}
                    onPress={() => setOpenId(isOpen ? null : item._id)}
                  >
                    <Text style={styles.detailsToggleText}>
                      {isOpen ? 'Hide Advisory Details' : 'View Full Advisory'}
                    </Text>
                    <FontAwesome5
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={12}
                      color="#2563eb"
                      style={{ marginLeft: 6 }}
                    />
                  </TouchableOpacity>
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
  backBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'flex-start'
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
  alertCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 5,
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
    marginBottom: 10
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  levelBadgeText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 11.5,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  expiryBadge: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  expiryText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 11.5,
    color: '#64748b',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  headlineText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 15.5,
    color: '#0f172a',
    lineHeight: 22,
    marginBottom: 8,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5
  },
  metaText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 12.5,
    color: '#64748b',
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  versionBadge: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  versionText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 11,
    color: '#475569',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  expandedContent: {
    marginTop: 4,
    marginBottom: 10
  },
  divider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginVertical: 10
  },
  bodyText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13.5,
    color: '#334155',
    lineHeight: 20,
    marginBottom: 10,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  timestampText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 11.5,
    color: '#64748b',
    marginBottom: 14,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4
  },
  actionBtnSecondary: {
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
  actionBtnSecondaryText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 12.5,
    color: '#2563eb',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  actionBtnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 7,
    paddingVertical: 8
  },
  actionBtnPrimaryText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 12.5,
    color: '#ffffff',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  detailsToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9'
  },
  detailsToggleText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 12.5,
    color: '#2563eb',
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
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14
  },
  emptyTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 18,
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
