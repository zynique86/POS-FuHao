'use client';

// Front Kitchen display — thin wrapper around StationDisplay, showing the
// front-counter items: dim sum, buns, roasted meats, etc. Mirrors
// app/kitchen/page.tsx (Back Kitchen), which filters to 'kitchen' station
// items. This filters to 'cashier' station items (see CATEGORY_STATION in
// lib/types.ts — the station key stays 'cashier' because it maps to the
// front-counter printer, but on screen it's labelled "Front Kitchen").

import StationDisplay from '@/components/station-display';

export default function FrontKitchenPage() {
  return (
    <StationDisplay
      station="cashier"
      title="Front Kitchen"
      titleZh="前廚"
      emoji="🥟"
    />
  );
}
