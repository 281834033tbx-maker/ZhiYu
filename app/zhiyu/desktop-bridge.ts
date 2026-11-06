export type ViewerImage = {id: string; src: string; alt: string; at?: string; sender?: string};
export type ImageViewerPayload = {conversationId: string; images: ViewerImage[]; index: number};
export type ImageViewerState = ImageViewerPayload & {history: boolean; pinned: boolean};
export type ImageActionResult = {ok?: boolean; canceled?: boolean; error?: string};
export type ProfilePopoverAnchor = {x:number;y:number;width:number;height:number};
export type ProfilePopoverLayout = {id?:string;width:number;height:number;anchorX:number;anchorY:number;side:'top'|'bottom'};
export type ZhiyuDesktopBridge = {
  platform: string;
  mobilePreview?: boolean;
  nativeMaterial?: boolean;
  profilePopoverControl?: 'native-v1';
  prepareProfilePopover?: (payload:{anchor:ProfilePopoverAnchor;width:number}) => Promise<{id:string;name:string}|null>;
  fitProfilePopover?: (payload:{id:string;anchor:ProfilePopoverAnchor;height:number}) => Promise<ProfilePopoverLayout|null>;
  closeProfilePopover?: (id:string) => Promise<boolean>;
  onProfilePopoverLayout?: (listener:(layout:ProfilePopoverLayout&{id:string})=>void) => ()=>void;
  onProfilePopoverDismiss?: (listener:(id:string)=>void) => ()=>void;
  onProfilePopoverClosed?: (listener:(id:string)=>void) => ()=>void;
  taskCalendarWindowControl?: 'reveal-v1';
  revealTaskCalendarWindow?: (expectedURL: string) => Promise<boolean>;
  requestMicrophoneAccess: () => Promise<'granted'|'denied'|'restricted'|'unknown'>;
  openMicrophoneSettings: () => Promise<boolean>;
  requestCameraAccess?: () => Promise<'granted'|'denied'|'restricted'|'unknown'>;
  openCameraSettings?: () => Promise<boolean>;
  openImageViewer: (payload: ImageViewerPayload) => Promise<boolean>;
  updateImageViewer: (payload: ImageViewerPayload) => Promise<boolean>;
  getImageViewer: () => Promise<ImageViewerState | null>;
  fitImageViewer: (payload: {id:string; width:number; height:number}) => Promise<boolean>;
  selectViewerImage: (index: number) => Promise<boolean>;
  setImageHistory: (visible: boolean) => Promise<boolean>;
  toggleImagePin: () => Promise<boolean>;
  imageWindowControl: (action:'close'|'minimize'|'maximize') => Promise<boolean>;
  copyViewerImage: (bytes:Uint8Array) => Promise<ImageActionResult>;
  saveViewerImage: (id:string) => Promise<ImageActionResult>;
  onImageViewerState: (listener:(state:ImageViewerState|null)=>void) => () => void;
  openCharacterWindow: (personId: string) => Promise<boolean>;
  closeCharacterWindow: () => Promise<boolean>;
  setCharacterChromeHeight: (height: number) => Promise<boolean>;
  getCharacterFullScreen: () => Promise<boolean>;
  setCharacterFullScreen: (fullscreen: boolean) => Promise<boolean>;
  onCharacterFullScreenChange: (listener: (fullscreen: boolean) => void) => () => void;
  onCharacterWindowState: (listener: (personId: string | null) => void) => () => void;
};

declare global {
  interface Window {
    zhiyuDesktop?: ZhiyuDesktopBridge;
  }
}
