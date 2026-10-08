import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
  Image,
  ActivityIndicator,
  Modal,
  Platform,
  Alert
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import { FontAwesome5 } from '@expo/vector-icons';
import OsmMap from '../components/OsmMap';
import { api } from '../api/client';
import { enqueueReport, newClientUUID } from '../store/sync';

const HAZARD_OPTIONS = [
  { id: 'FLOOD', label: 'Flood', icon: 'water' },
  { id: 'LANDSLIDE', label: 'Landslide', icon: 'mountain' },
  { id: 'CYCLONE', label: 'Cyclone / Storm', icon: 'wind' },
  { id: 'TSUNAMI', label: 'Tsunami', icon: 'water' },
  { id: 'OTHER', label: 'Other Hazard', icon: 'exclamation-circle' }
];

function isNetworkError(err) {
  return !err?.response;
}

export default function ReportScreen({ onSubmitted, onNavigate, onOpenNotifications, hasUnreadNotifications = false }) {
  const [hazardType, setHazardType] = useState('FLOOD');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [description, setDescription] = useState('');

  // Location state
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [locationName, setLocationName] = useState('');
  const [accuracy, setAccuracy] = useState(null);
  const [locating, setLocating] = useState(false);
  const [showMap, setShowMap] = useState(true);

  // Evidence state
  const [evidenceType, setEvidenceType] = useState('PHOTO'); // 'PHOTO' | 'VOICE' | null
  const [photoBase64, setPhotoBase64] = useState(null);
  const [photoUri, setPhotoUri] = useState(null);

  // Voice Recording state
  const [recording, setRecording] = useState(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingInterval, setRecordingInterval] = useState(null);
  const [voiceUri, setVoiceUri] = useState(null);
  const [voiceBase64, setVoiceBase64] = useState(null);

  // Status & submission state
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ text: '', type: '' });
  const [confirmedReport, setConfirmedReport] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const handleReturnHome = () => {
    setConfirmedReport(null);
    if (onNavigate) {
      onNavigate('Home');
    } else if (onSubmitted) {
      onSubmitted();
    }
  };

  // Auto-fetch device location on screen mount
  const autoDetectLocation = useCallback(async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setStatusMessage({
          text: 'Location permission denied. You can manually tap on the map or enter coordinates.',
          type: 'warning'
        });
        setLocating(false);
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });

      const latitude = pos.coords.latitude;
      const longitude = pos.coords.longitude;
      setLat(String(latitude.toFixed(6)));
      setLng(String(longitude.toFixed(6)));
      setAccuracy(pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null);
      setLocationName(`Lat: ${latitude.toFixed(4)}, Lng: ${longitude.toFixed(4)}`);

      // Attempt reverse geocoding if online
      try {
        const [geo] = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (geo) {
          const parts = [geo.name, geo.street, geo.district || geo.city, geo.region].filter(Boolean);
          if (parts.length > 0) {
            setLocationName(parts.join(', '));
          }
        }
      } catch {
        // Offline geocoding fallback
      }
    } catch {
      setStatusMessage({
        text: 'Could not automatically get device GPS. Please pick your location on the map.',
        type: 'warning'
      });
    } finally {
      setLocating(false);
    }
  }, []);

  useEffect(() => {
    autoDetectLocation();
  }, [autoDetectLocation]);

  const onPickOnMap = (d) => {
    const pLat = Number(d.lat).toFixed(6);
    const pLng = Number(d.lng).toFixed(6);
    setLat(String(pLat));
    setLng(String(pLng));
    setLocationName(`Pin: ${Number(d.lat).toFixed(4)}, ${Number(d.lng).toFixed(4)}`);
  };

  // Image Selection (Direct Camera or Gallery)
  const pickImage = async (useCamera = false) => {
    try {
      let res;
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Permission needed', 'Camera permission is required to take photos.');
          return;
        }
        res = await ImagePicker.launchCameraAsync({
          base64: true,
          quality: 0.5,
          allowsEditing: true,
        });
      } else {
        res = await ImagePicker.launchImageLibraryAsync({
          base64: true,
          quality: 0.5,
          allowsEditing: true,
        });
      }

      if (!res.canceled && res.assets && res.assets[0]) {
        setPhotoUri(res.assets[0].uri);
        setPhotoBase64(res.assets[0].base64);
        setEvidenceType('PHOTO');
        setVoiceUri(null);
        setVoiceBase64(null);
      }
    } catch (err) {
      console.error('Image picker error:', err);
    }
  };

  // Voice Note Recording
  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Microphone permission is required for voice notes.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.LOW_QUALITY
      );

      setRecording(newRecording);
      setRecordingDuration(0);

      const timer = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
      setRecordingInterval(timer);
    } catch (err) {
      console.error('Recording start error:', err);
      // Fallback voice placeholder
      setVoiceUri('voice-note-recorded');
      setEvidenceType('VOICE');
    }
  };

  const stopRecording = async () => {
    if (recordingInterval) {
      clearInterval(recordingInterval);
      setRecordingInterval(null);
    }

    if (!recording) return;

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setVoiceUri(uri || 'voice-note.m4a');
      setEvidenceType('VOICE');
      setPhotoUri(null);
      setPhotoBase64(null);
      setRecording(null);
    } catch (err) {
      console.error('Recording stop error:', err);
      setRecording(null);
    }
  };

  const cancelRecording = async () => {
    if (recordingInterval) {
      clearInterval(recordingInterval);
      setRecordingInterval(null);
    }
    if (recording) {
      try {
        await recording.stopAndUnloadAsync();
      } catch {}
      setRecording(null);
    }
    setRecordingDuration(0);
  };

  const clearEvidence = () => {
    setPhotoUri(null);
    setPhotoBase64(null);
    setVoiceUri(null);
    setVoiceBase64(null);
    setEvidenceType('PHOTO');
  };

  const handleOpenReview = () => {
    if (!hazardType) {
      setStatusMessage({ text: 'Please select a hazard type.', type: 'error' });
      return;
    }
    if (!description.trim()) {
      setStatusMessage({ text: 'Please provide hazard description details.', type: 'error' });
      return;
    }
    if (!lat || !lng || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
      setStatusMessage({ text: 'Please specify or select a valid location on the map.', type: 'error' });
      return;
    }
    setStatusMessage({ text: '', type: '' });
    setReviewOpen(true);
  };

  const handleSubmit = async () => {
    if (!hazardType) {
      setStatusMessage({ text: 'Please select a hazard type.', type: 'error' });
      setReviewOpen(false);
      return;
    }
    if (!description.trim()) {
      setStatusMessage({ text: 'Please provide hazard description details.', type: 'error' });
      setReviewOpen(false);
      return;
    }
    if (!lat || !lng || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
      setStatusMessage({ text: 'Please specify or select a valid location on the map.', type: 'error' });
      setReviewOpen(false);
      return;
    }

    setBusy(true);
    setStatusMessage({ text: '', type: '' });

    const evidenceData = photoBase64 || voiceBase64;

    const draft = {
      hazardType,
      description: description.trim(),
      lat: Number(lat),
      lng: Number(lng),
      mediaType: evidenceType || 'PHOTO',
      ...(evidenceData ? { evidenceBase64: evidenceData } : {}),
      clientUUID: newClientUUID()
    };

    try {
      const { data } = await api.post('/reports', draft);
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const rawRef = data?.report?.ref || 'XYZ789012';
      const displayRef = rawRef.startsWith('#') ? rawRef : `#${rawRef}`;

      setReviewOpen(false);
      setConfirmedReport({
        hazardLabel: selectedHazardObj?.label || hazardType,
        locationName: locationName || (lat && lng ? `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}` : 'Main Street, City'),
        date: dateStr,
        time: timeStr,
        ref: displayRef,
      });

      setDescription('');
      clearEvidence();
      setStatusMessage({ text: '', type: '' });
    } catch (err) {
      if (isNetworkError(err)) {
        const n = await enqueueReport(draft);
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const displayRef = `#OFFLINE-${draft.clientUUID.slice(0, 6).toUpperCase()}`;

        setReviewOpen(false);
        setConfirmedReport({
          hazardLabel: selectedHazardObj?.label || hazardType,
          locationName: locationName || (lat && lng ? `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}` : 'Current Location'),
          date: dateStr,
          time: timeStr,
          ref: displayRef,
        });

        setDescription('');
        clearEvidence();
        setStatusMessage({ text: '', type: '' });
      } else {
        const issues = err?.response?.data?.issues;
        const msg = Array.isArray(issues)
          ? issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
          : (err?.response?.data?.error || 'Failed to submit report. Please try again.');
        setStatusMessage({
          text: msg,
          type: 'error'
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const selectedHazardObj = HAZARD_OPTIONS.find((h) => h.id === hazardType);

  if (confirmedReport) {
    return (
      <View style={styles.container}>
        {/* Header matching image */}
        <View style={styles.confirmHeader}>
          <Text style={styles.confirmHeaderTitle}>Report Confirmation</Text>
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.confirmContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.confirmCardWrapper}>
            {/* Green Checkmark Circle */}
            <View style={styles.successIconCircle}>
              <FontAwesome5 name="check" size={32} color="#ffffff" />
            </View>

            {/* Title & Subtitle */}
            <Text style={styles.confirmTitle}>Report Submitted!</Text>
            <Text style={styles.confirmSubtitle}>
              Your hazard report has been successfully submitted.
            </Text>

            {/* Report Details Card */}
            <View style={styles.detailsCard}>
              <Text style={styles.detailsCardTitle}>Report Details:</Text>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Hazard Type: </Text>
                <Text style={styles.detailValue}>{confirmedReport.hazardLabel}</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Location: </Text>
                <Text style={styles.detailValue}>{confirmedReport.locationName}</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Date: </Text>
                <Text style={styles.detailValue}>{confirmedReport.date}</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Time: </Text>
                <Text style={styles.detailValue}>{confirmedReport.time}</Text>
              </View>

              <View style={styles.detailsDivider} />

              <View style={styles.referenceRow}>
                <Text style={styles.referenceLabel}>Reference Number: </Text>
                <Text style={styles.referenceCode}>{confirmedReport.ref}</Text>
              </View>
            </View>

            {/* Return to Home Button */}
            <TouchableOpacity
              style={styles.returnHomeBtn}
              activeOpacity={0.85}
              onPress={handleReturnHome}
            >
              <Text style={styles.returnHomeBtnText}>Return to Home</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Header with Centered Title & Bell on Right */}
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
        <Text style={styles.headerTitle}>Report Hazard Form</Text>
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
        keyboardShouldPersistTaps="handled"
      >
        {/* Status Message Banner */}
        {!!statusMessage.text && (
          <View
            style={[
              styles.banner,
              statusMessage.type === 'error' && styles.bannerError,
              statusMessage.type === 'warning' && styles.bannerWarning,
              statusMessage.type === 'success' && styles.bannerSuccess
            ]}
          >
            <FontAwesome5
              name={
                statusMessage.type === 'success'
                  ? 'check-circle'
                  : statusMessage.type === 'error'
                  ? 'exclamation-circle'
                  : 'info-circle'
              }
              size={16}
              color={
                statusMessage.type === 'success'
                  ? '#15803d'
                  : statusMessage.type === 'error'
                  ? '#b91c1c'
                  : '#b45309'
              }
              solid
              style={{ marginRight: 8 }}
            />
            <Text
              style={[
                styles.bannerText,
                statusMessage.type === 'success' && styles.bannerTextSuccess,
                statusMessage.type === 'error' && styles.bannerTextError,
                statusMessage.type === 'warning' && styles.bannerTextWarning
              ]}
            >
              {statusMessage.text}
            </Text>
          </View>
        )}

        {/* Hazard Type Dropdown */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Hazard Type</Text>
          <TouchableOpacity
            style={styles.selectBox}
            activeOpacity={0.8}
            onPress={() => setDropdownOpen(true)}
          >
            <Text style={styles.selectBoxText}>
              {selectedHazardObj ? selectedHazardObj.label : 'Select Hazard Type'}
            </Text>
            <FontAwesome5 name="chevron-down" size={14} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {/* Location Field & Leaflet Interactive Map */}
        <View style={styles.fieldGroup}>
          <View style={styles.labelRow}>
            <Text style={styles.fieldLabel}>Location</Text>
            <TouchableOpacity
              style={styles.gpsBtn}
              activeOpacity={0.7}
              onPress={autoDetectLocation}
              disabled={locating}
            >
              {locating ? (
                <ActivityIndicator size="small" color="#2563eb" />
              ) : (
                <>
                  <FontAwesome5 name="crosshairs" size={13} color="#2563eb" style={{ marginRight: 4 }} />
                  <Text style={styles.gpsBtnText}>Auto GPS</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Enter location or tap on map"
              placeholderTextColor="#94a3b8"
              value={locationName || (lat && lng ? `Lat: ${lat}, Lng: ${lng}` : '')}
              onChangeText={(val) => setLocationName(val)}
            />
            {!!lat && !!lng && (
              <TouchableOpacity
                style={styles.mapToggleBtn}
                onPress={() => setShowMap(!showMap)}
              >
                <FontAwesome5 name={showMap ? 'map-marked' : 'map-marked-alt'} size={16} color="#2563eb" />
              </TouchableOpacity>
            )}
          </View>

          {/* Leaflet OpenStreetMap View */}
          {showMap && (
            <View style={styles.mapContainer}>
              <OsmMap
                key={`${lat || '7.8731'},${lng || '80.7718'}`}
                lat={lat}
                lng={lng}
                accuracy={accuracy}
                onPick={onPickOnMap}
              />
              <View style={styles.mapFooter}>
                <FontAwesome5 name="info-circle" size={12} color="#64748b" style={{ marginRight: 6 }} />
                <Text style={styles.mapFooterText}>
                  {lat && lng
                    ? `Selected: (${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}) · Tap or drag pin to adjust`
                    : 'Tap anywhere on Sri Lanka map to drop location pin'}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Description Field */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Provide details about the hazard"
            placeholderTextColor="#94a3b8"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            value={description}
            onChangeText={setDescription}
          />
        </View>

        {/* Upload Evidence Section with 3 Direct Buttons */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Upload Evidence</Text>

          {/* 3 Direct Action Buttons: Camera, Gallery, Voice Note */}
          <View style={styles.evidenceButtonsRow}>
            {/* Button 1: Camera */}
            <TouchableOpacity
              style={[
                styles.evidenceDirectBtn,
                evidenceType === 'PHOTO' && photoUri && styles.evidenceDirectBtnActive
              ]}
              activeOpacity={0.8}
              onPress={() => pickImage(true)}
            >
              <View style={[styles.directBtnIconCircle, { backgroundColor: '#eff6ff' }]}>
                <FontAwesome5 name="camera" size={18} color="#2563eb" solid />
              </View>
              <Text style={styles.directBtnText}>Camera</Text>
              <Text style={styles.directBtnSubtext}>Take photo</Text>
            </TouchableOpacity>

            {/* Button 2: Gallery */}
            <TouchableOpacity
              style={[
                styles.evidenceDirectBtn,
                evidenceType === 'PHOTO' && photoUri && styles.evidenceDirectBtnActive
              ]}
              activeOpacity={0.8}
              onPress={() => pickImage(false)}
            >
              <View style={[styles.directBtnIconCircle, { backgroundColor: '#f0fdf4' }]}>
                <FontAwesome5 name="images" size={18} color="#16a34a" solid />
              </View>
              <Text style={styles.directBtnText}>Gallery</Text>
              <Text style={styles.directBtnSubtext}>From device</Text>
            </TouchableOpacity>

            {/* Button 3: Voice Note */}
            <TouchableOpacity
              style={[
                styles.evidenceDirectBtn,
                (recording || voiceUri) && styles.evidenceDirectBtnActiveVoice
              ]}
              activeOpacity={0.8}
              onPress={recording ? stopRecording : startRecording}
            >
              <View
                style={[
                  styles.directBtnIconCircle,
                  { backgroundColor: recording ? '#fee2e2' : '#fef3c7' }
                ]}
              >
                <FontAwesome5
                  name={recording ? 'stop' : 'microphone'}
                  size={18}
                  color={recording ? '#dc2626' : '#d97706'}
                  solid
                />
              </View>
              <Text
                style={[
                  styles.directBtnText,
                  recording && { color: '#dc2626' }
                ]}
              >
                {recording ? 'Stop Rec' : 'Voice'}
              </Text>
              <Text style={styles.directBtnSubtext}>
                {recording ? `${recordingDuration}s` : 'Audio note'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Active Live Voice Recording Bar */}
          {recording && (
            <View style={styles.liveRecordingBar}>
              <View style={styles.recordingPulsingDot} />
              <Text style={styles.liveRecordingText}>
                Recording voice note... {recordingDuration}s
              </Text>
              <View style={styles.liveRecordActions}>
                <TouchableOpacity style={styles.stopRecordMiniBtn} onPress={stopRecording}>
                  <FontAwesome5 name="check" size={12} color="#ffffff" style={{ marginRight: 4 }} />
                  <Text style={styles.stopRecordMiniText}>Done</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelRecordMiniBtn} onPress={cancelRecording}>
                  <FontAwesome5 name="times" size={12} color="#64748b" />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Evidence Previews */}
          {photoUri && (
            <View style={styles.previewCard}>
              <Image source={{ uri: photoUri }} style={styles.previewImage} resizeMode="cover" />
              <View style={styles.previewOverlay}>
                <View style={styles.previewBadgeRow}>
                  <FontAwesome5 name="check-circle" size={13} color="#ffffff" solid style={{ marginRight: 6 }} />
                  <Text style={styles.previewBadge}>Photo Evidence Attached</Text>
                </View>
                <TouchableOpacity style={styles.removeEvidenceBtn} onPress={clearEvidence}>
                  <FontAwesome5 name="trash-alt" size={14} color="#ffffff" />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {voiceUri && !recording && (
            <View style={styles.voicePreviewCard}>
              <View style={styles.voiceIconWrap}>
                <FontAwesome5 name="microphone" size={20} color="#2563eb" solid />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.voiceTitle}>Voice Note Attached</Text>
                <Text style={styles.voiceSubtitle}>Audio recorded as evidence</Text>
              </View>
              <TouchableOpacity style={styles.voiceRemoveBtn} onPress={clearEvidence}>
                <FontAwesome5 name="times-circle" size={18} color="#94a3b8" solid />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Review & Submit Hazard Report Button */}
        <TouchableOpacity
          style={styles.submitButton}
          activeOpacity={0.85}
          onPress={handleOpenReview}
        >
          <FontAwesome5 name="clipboard-check" size={16} color="#ffffff" solid style={{ marginRight: 8 }} />
          <Text style={styles.submitButtonText}>Review & Submit Report</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Citizen Review Details Modal */}
      <Modal
        visible={reviewOpen}
        transparent
        animationType="slide"
        onRequestClose={() => !busy && setReviewOpen(false)}
      >
        <View style={styles.reviewModalOverlay}>
          <View style={styles.reviewModalCard}>
            {/* Modal Header */}
            <View style={styles.reviewModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reviewModalTitle}>Review Report Details</Text>
                <Text style={styles.reviewModalSubtitle}>Please verify all information before submission</Text>
              </View>
              <TouchableOpacity
                style={styles.reviewCloseBtn}
                onPress={() => !busy && setReviewOpen(false)}
                disabled={busy}
              >
                <FontAwesome5 name="times" size={16} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.reviewScroll}
              contentContainerStyle={styles.reviewScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Hazard Category Card */}
              <View style={styles.reviewItemCard}>
                <Text style={styles.reviewItemLabel}>HAZARD TYPE</Text>
                <View style={styles.reviewHazardRow}>
                  <View style={styles.reviewHazardIconWrap}>
                    <FontAwesome5
                      name={selectedHazardObj?.icon || 'exclamation-triangle'}
                      size={16}
                      color="#2563eb"
                      solid
                    />
                  </View>
                  <Text style={styles.reviewHazardName}>{selectedHazardObj?.label || hazardType}</Text>
                </View>
              </View>

              {/* Location Card */}
              <View style={styles.reviewItemCard}>
                <Text style={styles.reviewItemLabel}>INCIDENT LOCATION</Text>
                <Text style={styles.reviewLocationName}>{locationName || 'Location not named'}</Text>
                <View style={styles.reviewCoordRow}>
                  <FontAwesome5 name="map-marker-alt" size={12} color="#64748b" style={{ marginRight: 6 }} />
                  <Text style={styles.reviewCoordText}>
                    {Number(lat).toFixed(5)}, {Number(lng).toFixed(5)}
                    {accuracy ? ` (±${accuracy}m GPS accuracy)` : ''}
                  </Text>
                </View>
              </View>

              {/* Description Card */}
              <View style={styles.reviewItemCard}>
                <Text style={styles.reviewItemLabel}>HAZARD DESCRIPTION</Text>
                <View style={styles.reviewDescBox}>
                  <Text style={styles.reviewDescText}>{description.trim()}</Text>
                </View>
              </View>

              {/* Attached Evidence Card */}
              <View style={styles.reviewItemCard}>
                <Text style={styles.reviewItemLabel}>ATTACHED EVIDENCE</Text>
                {photoUri ? (
                  <View style={styles.reviewEvidenceWrap}>
                    <Image source={{ uri: photoUri }} style={styles.reviewPhotoThumbnail} resizeMode="cover" />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.reviewEvidenceTitle}>Photo Evidence</Text>
                      <Text style={styles.reviewEvidenceSubtitle}>Image captured & attached</Text>
                    </View>
                    <FontAwesome5 name="check-circle" size={18} color="#16a34a" solid />
                  </View>
                ) : voiceUri ? (
                  <View style={styles.reviewEvidenceWrap}>
                    <View style={styles.reviewVoiceIcon}>
                      <FontAwesome5 name="microphone" size={16} color="#2563eb" solid />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.reviewEvidenceTitle}>Voice Recording</Text>
                      <Text style={styles.reviewEvidenceSubtitle}>Audio note attached</Text>
                    </View>
                    <FontAwesome5 name="check-circle" size={18} color="#16a34a" solid />
                  </View>
                ) : (
                  <View style={styles.reviewNoEvidence}>
                    <FontAwesome5 name="info-circle" size={14} color="#94a3b8" style={{ marginRight: 8 }} />
                    <Text style={styles.reviewNoEvidenceText}>No media attached (Text & Location only)</Text>
                  </View>
                )}
              </View>

              {/* DMC Workflow Notice */}
              <View style={styles.reviewNoticeBox}>
                <FontAwesome5 name="shield-alt" size={14} color="#2563eb" style={{ marginRight: 8, marginTop: 2 }} />
                <Text style={styles.reviewNoticeText}>
                  Your report will be sent directly to the Disaster Management Centre (DMC) Duty Officer queue for verification and emergency response coordination.
                </Text>
              </View>
            </ScrollView>

            {/* Modal Actions */}
            <View style={styles.reviewModalActions}>
              <TouchableOpacity
                style={styles.reviewEditBtn}
                activeOpacity={0.8}
                disabled={busy}
                onPress={() => setReviewOpen(false)}
              >
                <FontAwesome5 name="edit" size={14} color="#475569" style={{ marginRight: 6 }} />
                <Text style={styles.reviewEditBtnText}>Edit Details</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.reviewConfirmBtn, busy && styles.submitButtonDisabled]}
                activeOpacity={0.85}
                disabled={busy}
                onPress={handleSubmit}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <FontAwesome5 name="paper-plane" size={14} color="#ffffff" solid style={{ marginRight: 6 }} />
                    <Text style={styles.reviewConfirmBtnText}>Confirm & Submit</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Hazard Type Picker Modal */}
      <Modal
        visible={dropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setDropdownOpen(false)}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Hazard Type</Text>
              <TouchableOpacity onPress={() => setDropdownOpen(false)}>
                <FontAwesome5 name="times" size={16} color="#64748b" />
              </TouchableOpacity>
            </View>
            {HAZARD_OPTIONS.map((item) => {
              const selected = hazardType === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.modalOption, selected && styles.modalOptionSelected]}
                  onPress={() => {
                    setHazardType(item.id);
                    setDropdownOpen(false);
                  }}
                >
                  <View style={styles.optionLeft}>
                    <FontAwesome5
                      name={item.icon}
                      size={16}
                      color={selected ? '#2563eb' : '#64748b'}
                      solid
                      style={{ width: 24 }}
                    />
                    <Text style={[styles.modalOptionText, selected && styles.modalOptionTextSelected]}>
                      {item.label}
                    </Text>
                  </View>
                  {selected && <FontAwesome5 name="check" size={14} color="#2563eb" />}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    backgroundColor: '#ffffff'
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
    color: '#1e293b',
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
    paddingTop: 18,
    paddingBottom: 40
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16
  },
  bannerError: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca'
  },
  bannerWarning: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a'
  },
  bannerSuccess: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0'
  },
  bannerText: {
    flex: 1,
    fontFamily: 'Montserrat_500Medium',
    fontSize: 12.5,
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  bannerTextError: {
    color: '#991b1b'
  },
  bannerTextWarning: {
    color: '#92400e'
  },
  bannerTextSuccess: {
    color: '#166534'
  },
  fieldGroup: {
    marginBottom: 20
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  fieldLabel: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14,
    color: '#1e293b',
    marginBottom: 8,
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  gpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6
  },
  gpsBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 12,
    color: '#2563eb',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  selectBox: {
    height: 48,
    backgroundColor: '#ffffff',
    borderWidth: 1.2,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  selectBoxText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 14,
    color: '#0f172a',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  inputContainer: {
    position: 'relative',
    justifyContent: 'center'
  },
  input: {
    height: 48,
    backgroundColor: '#ffffff',
    borderWidth: 1.2,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 16,
    fontFamily: 'Montserrat_400Regular',
    fontSize: 14,
    color: '#0f172a',
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  mapToggleBtn: {
    position: 'absolute',
    right: 12,
    padding: 6
  },
  textArea: {
    height: 110,
    paddingTop: 12,
    paddingBottom: 12
  },
  mapContainer: {
    marginTop: 10,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1.2,
    borderColor: '#cbd5e1'
  },
  mapFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0'
  },
  mapFooterText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 11.5,
    color: '#64748b',
    flex: 1,
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  evidenceButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4
  },
  evidenceDirectBtn: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3 },
      android: { elevation: 1 },
      web: { boxShadow: '0 1px 3px rgba(0,0,0,0.05)', cursor: 'pointer' }
    })
  },
  evidenceDirectBtnActive: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff'
  },
  evidenceDirectBtnActiveVoice: {
    borderColor: '#ef4444',
    backgroundColor: '#fef2f2'
  },
  directBtnIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8
  },
  directBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 13,
    color: '#1e293b',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  directBtnSubtext: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 10.5,
    color: '#64748b',
    marginTop: 2,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  liveRecordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fef2f2',
    borderWidth: 1.5,
    borderColor: '#fca5a5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12
  },
  recordingPulsingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
    marginRight: 8
  },
  liveRecordingText: {
    flex: 1,
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 12.5,
    color: '#dc2626',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  liveRecordActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  stopRecordMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dc2626',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6
  },
  stopRecordMiniText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 11,
    color: '#ffffff',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  cancelRecordMiniBtn: {
    padding: 6,
    backgroundColor: '#ffffff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1'
  },
  previewCard: {
    position: 'relative',
    height: 180,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginTop: 12
  },
  previewImage: {
    width: '100%',
    height: '100%'
  },
  previewOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  previewBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  previewBadge: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 12,
    color: '#ffffff',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  removeEvidenceBtn: {
    padding: 6
  },
  voicePreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 12,
    padding: 14,
    marginTop: 12
  },
  voiceIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center'
  },
  voiceTitle: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 13.5,
    color: '#1e3a8a',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  voiceSubtitle: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 11.5,
    color: '#3b82f6',
    marginTop: 2,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  voiceRemoveBtn: {
    padding: 8
  },
  submitButton: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#2563eb',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.3,
        shadowRadius: 5
      },
      android: {
        elevation: 3
      },
      web: {
        boxShadow: '0 3px 8px rgba(37, 99, 235, 0.25)',
        cursor: 'pointer'
      }
    })
  },
  submitButtonDisabled: {
    opacity: 0.7
  },
  submitButtonText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 15,
    color: '#ffffff',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8 },
      android: { elevation: 6 },
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }
    })
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
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
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 8
  },
  modalOptionSelected: {
    backgroundColor: '#eff6ff'
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  modalOptionText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 14,
    color: '#334155',
    marginLeft: 8,
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  modalOptionTextSelected: {
    fontFamily: 'Montserrat_600SemiBold',
    color: '#2563eb',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  confirmHeader: {
    backgroundColor: '#f8fafc',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center'
  },
  confirmHeaderTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 17,
    color: '#1e293b',
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  confirmContent: {
    padding: 24,
    alignItems: 'center',
    flexGrow: 1
  },
  confirmCardWrapper: {
    width: '100%',
    maxWidth: 440,
    alignItems: 'center'
  },
  successIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    marginBottom: 16,
    ...Platform.select({
      ios: { shadowColor: '#22c55e', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6 },
      android: { elevation: 4 },
      web: { boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)' }
    })
  },
  confirmTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 22,
    color: '#1e293b',
    marginBottom: 8,
    textAlign: 'center',
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  confirmSubtitle: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 26,
    lineHeight: 20,
    paddingHorizontal: 8,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  detailsCard: {
    width: '100%',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 18,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0'
  },
  detailsCardTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 15,
    color: '#1e293b',
    marginBottom: 12,
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  detailRow: {
    flexDirection: 'row',
    marginBottom: 8,
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  detailLabel: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 14,
    color: '#475569',
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  detailValue: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 14,
    color: '#1e293b',
    fontWeight: Platform.OS === 'web' ? '500' : undefined
  },
  detailsDivider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 12
  },
  referenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  referenceLabel: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 15,
    color: '#1e293b',
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  referenceCode: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 15,
    color: '#2563eb',
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  returnHomeBtn: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    height: 48,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#3b82f6',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.3,
        shadowRadius: 5
      },
      android: {
        elevation: 3
      },
      web: {
        boxShadow: '0 3px 8px rgba(59, 130, 246, 0.25)',
        cursor: 'pointer'
      }
    })
  },
  returnHomeBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 15,
    color: '#ffffff',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },

  /* Citizen Review Modal Styles */
  reviewModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
    alignItems: 'center'
  },
  reviewModalCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 12 },
      android: { elevation: 12 },
      web: { boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.15)' }
    })
  },
  reviewModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    backgroundColor: '#ffffff'
  },
  reviewModalTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 18,
    color: '#0f172a',
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  reviewModalSubtitle: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 12.5,
    color: '#64748b',
    marginTop: 2,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  reviewCloseBtn: {
    padding: 8
  },
  reviewScroll: {
    flexGrow: 1,
    paddingHorizontal: 20
  },
  reviewScrollContent: {
    paddingVertical: 16,
    gap: 12
  },
  reviewItemCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0'
  },
  reviewItemLabel: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 11,
    color: '#64748b',
    letterSpacing: 0.8,
    marginBottom: 8,
    textTransform: 'uppercase',
    fontWeight: Platform.OS === 'web' ? '700' : undefined
  },
  reviewHazardRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  reviewHazardIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10
  },
  reviewHazardName: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 15,
    color: '#1e293b',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  reviewLocationName: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14.5,
    color: '#1e293b',
    marginBottom: 4,
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  reviewCoordRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  reviewCoordText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 12.5,
    color: '#64748b',
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  reviewDescBox: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6'
  },
  reviewDescText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13.5,
    color: '#334155',
    lineHeight: 20,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  reviewEvidenceWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0'
  },
  reviewPhotoThumbnail: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: '#e2e8f0'
  },
  reviewVoiceIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center'
  },
  reviewEvidenceTitle: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 13.5,
    color: '#1e293b',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  reviewEvidenceSubtitle: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  reviewNoEvidence: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4
  },
  reviewNoEvidenceText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13,
    color: '#94a3b8',
    fontStyle: 'italic',
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  reviewNoticeBox: {
    flexDirection: 'row',
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    marginTop: 4
  },
  reviewNoticeText: {
    flex: 1,
    fontFamily: 'Montserrat_400Regular',
    fontSize: 12,
    color: '#1e40af',
    lineHeight: 17,
    fontWeight: Platform.OS === 'web' ? '400' : undefined
  },
  reviewModalActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    backgroundColor: '#ffffff',
    gap: 12
  },
  reviewEditBtn: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center'
  },
  reviewEditBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14,
    color: '#475569',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  },
  reviewConfirmBtn: {
    flex: 1.3,
    height: 46,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#2563eb', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4 },
      android: { elevation: 3 },
      web: { boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)', cursor: 'pointer' }
    })
  },
  reviewConfirmBtnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14,
    color: '#ffffff',
    fontWeight: Platform.OS === 'web' ? '600' : undefined
  }
});
