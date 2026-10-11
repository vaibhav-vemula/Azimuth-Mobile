export interface StoreProduct {
  id: string;
  title: string;
  tagline: string;
  priceUsdc: number;
  includes: string[];
  /** Ionicons name for the card. */
  icon: "planet" | "radio";
}

/** The RTL-SDR kits in the store. Prices are in USDC on Solana. Ordering is not open yet. */
export const STORE_PRODUCTS: StoreProduct[] = [
  {
    id: "kit-satellite-radio",
    title: "Satellite + Radio kit",
    tagline: "Everything for weather satellites and radio",
    priceUsdc: 50,
    includes: [
      "RTL-SDR dongle",
      "Antenna for satellite passes",
      "Antenna for radio",
      "USB-C OTG adapter",
    ],
    icon: "planet",
  },
  {
    id: "kit-radio",
    title: "Radio kit",
    tagline: "For FM and radio listening",
    priceUsdc: 25,
    includes: ["RTL-SDR dongle", "Antenna for radio", "USB-C OTG adapter"],
    icon: "radio",
  },
];
