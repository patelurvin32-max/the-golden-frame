import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store';

const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
const LAST_ACTIVITY_KEY = 'thegoldenframe-last-activity';
const EXPIRED_MESSAGE_KEY = 'session_expired_message';
export const EXPIRED_MESSAGE_TEXT = 'Your session has expired due to 2 hours of inactivity. Please log in again.';

export const useIdleTimer = () => {
  const { isAuthenticated, silentLogout } = useAuthStore();
  const lastUpdateRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!isAuthenticated) return;

    // Record initial activity time
    const now = Date.now();
    localStorage.setItem(LAST_ACTIVITY_KEY, now.toString());
    lastUpdateRef.current = now;

    // Handler to update activity time (throttled to once per second)
    const updateActivity = () => {
      const current = Date.now();
      if (current - lastUpdateRef.current > 1000) {
        lastUpdateRef.current = current;
        localStorage.setItem(LAST_ACTIVITY_KEY, current.toString());
      }
    };

    // User activity events
    const activityEvents = ['mousemove', 'mousedown', 'click', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach((event) => {
      window.addEventListener(event, updateActivity, { passive: true });
    });

    // Cross-tab synchronization via localStorage storage event
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === LAST_ACTIVITY_KEY && e.newValue) {
        const time = parseInt(e.newValue, 10);
        if (!isNaN(time)) {
          lastUpdateRef.current = time;
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);

    // Periodic check for 2-hour inactivity timeout (every 10 seconds)
    const checkInterval = setInterval(() => {
      const storedTimeStr = localStorage.getItem(LAST_ACTIVITY_KEY);
      const lastActivityTime = storedTimeStr ? parseInt(storedTimeStr, 10) : lastUpdateRef.current;
      const elapsed = Date.now() - lastActivityTime;

      if (elapsed >= IDLE_TIMEOUT_MS) {
        // Trigger automated inactivity logout
        clearInterval(checkInterval);
        sessionStorage.setItem(EXPIRED_MESSAGE_KEY, EXPIRED_MESSAGE_TEXT);
        localStorage.removeItem(LAST_ACTIVITY_KEY);
        silentLogout();
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      }
    }, 10000);

    return () => {
      activityEvents.forEach((event) => {
        window.removeEventListener(event, updateActivity);
      });
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(checkInterval);
    };
  }, [isAuthenticated, silentLogout]);
};
