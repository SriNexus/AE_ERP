import { Eye } from 'lucide-react';
import { Button } from '../ui/Button';

type Props = {
  onView: () => void;
  label?: string;
  /** Stable identifier for the interactive tutorial system. */
  dataTour?: string;
};

export function RowViewAction({ onView, label = 'View', dataTour }: Props) {
  return (
    <div className="flex items-center justify-end gap-1.5 opacity-90 transition-opacity duration-150 group-hover:opacity-100" data-action>
      <Button
        size="xs"
        variant="outline"
        data-tour={dataTour}
        icon={<Eye className="h-3.5 w-3.5" />}
        onClick={onView}
        className="h-7 rounded-xl border-[var(--color-border-strong)] bg-[var(--color-text)] px-3 text-[var(--color-text-inverse)] shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-[var(--color-text)] hover:opacity-90 hover:shadow-[var(--shadow-enterprise-row)]"
      >
        {label}
      </Button>
    </div>
  );
}

export default RowViewAction;
