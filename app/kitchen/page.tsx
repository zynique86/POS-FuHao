'use client';

// Kitchen display — thin wrapper around StationDisplay filtered to
// food items (kitchen station).

import StationDisplay from '@/components/station-display';

export default function KitchenPage() {
  return (
    <StationDisplay
      station="kitchen"
      title="Kitchen"
      titleZh="廚房"
      emoji="👨‍🍳"
    />
  );
}
