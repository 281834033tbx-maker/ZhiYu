export type SpringState = {position:number;velocity:number};
export type SpringOptions = {stiffness?:number;damping?:number;mass?:number};

/** Exact damped spring solution. Velocity is expressed in units per second. */
export function advanceSpring(state:SpringState,target:number,seconds:number,{stiffness=240,damping=28,mass=1}:SpringOptions={}):SpringState {
  if(seconds<=0)return {...state};
  const displacement=state.position-target,alpha=damping/(2*mass),omegaSquared=stiffness/mass;
  const discriminant=alpha*alpha-omegaSquared,decay=Math.exp(-alpha*seconds);
  if(Math.abs(discriminant)<1e-7){
    const b=state.velocity+alpha*displacement;
    return {position:target+decay*(displacement+b*seconds),velocity:decay*(state.velocity-alpha*b*seconds)};
  }
  if(discriminant<0){
    const omega=Math.sqrt(-discriminant),sin=Math.sin(omega*seconds),cos=Math.cos(omega*seconds);
    return {position:target+decay*(displacement*cos+(state.velocity+alpha*displacement)/omega*sin),
      velocity:decay*(state.velocity*cos-(alpha*state.velocity+omegaSquared*displacement)/omega*sin)};
  }
  const root=Math.sqrt(discriminant),r1=-alpha+root,r2=-alpha-root;
  const a=(state.velocity-r2*displacement)/(r1-r2),b=displacement-a;
  return {position:target+a*Math.exp(r1*seconds)+b*Math.exp(r2*seconds),velocity:a*r1*Math.exp(r1*seconds)+b*r2*Math.exp(r2*seconds)};
}

/** Increasing edge resistance, bounded by the viewport rather than a hard stop. */
export function rubberBand(distance:number,viewport:number,coefficient=.42) {
  const size=Math.max(1,viewport),magnitude=Math.abs(distance);
  return Math.sign(distance)*size*(1-1/(magnitude*coefficient/size+1));
}
export function resistBounds(position:number,min:number,max:number,viewport:number) {
  return position<min?min+rubberBand(position-min,viewport):position>max?max+rubberBand(position-max,viewport):position;
}

export function animateSpring({from,to,velocity=0,onUpdate,onComplete,reducedMotion,positionTolerance=.06,velocityTolerance=.5,...options}:SpringOptions&{
  from:number;to:number;velocity?:number;onUpdate:(state:SpringState)=>void;onComplete?:()=>void;
  reducedMotion?:boolean;positionTolerance?:number;velocityTolerance?:number;
}) {
  let state={position:from,velocity},frame=0,stopped=false;
  const control={cancel(){stopped=true;cancelAnimationFrame(frame);return {...state};},current:()=>({...state})};
  const reduce=reducedMotion??window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce){state={position:to,velocity:0};onUpdate(state);onComplete?.();return control;}
  let previous=performance.now(),elapsed=0;
  const tick=(at:number)=>{
    if(stopped)return;
    const delta=Math.max(0,(at-previous)/1000);previous=at;elapsed+=delta;
    state=advanceSpring(state,to,delta,options);
    if((Math.abs(state.position-to)<positionTolerance&&Math.abs(state.velocity)<velocityTolerance)||elapsed>4){
      state={position:to,velocity:0};stopped=true;onUpdate(state);onComplete?.();return;
    }
    onUpdate(state);if(!stopped)frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);return control;
}
