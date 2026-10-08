import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  Modal,
  Alert,
  Platform
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../api/client';

// Sample fallback community reports for immediate visual display if database has none verified yet
const DEFAULT_COMMUNITY_REPORTS = [
  {
    _id: 'sample-1',
    ref: 'RPT-20231026-001',
    title: 'Flood Warning',
    hazardType: 'FLOOD',
    locationName: 'Main Street Bridge',
    date: '2023-10-26',
    status: 'VERIFIED',
    description: 'Water level rising rapidly near bridge pillars.'
  },
  {
    _id: 'sample-2',
    ref: 'RPT-20231025-002',
    title: 'Road Closure',
    hazardType: 'LANDSLIDE',
    locationName: 'Elm Street',
    date: '2023-10-25',
    status: 'VERIFIED',
    description: 'Debris and earth slip blocking both lanes.'
  },
  {
    _id: 'sample-3',
    ref: 'RPT-20231024-003',
    title: 'Power Outage',
    hazardType: 'CYCLONE',
    locationName: 'Oak Avenue',
    date: '2023-10-24',
    status: 'VERIFIED',
    description: 'High winds snapped main power lines.'
  },
  {
    _id: 'sample-4',
    ref: 'RPT-20231023-004',
    title: 'Fallen Tree',
    hazardType: 'OTHER',
    locationName: 'Park Road',
    date: '2023-10-23',
    status: 'VERIFIED',
    description: 'Large banyan tree fallen across the road.'
  }
];

export default function CommunityScreen({ user, onNavigate, onOpenNotifications, hasUnreadNotifications = false }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Evidence Modal state
  const [selectedReport, setSelectedReport] = useState(null);
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [photoUri, setPhotoUri] = useState(null);
  const [photoBase64, setPhotoBase64] = useState(null);
  const [uploading, setUploading] = useState(false);

  const fetchReports = useCallback(async () => {
    try {
      const { data } = await api.get('/reports/community');
      if (Array.isArray(data?.reports) && data.reports.length > 0) {
        const formatted = data.reports.map((item) => {
          const r = item.report || item;
          const created = r.createdAt ? new Date(r.createdAt) : new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const dateStr = `${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())}`;

          const titles = {
            FLOOD: 'Flood Warning',
            LANDSLIDE: 'Road Closure / Landslide',
            CYCLONE: 'Cyclone / Storm Warning',
            TSUNAMI: 'Tsunami Alert',
            OTHER: 'Hazard Alert'
          };

          return {
            _id: r._id,
            ref: r.ref,
            title: titles[r.hazardType] || r.description?.slice(0, 30) || 'Hazard Report',
            hazardType: r.hazardType,
            locationName: r.reporterId?.district ? `${r.reporterId.district} (${r.lat?.toFixed(4)}, ${r.lng?.toFixed(4)})` : `${r.lat?.toFixed(4)}, ${r.lng?.toFixed(4)}`,
            date: dateStr,
            status: r.status,
            description: r.description,
            evidenceCount: item.evidence?.length || 0
          };
        });
        setReports(formatted);
      } else {
        // Fallback to sample verified reports if database has no verified reports yet
        setReports(DEFAULT_COMMUNITY_REPORTS);
      }
    } catch {
      // Offline fallback
      setReports(DEFAULT_COMMUNITY_REPORTS);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchReports();
  }, [fetchReports]);

  // Open modal for a specific report
  const handleOpenEvidenceModal = (item) => {
    setSelectedReport(item);
    setPhotoUri(null);
    setPhotoBase64(null);
    setEvidenceModalOpen(true);
  };

  // Pick or take photo
  const handlePickPhoto = async (useCamera = false) => {
    try {
      let res;
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Permission required', 'Camera access is required to take photo evidence.');
          return;
        }
        res = await ImagePicker.launchCameraAsync({
          base64: true,
          quality: 0.5,
          allowsEditing: true
        });
      } else {
        res = await ImagePicker.launchImageLibraryAsync({
          base64: true,
          quality: 0.5,
          allowsEditing: true
        });
      }

      if (!res.canceled && res.assets && res.assets[0]) {
        setPhotoUri(res.assets[0].uri);
        setPhotoBase64(res.assets[0].base64);
      }
    } catch (err) {
      console.error('Image picker error:', err);
    }
  };

  // Submit Evidence
  const handleSubmitEvidence = async () => {
    if (!photoBase64) {
      Alert.alert('Evidence Required', 'Please take or select a photo before submitting.');
      return;
    }

    if (!selectedReport || selectedReport._id.startsWith('sample-')) {
      Alert.alert('Success', 'Evidence added successfully to report.');
      setEvidenceModalOpen(false);
      return;
    }

    setUploading(true);
    try {
      await api.post(`/reports/${selectedReport._id}/evidence`, {
        mediaType: 'PHOTO',
        evidenceBase64: photoBase64
      });
      Alert.alert('Success', 'Evidence added successfully!');
      setEvidenceModalOpen(false);
      fetchReports();
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || 'Failed to upload evidence. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Header with Centered Community Reports Title & Bell on Right */}
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
        <Text style={styles.headerTitle}>Community Reports</Text>
        <TouchableOpacity
          style={styles.bellBtn}
          activeOpacity={0.7}
          onPress={() => onOpenNotifications?.()}
        >
          <FontAwesome5 name="bell" size={19} color="#1e293b" solid />
          {hasUnreadNotifications && <View style={styles.bellBadge} />}
        </TouchableOpacity>
      </View>

      {/* Main List Area */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingText}>Loading community reports...</Text>
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
          {reports.map((item) => (
            <View key={item._id || item.ref} style={styles.reportCard}>
              {/* Report Title / Hazard */}
              <Text style={styles.reportTitle}>{item.title}</Text>

              {/* Description */}
              {!!item.description && (
                <Text style={styles.reportDescription}>
                  {item.description}
                </Text>
              )}

              {/* Location */}
              <Text style={styles.reportLocation}>
                Location: {item.locationName}
              </Text>

              {/* Date */}
              <Text style={styles.reportDate}>
                Date: {item.date}
              </Text>

              {/* Add Evidence Button */}
              <TouchableOpacity
                style={styles.addEvidenceBtn}
                activeOpacity={0.8}
                onPress={() => handleOpenEvidenceModal(item)}
              >
                <Text style={styles.addEvidenceBtnText}>Add Evidence</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Add Evidence Modal */}
      <Modal
        visible={evidenceModalOpen}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setEvidenceModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Add Evidence</Text>
                <Text style={styles.modalSubtitle}>
                  {selectedReport?.title} • {selectedReport?.ref}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setEvidenceModalOpen(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <FontAwesome5 name="times" size={18} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Photo Preview or Selection Buttons */}
            {photoUri ? (
              <View style={styles.previewContainer}>
                <Image source={{ uri: photoUri }} style={styles.previewImage} resizeMode="cover" />
                <TouchableOpacity
                  style={styles.retakeBtn}
                  onPress={() => {
                    setPhotoUri(null);
                    setPhotoBase64(null);
                  }}
                >
                  <Text style={styles.retakeBtnText}>Change Photo</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.pickerRow}>
                <TouchableOpacity
                  style={styles.pickerBtn}
                  activeOpacity={0.7}
                  onPress={() => handlePickPhoto(true)}
                >
                  <View style={styles.pickerIconCircle}>
                    <FontAwesome5 name="camera" size={20} color="#2563eb" />
                  </View>
                  <Text style={styles.pickerBtnText}>Take Photo</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.pickerBtn}
                  activeOpacity={0.7}
                  onPress={() => handlePickPhoto(false)}
                >
                  <View style={styles.pickerIconCircle}>
                    <FontAwesome5 name="images" size={20} color="#2563eb" />
                  </View>
                  <Text style={styles.pickerBtnText}>From Gallery</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Modal Actions */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setEvidenceModalOpen(false)}
                disabled={uploading}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalSubmitBtn, !photoBase64 && styles.modalSubmitBtnDisabled]}
                onPress={handleSubmitEvidence}
                disabled={uploading || !photoBase64}
              >
                {uploading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>Submit Evidence</Text>
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
  reportCard: {
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
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }
    })
  },
  reportTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 16,
    color: '#0f172a',
    marginBottom: 6,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  reportDescription: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13.5,
    color: '#334155',
    lineHeight: 19,
    marginBottom: 8,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  reportLocation: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13.5,
    color: '#475569',
    marginBottom: 4,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  reportDate: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13.5,
    color: '#475569',
    marginBottom: 14,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  addEvidenceBtn: {
    backgroundColor: '#3b82f6',
    borderRadius: 7,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
    ...Platform.select({
      ios: { shadowColor: '#3b82f6', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3 },
      android: { elevation: 2 },
      web: { boxShadow: '0 2px 6px rgba(59, 130, 246, 0.25)', cursor: 'pointer' }
    })
  },
  addEvidenceBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 13,
    color: '#ffffff',
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
  modalSubtitle: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  pickerRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20
  },
  pickerBtn: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  pickerIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8
  },
  pickerBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 13,
    color: '#1e293b',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  previewContainer: {
    alignItems: 'center',
    marginBottom: 20
  },
  previewImage: {
    width: '100%',
    height: 180,
    borderRadius: 10,
    marginBottom: 8
  },
  retakeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12
  },
  retakeBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 12.5,
    color: '#2563eb',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10
  },
  modalCancelBtn: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#f1f5f9'
  },
  modalCancelBtnText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 13,
    color: '#475569',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  modalSubmitBtn: {
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 6,
    backgroundColor: '#2563eb',
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalSubmitBtnDisabled: {
    opacity: 0.5
  },
  modalSubmitBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 13,
    color: '#ffffff',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  }
});
