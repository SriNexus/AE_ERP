/**
 * EntityModal — Standardized Add/Edit modal wrapper
 *
 * Provides:
 *   - Consistent title (Add X / Edit X)
 *   - Form submit handling
 *   - Loading state on submit button
 *   - Cancel/Submit footer buttons
 *   - Size variants
 *
 * Usage:
 *   <EntityModal
 *     open={showForm}
 *     onClose={closeForm}
 *     title="Customer"
 *     isEdit={!!editId}
 *     onSubmit={handleSubmit}
 *     loading={saveMut.isPending}
 *     size="lg"
 *   >
 *     <Input label="Name" ... />
 *   </EntityModal>
 */

import React, { type FormEvent, type ReactNode } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface EntityModalProps {
  open:       boolean;
  onClose:    () => void;
  title:      string;
  isEdit?:    boolean;
  onSubmit:   (e: FormEvent) => void;
  loading?:   boolean;
  size?:      string;
  children:   ReactNode;
  submitLabel?: string;
}

export function EntityModal({
  open, onClose, title, isEdit = false, onSubmit, loading = false,
  size = 'lg', children, submitLabel,
}: EntityModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${title}` : `Add ${title}`}
      size={size}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="entity-form"
            loading={loading}
          >
            {submitLabel ?? (isEdit ? 'Update' : `Add ${title}`)}
          </Button>
        </div>
      }
    >
      <form id="entity-form" onSubmit={onSubmit} className="space-y-5">
        {children}
      </form>
    </Modal>
  );
}

export default EntityModal;
