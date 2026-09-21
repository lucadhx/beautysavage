import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useScrollLock } from '@/lib/scrollLock';

export function Lightbox({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  images: string[];
  index: number | null;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}) {
  const open = index !== null;

  const prev = React.useCallback(
    () => index !== null && onIndexChange((index - 1 + images.length) % images.length),
    [index, images.length, onIndexChange]
  );
  const next = React.useCallback(
    () => index !== null && onIndexChange((index + 1) % images.length),
    [index, images.length, onIndexChange]
  );

  // Verrou compté, et surtout indépendant de `prev`/`next` : ces callbacks
  // changent à chaque image, ce qui relançait l'effet — donc rendait puis
  // reprenait le verrou — au moindre changement de photo.
  useScrollLock(open);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, prev, next]);

  return (
    <AnimatePresence>
      {open && index !== null && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white" onClick={onClose}>
            <X className="h-6 w-6" />
          </button>
          {images.length > 1 && (
            <>
              <button
                className="absolute left-4 rounded-full bg-white/10 p-2 text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  prev();
                }}
              >
                <ChevronLeft className="h-7 w-7" />
              </button>
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  next();
                }}
              >
                <ChevronRight className="h-7 w-7" />
              </button>
            </>
          )}
          <motion.img
            key={index}
            src={images[index]}
            alt=""
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="absolute bottom-5 text-sm text-white/70">
            {index + 1} / {images.length}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
