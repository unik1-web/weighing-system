interface PhotoLightboxProps {
  /** Absolute or same-origin URL of the enlarged JPEG. */
  src: string;
  /** Accessible description of the image. */
  alt: string;
  /** Close handler (backdrop / button). */
  onClose: () => void;
}

/**
 * Full-screen lightbox for a single ticket photo preview.
 */
export function PhotoLightbox({ src, alt, onClose }: PhotoLightboxProps) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр снимка"
    >
      <div
        className="relative max-h-[90vh] max-w-[90vw]"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -right-2 -top-2 z-10 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 shadow hover:bg-slate-50"
          title="Закрыть"
        >
          Закрыть
        </button>
        <img
          src={src}
          alt={alt}
          className="max-h-[85vh] max-w-[85vw] rounded-lg border border-slate-200 bg-slate-100 object-contain shadow-xl"
        />
      </div>
    </div>
  );
}
