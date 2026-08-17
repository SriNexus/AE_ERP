/**
 * Compresses an image file in the browser using HTML Canvas.
 * Ensures the image fits within max bounds and is converted to a highly compressed Base64 WebP/JPEG string.
 * This is crucial to prevent Firestore payload size limits (1MB per doc) when storing assets.
 */
export async function compressImageBase64(file: File, maxWidth = 600, maxHeight = 600, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File is not an image'));
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Calculate aspect ratio boundaries
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height *= maxWidth / width));
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width *= maxHeight / height));
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Draw and compress
        ctx.drawImage(img, 0, 0, width, height);
        
        // Use image/webp for best compression, fallback to jpeg if transparency not needed, else png
        const format = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const compressedBase64 = canvas.toDataURL(format, quality);
        resolve(compressedBase64);
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
}
