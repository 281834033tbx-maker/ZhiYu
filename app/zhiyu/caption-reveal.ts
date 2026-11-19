/** Compare complete ASR snapshots, preserving both unchanged ends of a correction. */
export function splitCaptionUpdate(previous:string,next:string) {
  const before=Array.from(previous),after=Array.from(next);
  let start=0,end=0;
  while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  while(end<before.length-start&&end<after.length-start&&before[before.length-1-end]===after[after.length-1-end])end++;
  return {
    before:after.slice(0,start).join(''),
    added:after.slice(start,end?after.length-end:after.length).join(''),
    after:end?after.slice(-end).join(''):'',
  };
}
