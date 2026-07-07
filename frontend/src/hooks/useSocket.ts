import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore, useAppStore } from '@/store';
import type { Table } from '@/types';

let socket: Socket | null = null;

export const useSocket = () => {
  const { isAuthenticated } = useAuthStore();
  const { selectedBranch } = useAppStore();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    if (!socket) {
      const socketUrl = import.meta.env.VITE_API_URL 
        ? `${import.meta.env.VITE_API_URL}`
        : '/';
      socket = io(socketUrl, { withCredentials: true, transports: ['websocket', 'polling'] });
    }
    socketRef.current = socket;

    return () => {
      // Don't disconnect globally — keep persistent connection
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!socket || !selectedBranch) return;
    socket.emit('join:branch', selectedBranch);
    return () => { socket?.emit('leave:branch', selectedBranch); };
  }, [selectedBranch]);

  const onTableUpdate = (callback: (table: Table) => void) => {
    socket?.on('table:updated', callback);
    return () => { socket?.off('table:updated', callback); };
  };

  return { socket: socketRef.current, onTableUpdate };
};
