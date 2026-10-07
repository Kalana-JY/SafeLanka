import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';

// Pure OpenStreetMap via Leaflet. Cross-platform (Web iframe + Native WebView).
export default function OsmMap({ lat, lng, accuracy, onPick }) {
  const hasPin = lat !== '' && lng !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  const cLat = hasPin ? Number(lat) : 7.8731;
  const cLng = hasPin ? Number(lng) : 80.7718;
  const zoom = hasPin ? 15 : 7;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function handleWindowMessage(e) {
      try {
        const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (d && Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng))) {
          onPick?.(d);
        }
      } catch {}
    }
    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [onPick]);

  const html = `
    <!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>html,body,#m{height:100%;margin:0;padding:0} .leaflet-container{font:12px/1.5 sans-serif}</style>
    </head><body><div id="m"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      function notify(lat, lng) {
        var payload = JSON.stringify({ lat: lat, lng: lng });
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(payload);
        }
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(payload, '*');
        }
      }
      var map = L.map('m').setView([${cLat}, ${cLng}], ${zoom});
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      ${hasPin ? `var mk = L.marker([${cLat}, ${cLng}], {draggable:true}).addTo(map);
      mk.on('dragend', function(){ var p = mk.getLatLng(); notify(p.lat, p.lng); });
      ${accuracy != null && Number.isFinite(Number(accuracy)) ? `L.circle([${cLat}, ${cLng}], {radius:${Number(accuracy)}}).addTo(map);` : ''}` : ''}
      map.on('click', function(e){ notify(e.latlng.lat, e.latlng.lng); });
    </script></body></html>`;

  if (Platform.OS === 'web') {
    return (
      <View style={{ height: 280, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#ccc' }}>
        <iframe
          srcDoc={html}
          style={{ width: '100%', height: '100%', border: 'none' }}
          title="OpenStreetMap Picker"
        />
      </View>
    );
  }

  return (
    <View style={{ height: 280, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#ccc' }}>
      <WebView
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://tile.openstreetmap.org' }}
        style={{ flex: 1 }}
        javaScriptEnabled
        domStorageEnabled
        onMessage={(e) => {
          try {
            const d = JSON.parse(e.nativeEvent.data);
            if (Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng))) onPick?.(d);
          } catch {}
        }}
      />
    </View>
  );
}
