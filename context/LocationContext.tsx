'use client';
import { createContext, useContext, useState, ReactNode } from 'react';

type PermissionStatus = 'not_asked' | 'pending' | 'granted' | 'denied';
type LocationSource  = 'gps' | 'ip' | 'none';

interface LocationState {
  lat: number | null;
  lng: number | null;
  source: LocationSource;
  permissionStatus: PermissionStatus;
}
interface LocationContextType extends LocationState {
  requestGPS: () => Promise<void>;
  skipLocation: () => void;
}

const LocationContext = createContext<LocationContextType | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LocationState>({
    lat: null, lng: null, source: 'none', permissionStatus: 'not_asked'
  });

  const requestGPS = async () => {
    setState(s => ({ ...s, permissionStatus: 'pending' }));
    return new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setState({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps', permissionStatus: 'granted' });
          resolve();
        },
        async () => {
          try {
            const res  = await fetch('https://ipapi.co/json/');
            const data = await res.json();
            setState({ lat: data.latitude, lng: data.longitude, source: 'ip', permissionStatus: 'denied' });
          } catch {
            setState(s => ({ ...s, permissionStatus: 'denied' }));
          }
          resolve();
        },
        { timeout: 8000, maximumAge: 300000 }
      );
    });
  };

  const skipLocation = () => setState(s => ({ ...s, permissionStatus: 'denied' }));

  return (
    <LocationContext.Provider value={{ ...state, requestGPS, skipLocation }}>
      {children}
    </LocationContext.Provider>
  );
}

export const useLocation = () => {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be within LocationProvider');
  return ctx;
};
