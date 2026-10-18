// FaLe Plus and reward videos are offered only inside the Android app (Google Play). The web version shows no
// paid offer and advertises none – it is hosted on a non-commercial plan until the Play Store launch.
// Status lines for people who already have Plus (bought in the app) stay visible everywhere.
import { isNative, platformName } from './platform.js';

// iOS app: no paid offer yet (App Store purchases need their own server check – see store/IOS-SETUP.md)
export const showPlus = () => isNative() && platformName() !== 'ios';
