// features/categories/components/CategoryForm.tsx
import { type FormEvent } from 'react';
import { Input, Textarea } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import type { CategoryForm as CategoryFormValues } from '../types';

interface Props {
  form:      CategoryFormValues;
  onChange:  (f: CategoryFormValues) => void;
  onSubmit:  (e: FormEvent) => void;
  onCancel:  () => void;
  loading:   boolean;
  isEdit:    boolean;
}

export function CategoryForm({ form, onChange, onSubmit, onCancel, loading, isEdit }: Props) {
  const set = (key: keyof CategoryFormValues, val: string) => onChange({ ...form, [key]: val });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Input
        label="Category Name"
        required
        value={form.name}
        onChange={e => set('name', e.target.value)}
        placeholder="e.g. Electronics"
      />
      <Input
        label="Parent Category"
        value={form.parentCategory}
        onChange={e => set('parentCategory', e.target.value)}
        placeholder="Leave empty for root category"
      />
      <Textarea
        label="Description"
        value={form.description}
        onChange={e => set('description', e.target.value)}
        rows={2}
      />
      <Input
        label="Display Order"
        type="number"
        value={form.order}
        onChange={e => set('order', e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={loading}>{isEdit ? 'Update' : 'Add Category'}</Button>
      </div>
    </form>
  );
}
