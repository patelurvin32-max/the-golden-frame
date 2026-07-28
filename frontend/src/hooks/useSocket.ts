import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore, useAppStore } from '@/store';
import type { Table, Notification } from '@/types';

let socket: Socket | null = null;

export const useSocket = () => {
  const { isAuthenticated, user } = useAuthStore();
  const { selectedBranch } = useAppStore();
  const socketRef = useRef<Socket | null>(null);

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

  useEffect(() => {
    if (!socket || !isAuthenticated || !user) return;
    const branchId = selectedBranch || (user.branches?.[0] ? (typeof user.branches[0] === 'string' ? user.branches[0] : (user.branches[0] as any)._id) : undefined);
    socket.emit('join:user', {
      userId: user._id,
      role: user.role,
      branchId,
    });
  }, [isAuthenticated, user, selectedBranch]);

  useEffect(() => {
    if (!socket || !selectedBranch) return;
    socket.emit('join:branch', selectedBranch);
    return () => { socket?.emit('leave:branch', selectedBranch); };
  }, [selectedBranch]);

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

  return { socket: socketRef.current, onTableUpdate, onNotification, onReservationChange };
};
