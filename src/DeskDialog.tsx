import { Dialog } from '@base-ui/react/dialog';
import type { ReactNode, RefObject } from 'react';
import './desk-dialog.css';

/** Shared modal focus, Escape and return-focus behavior. */
export function DeskDialog({
  open,
  onOpenChange,
  title,
  children,
  returnFocus,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  returnFocus?: RefObject<HTMLElement | null>;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="desk-dialog-backdrop" />
        <Dialog.Popup
          className={'desk-dialog' + (wide ? ' desk-dialog-wide' : '')}
          finalFocus={returnFocus}
        >
          <div className="desk-dialog-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close aria-label={title + ' 닫기'}>닫기</Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
