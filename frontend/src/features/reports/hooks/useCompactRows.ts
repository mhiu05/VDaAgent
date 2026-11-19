import { useEffect, useState } from 'react';

/** Render one semantic list variant; never mount duplicate desktop/mobile controls. */
export function useCompactRows() {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}
