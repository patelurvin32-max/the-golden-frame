import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore, useAppStore } from '@/store';
import type { Table, Notification } from '@/types';

// ── Singleton socket — persists for the lifetime of the app session ────────────
let socket: Socket | null = null;

// Module-level set of currently joined branch room IDs.
// Shared across ALL hook instances so one component's cleanup never
// accidentally leaves a room that another component still needs.
const joinedBranches = new Set<string>();

function joinBranch(id: string) {
  if (!socket || !id || joinedBranches.has(id)) return;
  socket.emit('join:branch', id);
  joinedBranches.add(id);
  console.log('[Socket] Joined branch room:', id);
}

function leaveBranch(id: string) {
  if (!socket || !id) return;
  socket.emit('leave:branch', id);
  joinedBranches.delete(id);
  console.log('[Socket] Left branch room:', id);
}

function getResolvedBranchIds(user: any, selectedBranch: string | undefined | null): string[] {
  const ids: string[] = [];
  if (selectedBranch) {
    ids.push(selectedBranch);
  } else {
    (user?.branches || []).forEach((b: any) => {
      const id = typeof b === 'string' ? b : b?._id?.toString();
      if (id) ids.push(id);
    });
  }
  return ids;
}

export const useSocket = () => {
  const { isAuthenticated, user } = useAuthStore();
  const { selectedBranch } = useAppStore();
  const socketRef = useRef<Socket | null>(null);

  // ── 1. Create socket once when user authenticates ────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;

    if (!socket) {
      let socketUrl = '/';
      if (import.meta.env.VITE_API_URL) {
        socketUrl = import.meta.env.VITE_API_URL;
        if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
          socketUrl = socketUrl.replace('localhost', window.location.hostname).replace('127.0.0.1', window.location.hostname);
        }
      }
      socket = io(socketUrl, { withCredentials: true, transports: ['websocket', 'polling'] });
    }
    socketRef.current = socket;

    return () => {
      // Don't disconnect globally — keep persistent connection
    };
  }, [isAuthenticated]);


  // ── 2. Announce user identity whenever user is known ─────────────────────────
  useEffect(() => {
    if (!socket || !isAuthenticated || !user) return;
    socket.emit('join:user', { userId: user._id, role: user.role, branchId: selectedBranch });
  }, [isAuthenticated, user?._id, user?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 3. Manage branch room membership when selection or user branches change ──
  const prevBranchIdsRef = useRef<string[]>([]);

  // Serialize to stable string — prevents effect from firing on user object
  // reference changes (which happen frequently in React) when the actual branch
  // IDs haven't changed.
  const branchIdsSerialized = JSON.stringify(
    getResolvedBranchIds(user, selectedBranch).sort()
  );

  useEffect(() => {
    if (!isAuthenticated || !user || !socket) return;

    const newIds = getResolvedBranchIds(user, selectedBranch);

    // Leave branch rooms that are no longer needed
    for (const id of prevBranchIdsRef.current) {
      if (!newIds.includes(id)) leaveBranch(id);
    }

    // Join new branches (joinBranch is a no-op if already joined)
    for (const id of newIds) joinBranch(id);

    prevBranchIdsRef.current = newIds;

    // Do NOT leave on cleanup — the module-level singleton socket must stay
    // in these rooms even when this hook instance unmounts (other pages/components
    // may still rely on receiving events in these rooms).
    return () => {};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?._id, branchIdsSerialized]);

  // ── 4. Rejoin all rooms after a socket reconnect (e.g. server restart) ───────
  useEffect(() => {
    if (!socket) return;
    const handleConnect = () => {
      if (!user) return;
      const ids = getResolvedBranchIds(user, selectedBranch);
      // Server has no memory of rooms after reconnect — clear and rejoin
      joinedBranches.clear();
      socket!.emit('join:user', { userId: user._id, role: user.role, branchId: selectedBranch });
      ids.forEach((id) => {
        socket!.emit('join:branch', id);
        joinedBranches.add(id);
      });
      console.log('[Socket] Reconnected. Re-joined branches:', ids);
    };
    socket.on('connect', handleConnect);
    return () => { socket?.off('connect', handleConnect); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id, selectedBranch]);

  // ── Event subscription helpers ────────────────────────────────────────────────
  const onTableUpdate = (callback: (table: Table) => void) => {
    socket?.on('table:updated', callback);
    return () => { socket?.off('table:updated', callback); };
  };

  const onNotification = (callback: (notification: Notification) => void) => {
    socket?.on('notification:new', callback);
    return () => { socket?.off('notification:new', callback); };
  };

  const onReservationChange = (callback: (data: { action: string; reservation: any }) => void) => {
    socket?.on('reservation:changed', callback);
    return () => { socket?.off('reservation:changed', callback); };
  };

  const onMenuUpdate = (callback: (data: any) => void) => {
    socket?.on('menu:updated', callback);
    return () => { socket?.off('menu:updated', callback); };
  };

  const onAvailabilityChange = (callback: (data: { branch: string; timestamp: string }) => void) => {
    socket?.on('availability:changed', callback);
    return () => { socket?.off('availability:changed', callback); };
  };

  return { socket: socketRef.current, onTableUpdate, onNotification, onReservationChange, onMenuUpdate, onAvailabilityChange };
};
