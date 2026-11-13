'use client';

import { useEffect, useState } from 'react';
import { formatBogotaDateTime } from '@/lib/utils/timezone';
import { SYSTEM_TIMEZONE } from '@/lib/constants/config';

export function BogotaClock() {
  const [formatted, setFormatted] = useState<string>('');

  useEffect(() => {
    const updateClock = () => {
      setFormatted(formatBogotaDateTime(new Date()));
    };
    const initialTimer = setTimeout(updateClock, 0);
    const timer = setInterval(updateClock, 1000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-stone-500">
        Hora oficial del sistema · {SYSTEM_TIMEZONE}
      </span>
      <p className="font-mono text-sm text-stone-900 tabular-nums capitalize">
        {formatted || 'Sincronizando hora de Colombia...'}
      </p>
    </div>
  );
}
