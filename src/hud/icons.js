/**
 * HUD 用到的 Bootstrap Icons（Shoelace 内置图标集），按需内联打包，零网络请求
 */
import { registerIconLibrary } from '@shoelace-style/shoelace/dist/utilities/icon-library.js';
import i0 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/camera-video.svg?raw';
import i1 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/camera-video-fill.svg?raw';
import i2 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/airplane.svg?raw';
import i3 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/arrow-repeat.svg?raw';
import i4 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/layers.svg?raw';
import i5 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/eye.svg?raw';
import i6 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/plus-lg.svg?raw';
import i7 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/dash-lg.svg?raw';
import i8 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/compass.svg?raw';
import i9 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/arrows-fullscreen.svg?raw';
import i10 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/fullscreen-exit.svg?raw';
import i11 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/moon-stars.svg?raw';
import i12 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/sun.svg?raw';
import i13 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/search.svg?raw';
import i14 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/bell.svg?raw';
import i15 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/x-lg.svg?raw';
import i16 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/geo-alt.svg?raw';
import i17 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/wind.svg?raw';
import i18 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/droplet.svg?raw';
import i19 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/arrow-up-right.svg?raw';
import i20 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/play-fill.svg?raw';
import i21 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/stop-fill.svg?raw';
import i22 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/crosshair.svg?raw';
import i23 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/building.svg?raw';
import i24 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/bounding-box.svg?raw';
import i25 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/cone-striped.svg?raw';
import i26 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/record-circle.svg?raw';
import i27 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/house.svg?raw';
import i28 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/broadcast-pin.svg?raw';
import i29 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/shield-check.svg?raw';
import i30 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/exclamation-triangle-fill.svg?raw';
import i31 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/cloud-sun.svg?raw';
import i32 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/stack.svg?raw';
import i33 from '../../node_modules/@shoelace-style/shoelace/dist/assets/icons/pin-map.svg?raw';

const ICONS = {
  'camera-video': i0,
  'camera-video-fill': i1,
  'airplane': i2,
  'arrow-repeat': i3,
  'layers': i4,
  'eye': i5,
  'plus-lg': i6,
  'dash-lg': i7,
  'compass': i8,
  'arrows-fullscreen': i9,
  'fullscreen-exit': i10,
  'moon-stars': i11,
  'sun': i12,
  'search': i13,
  'bell': i14,
  'x-lg': i15,
  'geo-alt': i16,
  'wind': i17,
  'droplet': i18,
  'arrow-up-right': i19,
  'play-fill': i20,
  'stop-fill': i21,
  'crosshair': i22,
  'building': i23,
  'bounding-box': i24,
  'cone-striped': i25,
  'record-circle': i26,
  'house': i27,
  'broadcast-pin': i28,
  'shield-check': i29,
  'exclamation-triangle-fill': i30,
  'cloud-sun': i31,
  'stack': i32,
  'pin-map': i33,
};

export function registerHudIcons() {
  registerIconLibrary('default', {
    resolver: (name) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ICONS[name] || '')}`,
    mutator: (svg) => svg.setAttribute('fill', 'currentColor'),
  });
}
