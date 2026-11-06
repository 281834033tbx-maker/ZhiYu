'use strict';

// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const { contextBridge, ipcRenderer } = require('electron');

// Chromium may inherit the opener's preload for about:blank. The profile's
// script-created document needs no bridge of its own; only its opener fits it.
const profileSurface = typeof window !== 'undefined' && window.location.href === 'about:blank'
  && window.name.startsWith('zhiyu-profile-');
if (!profileSurface) contextBridge.exposeInMainWorld('zhiyuDesktop', {
  platform: process.platform,
  nativeMaterial: process.argv.includes('--zhiyu-native-material'),
  profilePopoverControl: process.argv.includes('--zhiyu-native-material') ? 'native-v1' : undefined,
  prepareProfilePopover: payload => ipcRenderer.invoke('zhiyu:profile-prepare', payload),
  fitProfilePopover: payload => ipcRenderer.invoke('zhiyu:profile-fit', payload),
  closeProfilePopover: id => ipcRenderer.invoke('zhiyu:profile-close', id),
  onProfilePopoverLayout: listener => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('zhiyu:profile-layout', handler);
    return () => ipcRenderer.removeListener('zhiyu:profile-layout', handler);
  },
  onProfilePopoverDismiss: listener => {
    const handler = (_event, value) => listener(value.id);
    ipcRenderer.on('zhiyu:profile-dismiss', handler);
    return () => ipcRenderer.removeListener('zhiyu:profile-dismiss', handler);
  },
  onProfilePopoverClosed: listener => {
    const handler = (_event, value) => listener(value.id);
    ipcRenderer.on('zhiyu:profile-closed', handler);
    return () => ipcRenderer.removeListener('zhiyu:profile-closed', handler);
  },
  taskCalendarWindowControl: 'reveal-v1',
  revealTaskCalendarWindow: expectedURL => ipcRenderer.invoke('zhiyu:task-calendar-reveal', expectedURL),
  requestMicrophoneAccess: () => ipcRenderer.invoke('zhiyu:microphone-request'),
  openMicrophoneSettings: () => ipcRenderer.invoke('zhiyu:microphone-settings'),
  requestCameraAccess: () => ipcRenderer.invoke('zhiyu:camera-request'),
  openCameraSettings: () => ipcRenderer.invoke('zhiyu:camera-settings'),
  openImageViewer: payload => ipcRenderer.invoke('zhiyu:image-open', payload),
  updateImageViewer: payload => ipcRenderer.invoke('zhiyu:image-update', payload),
  getImageViewer: () => ipcRenderer.invoke('zhiyu:image-get'),
  fitImageViewer: payload => ipcRenderer.invoke('zhiyu:image-fit', payload),
  selectViewerImage: index => ipcRenderer.invoke('zhiyu:image-select', index),
  setImageHistory: visible => ipcRenderer.invoke('zhiyu:image-history', visible),
  toggleImagePin: () => ipcRenderer.invoke('zhiyu:image-pin'),
  imageWindowControl: action => ipcRenderer.invoke('zhiyu:image-control', action),
  copyViewerImage: bytes => ipcRenderer.invoke('zhiyu:image-copy', bytes),
  saveViewerImage: id => ipcRenderer.invoke('zhiyu:image-save', id),
  onImageViewerState: listener => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('zhiyu:image-state', handler);
    return () => ipcRenderer.removeListener('zhiyu:image-state', handler);
  },
  openCharacterWindow: (personId) => ipcRenderer.invoke('zhiyu:character-open', personId),
  closeCharacterWindow: () => ipcRenderer.invoke('zhiyu:character-close'),
  setCharacterChromeHeight: (height) => ipcRenderer.invoke('zhiyu:character-chrome-height', height),
  getCharacterFullScreen: () => ipcRenderer.invoke('zhiyu:character-fullscreen-get'),
  setCharacterFullScreen: (fullscreen) => ipcRenderer.invoke('zhiyu:character-fullscreen-set', fullscreen),
  onCharacterFullScreenChange: (listener) => {
    const handler = (_event, fullscreen) => listener(fullscreen);
    ipcRenderer.on('zhiyu:character-fullscreen-state', handler);
    return () => ipcRenderer.removeListener('zhiyu:character-fullscreen-state', handler);
  },
  onCharacterWindowState: (listener) => {
    const handler = (_event, personId) => listener(personId);
    ipcRenderer.on('zhiyu:character-window-state', handler);
    return () => ipcRenderer.removeListener('zhiyu:character-window-state', handler);
  },
});
