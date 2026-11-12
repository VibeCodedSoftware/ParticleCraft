// An imported particle picture: small, and kept inside the effect as a data URL, so it goes wherever the effect goes
// (saved projects, ParticleCraft to GameCraft, exported games) without a separate file to lose.
export async function particlePictureData(file: File, max = 256): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bitmap.width * k)); c.height = Math.max(1, Math.round(bitmap.height * k));
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  return c.toDataURL('image/png');
}
