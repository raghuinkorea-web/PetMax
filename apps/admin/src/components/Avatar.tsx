import { useEffect, useState } from 'react';
import { initials } from '@adisys/shared';
import { fileObjectUrl } from '../lib/api';
import { cx } from './ui';

/**
 * An employee's face, falling back to their initials.
 *
 * Uploaded files are never public — /files/:id needs the bearer token — so the
 * image cannot be dropped into an <img src>. It is fetched as a blob and shown
 * through an object URL, which is revoked when the avatar unmounts or the file
 * changes, exactly as receipt images are handled.
 */
export function Avatar({ name, fileId, size = 32, className, ring }: {
  name: string;
  fileId?: string | null;
  size?: number;
  className?: string;
  /** Tailwind ring classes for the badge overlay used in the directory. */
  ring?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId) { setUrl(null); return; }
    let revoked: string | null = null;
    let cancelled = false;
    fileObjectUrl(fileId)
      .then((u) => {
        revoked = u;
        // The component may have unmounted while the blob was downloading.
        if (cancelled) { URL.revokeObjectURL(u); return; }
        setUrl(u);
      })
      .catch(() => { if (!cancelled) setUrl(null); });   // fall back to initials
    return () => { cancelled = true; if (revoked) URL.revokeObjectURL(revoked); };
  }, [fileId]);

  const base = cx('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
                  'bg-ink-900 font-semibold text-white', ring, className);

  return (
    <span className={base} style={{ height: size, width: size, fontSize: Math.max(9, size * 0.36) }}>
      {url
        ? <img src={url} alt="" className="h-full w-full object-cover" />
        : <span aria-hidden>{initials(name)}</span>}
      <span className="sr-only">{name}</span>
    </span>
  );
}
