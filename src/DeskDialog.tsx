import { Dialog } from '@base-ui/react/dialog';
import { useRef, type ReactNode, type RefObject } from 'react';
import './desk-dialog.css';

/** Shared modal focus, Escape and return-focus behavior. */
export function DeskDialog({
  open,
  onOpenChange,
  title,
  children,
  returnFocus,
  wide = false,
  sheet = false,
  reading = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  returnFocus?: RefObject<HTMLElement | null>;
  wide?: boolean;
  sheet?: boolean;
  reading?: boolean;
}) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="desk-dialog-backdrop" />
        <Dialog.Popup
          ref={popup}
          className={
            'desk-dialog' +
            (wide ? ' desk-dialog-wide' : '') +
            (sheet ? ' desk-dialog-sheet' : '') +
            (reading ? ' desk-dialog-reading' : '')
          }
          finalFocus={returnFocus}
          initialFocus={(interaction) =>
            interaction === 'touch'
              ? popup.current
              : (popup.current?.querySelector<HTMLInputElement>('.indicator-picker-search input') ??
                true)
          }
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
