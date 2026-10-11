import type { KitKind } from './KitArt';

export interface StoreProduct {
  id: string;
  title: string;
  tagline: string;
  priceUsdc: number;
  /** What the kit is for, shown as small tags under the picture. */
  works: string[];
  includes: string[];
  /** Which drawing to show. Replace with a photo here when there is one. */
  art: KitKind;
  /** A short ribbon on the card, if any. */
  ribbon?: string;
}

/** The RTL-SDR kits in the store. Prices are in USDC on Solana. Ordering is not open yet. */
export const STORE_PRODUCTS: StoreProduct[] = [
  {
    id: 'kit-satellite-radio',
    title: 'Satellite + Radio kit',
    tagline: 'Catch weather satellites from your phone, and listen to the airwaves.',
    priceUsdc: 50,
    works: ['Weather satellites', 'FM and radio', 'Sondes'],
    includes: ['RTL-SDR USB dongle', 'V-dipole antenna for satellite passes', 'Telescopic antenna for radio', 'USB-C OTG adapter'],
    art: 'satellite-radio',
    ribbon: 'Full kit',
  },
  {
    id: 'kit-radio',
    title: 'Radio kit',
    tagline: 'A simple starter for FM and radio listening on your phone.',
    priceUsdc: 25,
    works: ['FM and radio'],
    includes: ['RTL-SDR USB dongle', 'Telescopic antenna for radio', 'USB-C OTG adapter'],
    art: 'radio',
  },
];
