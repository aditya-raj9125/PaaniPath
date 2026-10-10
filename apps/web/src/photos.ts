import { AppError } from '@paanipath/domain';

/** Canvas re-encoding strips EXIF location metadata and bounds uploads before transport. */
export async function preparePhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 15_000_000) throw new AppError('INVALID_PHOTO', 'Choose a JPEG or PNG smaller than 15 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
    const context = canvas.getContext('2d');
    if (context === null) throw new AppError('PHOTO_UNAVAILABLE', 'Photo processing is unavailable on this device.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.78);
    if (data.length > 1_400_000) throw new AppError('PHOTO_TOO_LARGE', 'That photo is still too large. Try a smaller image.');
    return data;
  } finally { bitmap.close(); }
}
