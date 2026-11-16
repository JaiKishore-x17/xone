import React from "react";
import { Check, Download, Loader2 } from "lucide-react";

interface DownloadStatusIconProps {
  isDownloading: boolean;
  isDownloaded: boolean;
  size?: number;
  inactiveClassName?: string;
}

/** Renders a Hyper Coral spinner while downloading, a solid checkmark badge once offline, or a download icon. */
export const DownloadStatusIcon: React.FC<DownloadStatusIconProps> = ({
  isDownloading,
  isDownloaded,
  size = 17,
  inactiveClassName = "text-[#B3B3B3]",
}) => {
  if (isDownloading) {
    return (
      <Loader2
        size={size}
        className="animate-spin text-[#FF5E4D] shrink-0"
      />
    );
  }

  if (isDownloaded) {
    const badgeSizeClass = size >= 20 ? "w-5 h-5" : "w-[18px] h-[18px]";
    const checkSize = size >= 20 ? 13 : 12;
    return (
      <span
        className={`${badgeSizeClass} rounded-full bg-[#FF5E4D] text-black inline-flex items-center justify-center shrink-0`}
      >
        <Check size={checkSize} strokeWidth={3} />
      </span>
    );
  }

  return <Download size={size} className={`${inactiveClassName} shrink-0`} />;
};
