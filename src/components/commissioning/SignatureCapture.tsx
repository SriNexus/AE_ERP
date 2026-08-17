/**
 * SignatureCapture — Signature upload component for Commissioning
 *
 * Provides:
 * - File picker for signature image (photo of signed document)
 * - Image preview
 * - Upload progress indicator
 * - Reuses Firebase Storage via lib/storage.ts
 * - Reuses existing UI patterns (design tokens, tailwind)
 */

import { useState, useRef } from 'react';
import { Upload, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { uploadCommissioningSignature } from '../../lib/storage';

interface SignatureCaptureProps {
  companyId: string;
  onUploadComplete: (url: string) => void;
  onUploadError?: (error: Error) => void;
  initialUrl?: string;
}

export function SignatureCapture({
  companyId,
  onUploadComplete,
  onUploadError,
  initialUrl,
}: SignatureCaptureProps) {
  const [preview, setPreview] = useState<string | null>(initialUrl || null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (JPEG, PNG, etc.)');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be under 5MB');
      return;
    }

    setFileName(file.name);
    setError(null);

    // Show local preview immediately
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);

    // Upload to Firebase Storage
    setUploading(true);
    try {
      const downloadUrl = await uploadCommissioningSignature(companyId, file);
      onUploadComplete(downloadUrl);
      // Replace local preview URL with the download URL
      URL.revokeObjectURL(localUrl);
      setPreview(downloadUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      setPreview(null);
      onUploadError?.(err instanceof Error ? err : new Error(message));
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = () => {
    setPreview(null);
    setFileName(null);
    setError(null);
    onUploadComplete('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  // If we have a preview and it's from a successful upload (not a local blob URL)
  const isUploaded = preview && !preview.startsWith('blob:');

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
        Customer Signature *
      </label>

      {preview ? (
        <div className="relative rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-2">
          <img
            src={preview}
            alt="Customer signature"
            className="w-full h-24 object-contain rounded-lg bg-white"
          />
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            {isUploaded && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" />
                {uploading ? 'Uploading...' : 'Uploaded'}
              </span>
            )}
            {!uploading && (
              <button
                onClick={handleRemove}
                className="rounded-full bg-black/40 p-1 text-white hover:bg-black/60 transition-colors"
                title="Remove signature"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {fileName && (
            <p className="mt-1 text-[10px] text-[var(--color-text-muted)] truncate px-1">
              {fileName}
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          disabled={uploading}
          className="w-full rounded-xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-bg)] p-4 text-center hover:border-[var(--color-primary)] hover:bg-[var(--color-bg-sunken)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-1">
              <div className="h-6 w-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-[var(--color-text-muted)]">Uploading...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <Upload className="h-5 w-5 text-[var(--color-text-muted)]" />
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                Upload signed document or photo
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)]">
                JPEG, PNG — max 5MB
              </span>
            </div>
          )}
        </button>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="h-3 w-3" />
          <span>{error}</span>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}

export default SignatureCapture;
