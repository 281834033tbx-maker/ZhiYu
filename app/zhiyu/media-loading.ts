/** Reveal only a decoded, still-mounted image. SVG/legacy decode rejection may still be displayable. */
export function afterImageDecode(image:HTMLImageElement,onReady:()=>void) {
  const ready=()=>{if(image.isConnected!==false&&image.naturalWidth>0)onReady();};
  if(typeof image.decode!=='function'){ready();return;}
  void image.decode().then(ready,ready);
}
