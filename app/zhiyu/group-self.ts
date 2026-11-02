/** Keep a small avatar copy in a group without changing the user's original profile. */
export async function groupSelf(name: string, avatar?: string) {
  if (!avatar?.startsWith('data:image/')) return {name, ...(avatar ? {avatar} : {})};
  const image = new Image();
  image.src = avatar;
  try { await image.decode(); }
  catch { throw new Error('头像暂时无法读取，请检查个人资料中的头像。'); }
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('暂时无法准备群头像，请重试。');
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  context.drawImage(image, (image.naturalWidth-side)/2, (image.naturalHeight-side)/2, side, side, 0, 0, 128, 128);
  return {name, avatar:canvas.toDataURL('image/webp', .82)};
}
