'use client';

import { useCallback, useState } from 'react';
import type { Poi } from '@/types/poi';

export function usePOIDrawer() {
  const [poi, setPoi] = useState<Poi | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const openPOI = useCallback((p: Poi) => {
    setPoi(p);
    setIsOpen(true);
  }, []);

  const closePOI = useCallback(() => {
    setIsOpen(false);
    // Delay clearing poi so exit animation can play
    setTimeout(() => setPoi(null), 300);
  }, []);

  return { poi, isOpen, openPOI, closePOI };
}
