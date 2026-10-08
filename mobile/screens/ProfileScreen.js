import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Switch,
  ActivityIndicator,
  Alert,
  Platform
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { api, clearAuth } from '../api/client';
import { t } from '../i18n';

export default function ProfileScreen({ user, lang, onUpdate, onSignOut, onNavigate, onOpenNotifications, hasUnreadNotifications = false }) {
  const [activeSubTab, setActiveSubTab] = useState('profile'); // 'profile' | 'reports'
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user?.fullName || '');
  const [editDistrict, setEditDistrict] = useState(user?.district || '');
  const [saving, setSaving] = useState(false);
  const [togglingOptIn, setTogglingOptIn] = useState(false);
  const [msg, setMsg] = useState({ text: '', type: '' });

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await clearAuth();
          onSignOut();
        }
      }
    ]);
  };

  const handleToggleOptIn = async (val) => {
    setTogglingOptIn(true);
    try {
      const { data } = await api.patch('/users/me', { alertOptIn: val });
      onUpdate(data.user);
    } catch (err) {
      setMsg({ text: err?.response?.data?.error || 'Failed to update alert preference', type: 'error' });
    } finally {
      setTogglingOptIn(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!editName.trim()) {
      Alert.alert('Validation', 'Name cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.patch('/users/me', {
        fullName: editName.trim(),
        district: editDistrict.trim() || user?.district
      });
      onUpdate(data.user);
      setIsEditing(false);
      setMsg({ text: 'Profile updated successfully!', type: 'success' });
      setTimeout(() => setMsg({ text: '', type: '' }), 3000);
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = () => {
    setEditName(user?.fullName || '');
    setEditDistrict(user?.district || '');
    setIsEditing(true);
  };

  return (
    <View style={styles.container}>
      {/* Top Header with Centered Profile title & Bell icon on right */}
      <View style={styles.header}>
        <View style={styles.headerLeftSpacer} />
        <Text style={styles.headerTitle}>Profile</Text>
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
      >
        {/* Status Message Banner */}
        {!!msg.text && (
          <View style={[styles.banner, msg.type === 'error' ? styles.bannerError : styles.bannerSuccess]}>
            <FontAwesome5
              name={msg.type === 'error' ? 'exclamation-circle' : 'check-circle'}
              size={14}
              color={msg.type === 'error' ? '#ef4444' : '#10b981'}
            />
            <Text style={[styles.bannerText, msg.type === 'error' ? styles.bannerErrorText : styles.bannerSuccessText]}>
              {msg.text}
            </Text>
          </View>
        )}

        {/* User Avatar Circle */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarCircle}>
            <FontAwesome5 name="user" size={42} color="#475569" solid />
          </View>

          {/* User Full Name & Email */}
          <Text style={styles.userName}>{user?.fullName || 'John Doe'}</Text>
          <Text style={styles.userEmail}>{user?.email || 'john.doe@example.com'}</Text>
        </View>

        {/* Sub-Navigation Tabs: My Profile | My Reports */}
        <View style={styles.subTabsContainer}>
          <TouchableOpacity
            style={[styles.subTabItem, activeSubTab === 'profile' && styles.subTabItemActive]}
            activeOpacity={0.7}
            onPress={() => setActiveSubTab('profile')}
          >
            <Text style={[styles.subTabText, activeSubTab === 'profile' && styles.subTabTextActive]}>
              My Profile
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.subTabItem, activeSubTab === 'reports' && styles.subTabItemActive]}
            activeOpacity={0.7}
            onPress={() => {
              if (onNavigate) {
                onNavigate('My Reports');
              } else {
                setActiveSubTab('reports');
              }
            }}
          >
            <Text style={[styles.subTabText, activeSubTab === 'reports' && styles.subTabTextActive]}>
              My Reports
            </Text>
          </TouchableOpacity>
        </View>

        {/* Personal Information Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Personal Information</Text>

          <View style={styles.infoField}>
            <Text style={styles.infoLabel}>Name:</Text>
            <Text style={styles.infoValue}>{user?.fullName || 'John Doe'}</Text>
          </View>

          <View style={styles.infoField}>
            <Text style={styles.infoLabel}>Email:</Text>
            <Text style={styles.infoValue}>{user?.email || 'john.doe@example.com'}</Text>
          </View>

          <View style={styles.infoField}>
            <Text style={styles.infoLabel}>Phone:</Text>
            <Text style={styles.infoValue}>{user?.mobileNo || '+1 123-456-7890'}</Text>
          </View>

          {/* Edit Profile Button */}
          <TouchableOpacity
            style={styles.editProfileBtn}
            activeOpacity={0.8}
            onPress={openEditModal}
          >
            <Text style={styles.editProfileBtnText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Settings Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Settings</Text>

          {/* District Info */}
          <View style={styles.settingsRow}>
            <View style={styles.settingsLeft}>
              <FontAwesome5 name="map-marker-alt" size={15} color="#64748b" style={styles.settingIcon} />
              <Text style={styles.settingsLabel}>District</Text>
            </View>
            <Text style={styles.settingsValueText}>{user?.district || 'Not Specified'}</Text>
          </View>

          {/* Role Badge */}
          <View style={styles.settingsRow}>
            <View style={styles.settingsLeft}>
              <FontAwesome5 name="shield-alt" size={15} color="#64748b" style={styles.settingIcon} />
              <Text style={styles.settingsLabel}>Account Role</Text>
            </View>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>
                {user?.role || 'CITIZEN'}
                {user?.role === 'VOLUNTEER' ? ' ✓' : ''}
              </Text>
            </View>
          </View>

          {/* Emergency Alert Opt-in Switch */}
          <View style={styles.settingsRow}>
            <View style={styles.settingsLeft}>
              <FontAwesome5 name="bell" size={15} color="#64748b" style={styles.settingIcon} />
              <View>
                <Text style={styles.settingsLabel}>Emergency Alerts</Text>
                <Text style={styles.settingsSubLabel}>Receive critical warnings</Text>
              </View>
            </View>
            {togglingOptIn ? (
              <ActivityIndicator size="small" color="#2563eb" />
            ) : (
              <Switch
                value={user?.alertOptIn !== false}
                onValueChange={handleToggleOptIn}
                trackColor={{ false: '#cbd5e1', true: '#93c5fd' }}
                thumbColor={user?.alertOptIn !== false ? '#2563eb' : '#f8fafc'}
              />
            )}
          </View>

          {/* Sign Out Button */}
          <TouchableOpacity
            style={styles.signOutRow}
            activeOpacity={0.7}
            onPress={handleSignOut}
          >
            <FontAwesome5 name="sign-out-alt" size={15} color="#ef4444" style={styles.settingIcon} />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal
        visible={isEditing}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setIsEditing(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile</Text>
              <TouchableOpacity onPress={() => setIsEditing(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <FontAwesome5 name="times" size={18} color="#64748b" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.inputLabel}>Full Name</Text>
              <TextInput
                style={styles.textInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="Enter full name"
                placeholderTextColor="#94a3b8"
              />

              <Text style={[styles.inputLabel, { marginTop: 14 }]}>District</Text>
              <TextInput
                style={styles.textInput}
                value={editDistrict}
                onChangeText={setEditDistrict}
                placeholder="Enter district (e.g. Colombo)"
                placeholderTextColor="#94a3b8"
              />
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setIsEditing(false)}
                disabled={saving}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSaveProfile}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.saveBtnText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingBottom: 40,
    alignItems: 'center'
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    width: '100%',
    maxWidth: 440,
    marginBottom: 16,
    gap: 8
  },
  bannerError: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca'
  },
  bannerSuccess: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0'
  },
  bannerText: {
    fontSize: 13,
    fontFamily: 'Montserrat_500Medium',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  bannerErrorText: {
    color: '#b91c1c'
  },
  bannerSuccessText: {
    color: '#047857'
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 20
  },
  avatarCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4 },
      android: { elevation: 2 },
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }
    })
  },
  userName: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 20,
    color: '#0f172a',
    marginBottom: 4,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  userEmail: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13.5,
    color: '#64748b',
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  subTabsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 22
  },
  subTabItem: {
    paddingVertical: 4,
    paddingHorizontal: 4
  },
  subTabItemActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#2563eb'
  },
  subTabText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 14,
    color: '#475569',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  subTabTextActive: {
    fontFamily: 'Montserrat_600SemiBold',
    color: '#2563eb',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 18,
    marginBottom: 16,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3 },
      android: { elevation: 1 },
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.03)' }
    })
  },
  cardTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 15.5,
    color: '#0f172a',
    marginBottom: 14,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  infoField: {
    marginBottom: 12
  },
  infoLabel: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 12,
    color: '#64748b',
    marginBottom: 2,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  infoValue: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 14.5,
    color: '#0f172a',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  editProfileBtn: {
    backgroundColor: '#334155',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
    marginTop: 6,
    ...Platform.select({
      web: { cursor: 'pointer' }
    })
  },
  editProfileBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 13,
    color: '#ffffff',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9'
  },
  settingsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  settingIcon: {
    width: 20,
    textAlign: 'center'
  },
  settingsLabel: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 14,
    color: '#1e293b',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  settingsSubLabel: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 1,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  settingsValueText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 13.5,
    color: '#334155',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  roleBadge: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbeafe'
  },
  roleBadgeText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 11.5,
    color: '#2563eb',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 4,
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' }
    })
  },
  signOutText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14,
    color: '#ef4444',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  modalContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 20,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8 },
      android: { elevation: 6 },
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }
    })
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9'
  },
  modalTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 16,
    color: '#0f172a',
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  modalBody: {
    marginBottom: 20
  },
  inputLabel: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 13,
    color: '#475569',
    marginBottom: 6,
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'Montserrat_400Regular',
    color: '#0f172a',
    backgroundColor: '#f8fafc'
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10
  },
  cancelBtn: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#f1f5f9'
  },
  cancelBtnText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 13,
    color: '#475569',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  saveBtn: {
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 6,
    backgroundColor: '#2563eb',
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center'
  },
  saveBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 13,
    color: '#ffffff',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  }
});
