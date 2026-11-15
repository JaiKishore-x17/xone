import React from "react";

interface XoneLogoProps {
  size?: number;
  className?: string;
}

export const XoneLogo: React.FC<XoneLogoProps> = ({ size = 32, className = "" }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Xone logo"
    >
      <rect width="36" height="36" rx="10" fill="#FF5E4D" />
      <path
        d="M10.5 10.5L18 18L25.5 10.5"
        stroke="#000000"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 25.5L18 18L25.5 25.5"
        stroke="#000000"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="18" r="2.2" fill="#FFFFFF" />
    </svg>
  );
};
