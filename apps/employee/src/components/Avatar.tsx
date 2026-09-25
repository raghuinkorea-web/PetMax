import { useEffect, useState } from 'react';
import { initials } from '@adisys/shared';
import { fileObjectUrl } from '../lib/api';
import { cx } from './ui';

/**
 * The employee's photo, falling back to their initials.
 *
 * Files are never public, so the image is fetched with the bearer token and
 * shown through an object URL, which is revoked on unmount.
 */
export function Avatar({ name, fileId, size = 40, className }: {
  name: string; fileId?: string | null; size?: number; className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId) { setUrl(null); return; }
    let revoked: string | null = null;
    let cancelled = false;
    fileObjectUrl(fileId)
      .then((u) => {
        revoked = u;
        if (cancelled) { URL.revokeObjectURL(u); return; }
        setUrl(u);
      })
      .catch(() => { if (!cancelled) setUrl(null); });
    return () => { cancelled = true; if (revoked) URL.revokeObjectURL(revoked); };
  }, [fileId]);

  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
                    'bg-ink-900 font-semibold text-white', className)}
      style={{ height: size, width: size, fontSize: Math.max(10, size * 0.36) }}>
      {url
        ? <img src={url} alt="" className="h-full w-full object-cover" />
        : <span aria-hidden>{initials(name)}</span>}
      <span className="sr-only">{name}</span>
    </span>
  );
}
