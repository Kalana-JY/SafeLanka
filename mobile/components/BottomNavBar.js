import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { t } from '../i18n';

export const TABS = [
  { name: 'Home', key: 'home', icon: 'home' },
  { name: 'Reports', key: 'reports', icon: 'list-ul' },
  { name: 'Shelters', key: 'shelters', icon: 'book' },
  { name: 'Alerts', key: 'alerts', icon: 'bell' },
  { name: 'Profile', key: 'profile', icon: 'user' }
];

export default function BottomNavBar({
  activeTab = 'Home',
  onNavigate,
  pending = 0,
  lang = 'en',
  hasNewAlerts = false
}) {
  return (
    <View style={styles.tabs}>
      {TABS.map((tb) => {
        const active = activeTab === tb.name || (tb.name === 'Reports' && activeTab === 'Community');
        return (
          <TouchableOpacity
            key={tb.name}
            style={[styles.tabBtn, active && styles.tabBtnActive]}
            activeOpacity={0.7}
            onPress={() => onNavigate?.(tb.name)}
          >
            <View style={styles.iconWrap}>
              <FontAwesome5
                name={tb.icon}
                size={20}
                color={active ? '#2563eb' : '#64748b'}
                solid
              />
              {tb.name === 'Reports' && pending > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{pending > 9 ? '9+' : pending}</Text>
                </View>
              )}
              {tb.name === 'Alerts' && hasNewAlerts && !active && (
                <View style={styles.alertDot} />
              )}
            </View>
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
              {t ? t(lang, tb.key) || tb.name : tb.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    paddingVertical: 8,
    paddingHorizontal: 6,
    paddingBottom: Platform.OS === 'ios' ? 24 : 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.05,
        shadowRadius: 3
      },
      android: {
        elevation: 6
      },
      web: {
        boxShadow: '0 -2px 8px rgba(0,0,0,0.04)'
      }
    })
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRadius: 10
  },
  tabBtnActive: {
    backgroundColor: '#eff6ff'
  },
  iconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    height: 24
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -12,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold'
  },
  alertDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    borderWidth: 1.5,
    borderColor: '#ffffff'
  },
  tabLabel: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
    textAlign: 'center',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  tabLabelActive: {
    fontFamily: 'Montserrat_600SemiBold',
    color: '#2563eb',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  }
});
