interface DialogKeyboardActions {
  confirm: () => void | Promise<void>;
  cancel: () => void;
  disabled?: boolean;
}

export const handleDialogKeyboardShortcut = (
  event: KeyboardEvent,
  actions: DialogKeyboardActions,
) => {
  if (event.key !== "Enter" && event.key !== "Escape") return false;

  event.preventDefault();
  event.stopPropagation();

  if (event.repeat || event.isComposing || actions.disabled) return true;

  if (event.key === "Escape") {
    actions.cancel();
    return true;
  }

  try {
    const result = actions.confirm();
    if (result instanceof Promise) {
      void result.catch((error) => {
        console.error("Не удалось выполнить действие диалога", error);
      });
    }
  } catch (error) {
    console.error("Не удалось выполнить действие диалога", error);
  }
  return true;
};
