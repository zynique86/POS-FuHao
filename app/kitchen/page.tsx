'use client';

// Back Kitchen display — thin wrapper around StationDisplay, showing the
// back-kitchen (wok) items: noodles & fried.

import StationDisplay from '@/components/station-display';

export default function KitchenPage() {
  return (
    <StationDisplay
      station="kitchen"
      title="Back Kitchen"
      titleZh="後廚"
      emoji="👨‍🍳"
    />
  );
}
