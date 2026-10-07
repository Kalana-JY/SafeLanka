import { MapContainer, TileLayer, Marker, Circle, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';

// Fix default marker icons for Vite bundling (no image assets otherwise).
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow
});

// Free tiles: OpenStreetMap (no API key). Matches PDF high-fidelity
// "pinned location with accuracy readout".
export default function ReportMap({ lat, lng, accuracy = null, refLabel = '' }) {
  const valid = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  useEffect(() => {}, [lat, lng]);
  if (!valid) return <p className="error">No location pinned</p>;
  const pos = [Number(lat), Number(lng)];
  const osmLink = `https://www.openstreetmap.org/?mlat=${pos[0]}&mlon=${pos[1]}#map=15/${pos[0]}/${pos[1]}`;
  return (
    <div>
      <MapContainer center={pos} zoom={15} style={{ height: 240, width: '100%', borderRadius: 8 }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={pos}>
          <Popup>{refLabel || `${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}`}</Popup>
        </Marker>
        {accuracy != null && Number.isFinite(Number(accuracy)) && (
          <Circle center={pos} radius={Number(accuracy)} pathOptions={{ weight: 1 }} />
        )}
      </MapContainer>
      <p>
        {pos[0].toFixed(5)}, {pos[1].toFixed(5)}
        {accuracy != null ? ` · accurate to ~${Math.round(Number(accuracy))}m` : ''} ·{' '}
        <a href={osmLink} target="_blank" rel="noreferrer">
          Open in OpenStreetMap
        </a>
      </p>
    </div>
  );
}
