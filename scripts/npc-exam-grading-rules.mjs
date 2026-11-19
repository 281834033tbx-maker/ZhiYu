/** A conversational ellipsis is not a sentence-final full stop. Keep this
 * check local to newly graded exam outputs; never mutate stored replies or
 * historical scores. R09 also permits the informal Chinese “。。。” form. */
export function hasExamSentenceFinalPeriod(text){
  const end=String(text).trimEnd();
  if(!/[。.]$/u.test(end))return false;
  if(/(?:\.{3,}|。{3,})$/u.test(end))return false;
  return true;
}
