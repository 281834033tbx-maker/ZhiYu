/** Unit mass, critical damping (zeta = 1), integrated analytically so the
 * gesture feels the same at 60Hz and 120Hz. Velocity is in pixels/second. */
export const SCROLL_DAMPING_RATIO=1;
export const SCROLL_NATURAL_FREQUENCY=20;
export function criticalScrollStep(position:number,velocity:number,target:number,seconds:number) {
 const omega=SCROLL_NATURAL_FREQUENCY,offset=position-target;
 const term=velocity+omega*offset,decay=Math.exp(-omega*seconds);
 return {position:target+(offset+term*seconds)*decay,velocity:(velocity-omega*term*seconds)*decay};
}
