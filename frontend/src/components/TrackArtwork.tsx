import React, { useEffect, useState } from "react";
import { Music } from "lucide-react";

interface TrackArtworkProps {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackClassName?: string;
  iconSize?: number;
  loading?: "lazy" | "eager";
}

export const TrackArtwork: React.FC<TrackArtworkProps> = ({
  src,
  alt,
  className = "w-full h-full object-cover",
  fallbackClassName = "",
  iconSize = 18,
  loading,
}) => {
  const cleanSrc = src?.trim() ?? "";
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [cleanSrc]);

  if (!cleanSrc || hasError) {
    return (
      <div
        role="img"
        aria-label={alt || "Track artwork"}
        className={`bg-[#121215] border border-white/10 flex items-center justify-center text-zinc-500 ${className} ${fallbackClassName}`}
      >
        <Music size={iconSize} className="text-zinc-500/90" />
      </div>
    );
  }

  return (
    <img
      src={cleanSrc}
      alt={alt}
      loading={loading}
      onError={() => setHasError(true)}
      className={className}
    />
  );
};
