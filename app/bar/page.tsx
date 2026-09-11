'use client';

// Bar display — thin wrapper around StationDisplay filtered to
// drink items (bar station).

import StationDisplay from '@/components/station-display';

export default function BarPage() {
  return (
    <StationDisplay
      station="bar"
      title="Bar"
      titleZh="水吧"
      emoji="🫖"
    />
  );
}
