import type { ImageSourcePropType } from 'react-native';
import type { KitKind } from './KitArt';

/**
 * Product photos for the store. A kit with a photo shows it; a kit without one shows the drawing.
 *
 * To add them, save the pictures in `assets/store/` (landscape, about 1600 x 900, JPG) and uncomment the lines:
 *   assets/store/kit-satellite-radio.jpg  the dongle with the V-dipole antenna
 *   assets/store/kit-radio.jpg            the dongle with the single small antenna
 */
export const KIT_PHOTOS: Partial<Record<KitKind, ImageSourcePropType>> = {
  // 'satellite-radio': require('../../assets/store/kit-satellite-radio.jpg'),
  // radio: require('../../assets/store/kit-radio.jpg'),
};
