import { useState, type ReactNode } from 'react';
import { Sheet } from './ui';

/**
 * Hinweise, Vorschläge und Warnungen bleiben hinter einem (!) versteckt –
 * erst ein Tipp darauf zeigt sie. Nur rendern, wenn es auch etwas zu sagen gibt.
 */
export function InfoBang({
  title,
  tone = 'info',
  count,
  children,
}: {
  title: string;
  tone?: 'info' | 'warn' | 'bad';
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`bang bang-${tone}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`${count && count > 1 ? `${count} Hinweise` : 'Hinweis'}: ${title}`}
        aria-haspopup="dialog"
      >
        !{count != null && count > 1 && <span className="bang-count">{count}</span>}
      </button>
      {open && (
        <Sheet title={title} onClose={() => setOpen(false)}>
          <div className="bang-body">{children}</div>
        </Sheet>
      )}
    </>
  );
}
